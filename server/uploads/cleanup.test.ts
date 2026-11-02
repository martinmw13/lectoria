import { describe, expect, it } from "vitest";
import { uploadDailySpendKey } from "@/core/uploads";
import { spendKey } from "@/server/guard/spend";
import { cleanupUploads, handleCleanup } from "./cleanup";
import { createUpload } from "./create";
import { parseUploadJob, saveUploadJob, usageCostMicro } from "./state";
import { stepUpload } from "./step";
import { createMemoryKV, helpfulMeta, memoryStore, tinyBook } from "./test-support";

const DAY_MS = 24 * 3600 * 1000;
const DAY = "2026-10-30";

describe("cleanupUploads", () => {
  it("deletes only blobs past the TTL", async () => {
    const now = Date.now();
    const times = new Map([
      ["uploads/u-old/book.json", now - 31 * DAY_MS],
      ["uploads/u-new/book.json", now - 2 * DAY_MS],
    ]);
    const store = memoryStore(times);
    await store.saveJson("uploads/u-old/book.json", "{}");
    await store.saveJson("uploads/u-new/book.json", "{}");
    await store.saveJson("images/oz/kept.webp", "x");
    const out = await cleanupUploads(store, now);
    expect(out.deleted).toBe(1);
    expect(store.files.has("uploads/u-old/book.json")).toBe(false);
    expect(store.files.has("uploads/u-new/book.json")).toBe(true);
    expect(store.files.has("images/oz/kept.webp")).toBe(true);
  });

  it("keeps going when one delete fails", async () => {
    const now = Date.now();
    const store = memoryStore(
      new Map([
        ["uploads/a/book.json", now - 40 * DAY_MS],
        ["uploads/b/book.json", now - 40 * DAY_MS],
      ]),
    );
    await store.saveJson("uploads/a/book.json", "{}");
    await store.saveJson("uploads/b/book.json", "{}");
    let calls = 0;
    const real = store.remove.bind(store);
    store.remove = async (path: string) => {
      calls += 1;
      if (calls === 1) throw new Error("blob down");
      await real(path);
    };
    const out = await cleanupUploads(store, now);
    expect(out.deleted).toBe(1);
  });

  it("sweeps old upload pictures but never shelf books", async () => {
    const now = Date.now();
    const old = "images/u-AAAAAAAAAAAAAAAAAAAAAA/v1/v5/p1.webp";
    const fresh = "images/u-AAAAAAAAAAAAAAAAAAAAAA/v1/v5/p2.webp";
    const shelf = "images/oz/v5/p1.webp";
    const images = memoryStore(
      new Map([
        [old, now - 31 * DAY_MS],
        [fresh, now - 2 * DAY_MS],
        [shelf, now - 60 * DAY_MS],
      ]),
    );
    await images.saveJson(old, "x");
    await images.saveJson(fresh, "x");
    await images.saveJson(shelf, "x");
    const out = await cleanupUploads(memoryStore(), now, { imageStore: images });
    expect(out.deleted).toBe(1);
    expect(images.files.has(old)).toBe(false);
    expect(images.files.has(fresh)).toBe(true);
    expect(images.files.has(shelf)).toBe(true);
  });

  it("keeps sweeping when one image delete fails", async () => {
    const now = Date.now();
    const images = memoryStore(
      new Map([
        ["images/u-AAAAAAAAAAAAAAAAAAAAAA/v1/v5/a.webp", now - 40 * DAY_MS],
        ["images/u-AAAAAAAAAAAAAAAAAAAAAA/v1/v5/b.webp", now - 40 * DAY_MS],
      ]),
    );
    await images.saveJson("images/u-AAAAAAAAAAAAAAAAAAAAAA/v1/v5/a.webp", "x");
    await images.saveJson("images/u-AAAAAAAAAAAAAAAAAAAAAA/v1/v5/b.webp", "x");
    let calls = 0;
    const real = images.remove.bind(images);
    images.remove = async (path: string) => {
      calls += 1;
      if (calls === 1) throw new Error("blob down");
      await real(path);
    };
    const out = await cleanupUploads(memoryStore(), now, { imageStore: images });
    expect(out.deleted).toBe(1);
  });
});

describe("cleanupUploads stale jobs", () => {
  async function workingFlow() {
    const kv = createMemoryKV();
    const store = memoryStore();
    const out = await createUpload({
      kv,
      store,
      meta: helpfulMeta(),
      body: { ...tinyBook(), author: null },
      path: "free",
      anonId: "anon-1",
      day: DAY,
      quotaKeys: { ip: "q-ip", anon: "q-anon" },
      spendCapMicro: 10_000_000,
    });
    await stepUpload({ kv, store, meta: helpfulMeta(), jev: null, id: out.id, chapter: 1 });
    return { kv, store, id: out.id };
  }

  it("settles jobs still working past six hours, exactly once", async () => {
    const flow = await workingFlow();
    const job = parseUploadJob(await flow.kv.get(`upload:job:${flow.id}`));
    expect(job?.status).toBe("working");
    await saveUploadJob(flow.kv, { ...job!, createdAt: Date.now() - 7 * 3600 * 1000 });
    const out = await cleanupUploads(flow.store, Date.now(), { kv: flow.kv });
    expect(out.reconciled).toBe(1);
    const failed = parseUploadJob(await flow.kv.get(`upload:job:${flow.id}`));
    expect(failed?.status).toBe("failed");
    // Judge plus the finished part stay on both counters.
    const kept = usageCostMicro(failed!.usage);
    expect(kept).toBeGreaterThan(0);
    expect(kept).toBeLessThan(50_000);
    expect(await flow.kv.get(spendKey())).toBe(String(kept));
    expect(await flow.kv.get(uploadDailySpendKey(DAY))).toBe(String(kept));
    // A second run finds nothing to settle.
    const again = await cleanupUploads(flow.store, Date.now(), { kv: flow.kv });
    expect(again.reconciled).toBe(0);
    expect(await flow.kv.get(spendKey())).toBe(String(kept));
  });

  it("settles failed jobs missing the refund marker, exactly once", async () => {
    const flow = await workingFlow();
    // A fail that saved the status but died before the settle.
    const job = parseUploadJob(await flow.kv.get(`upload:job:${flow.id}`));
    await saveUploadJob(flow.kv, { ...job!, status: "failed" });
    expect(await flow.kv.get(`upload:refunded:${flow.id}`)).toBeNull();
    expect(await flow.kv.get(spendKey())).toBe("50000");
    const out = await cleanupUploads(flow.store, Date.now(), { kv: flow.kv });
    expect(out.reconciled).toBe(1);
    const settled = parseUploadJob(await flow.kv.get(`upload:job:${flow.id}`));
    expect(settled?.status).toBe("failed");
    const kept = usageCostMicro(settled!.usage);
    expect(await flow.kv.get(spendKey())).toBe(String(kept));
    expect(await flow.kv.get(uploadDailySpendKey(DAY))).toBe(String(kept));
    const again = await cleanupUploads(flow.store, Date.now(), { kv: flow.kv });
    expect(again.reconciled).toBe(0);
    expect(await flow.kv.get(spendKey())).toBe(String(kept));
  });

  it("never touches done jobs", async () => {
    const flow = await workingFlow();
    const job = parseUploadJob(await flow.kv.get(`upload:job:${flow.id}`));
    await saveUploadJob(flow.kv, { ...job!, status: "done", usage: job!.usage, costMicro: 123 });
    const out = await cleanupUploads(flow.store, Date.now(), { kv: flow.kv });
    expect(out.reconciled).toBe(0);
    const kept = parseUploadJob(await flow.kv.get(`upload:job:${flow.id}`));
    expect(kept?.status).toBe("done");
    expect(kept?.costMicro).toBe(123);
    expect(await flow.kv.get(`upload:refunded:${flow.id}`)).toBeNull();
    expect(await flow.kv.get(spendKey())).toBe("50000");
  });

  it("leaves fresh working jobs alone", async () => {
    const flow = await workingFlow();
    const out = await cleanupUploads(flow.store, Date.now(), { kv: flow.kv });
    expect(out.reconciled).toBe(0);
    expect(parseUploadJob(await flow.kv.get(`upload:job:${flow.id}`))?.status).toBe("working");
    expect(await flow.kv.get(spendKey())).toBe("50000");
  });

  it("skips the reconcile without Redis", async () => {
    const flow = await workingFlow();
    const out = await cleanupUploads(flow.store, Date.now());
    expect(out.reconciled).toBe(0);
  });
});

describe("handleCleanup", () => {
  const req = (auth?: string): Request =>
    new Request("https://lectoria.test/api/cron/cleanup-uploads", {
      headers: auth ? { authorization: auth } : {},
    });

  it("hides the route without the secret", async () => {
    expect((await handleCleanup(req(), { store: memoryStore(), secret: "s3cr3t" })).status).toBe(404);
    expect((await handleCleanup(req("Bearer wrong"), { store: memoryStore(), secret: "s3cr3t" })).status).toBe(404);
    expect((await handleCleanup(req("Bearer s3cr3t"), { store: memoryStore() })).status).toBe(404);
  });

  it("sweeps with the secret", async () => {
    const store = memoryStore(new Map([["uploads/u-old/book.json", Date.now() - 40 * DAY_MS]]));
    await store.saveJson("uploads/u-old/book.json", "{}");
    const res = await handleCleanup(req("Bearer s3cr3t"), { store, secret: "s3cr3t", imageStore: memoryStore() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", deleted: 1 });
  });
});
