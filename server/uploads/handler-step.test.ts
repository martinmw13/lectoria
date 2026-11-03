import { describe, expect, it } from "vitest";
import type { AnalyzedScene } from "@/core/types";
import { uploadDailySpendKey } from "@/core/uploads";
import { bookQuotaKeysFor } from "@/server/guard/quota";
import { spendKey } from "@/server/guard/spend";
import { handleUploadStep, handleUploadsCreate } from "./handler";
import { saveUploadJob, parseUploadJob, uploadFinalizeKey, UPLOAD_FINALIZE_LEASE_SEC } from "./state";
import {
  cookiesFrom,
  createMemoryKV,
  helpfulMeta,
  memoryStore,
  postRequest,
  scriptedJev,
  scriptedMeta,
  testEnv,
  tinyBook,
} from "./test-support";

const DAY = "2026-10-30";
const CREATE_URL = "https://lectoria.test/api/uploads";
const stepUrl = (id: string): string => `https://lectoria.test/api/uploads/${id}/step`;

interface Flow {
  id: string;
  cookies: string;
  kv: ReturnType<typeof createMemoryKV>;
  store: ReturnType<typeof memoryStore>;
  meta: ReturnType<typeof helpfulMeta>;
}

async function createFlow(over: { key?: string; meta?: ReturnType<typeof helpfulMeta> } = {}): Promise<Flow> {
  const kv = createMemoryKV();
  const store = memoryStore();
  const meta = over.meta ?? helpfulMeta();
  const headers: Record<string, string> = { "x-real-ip": "1.2.3.4" };
  if (over.key) headers["x-byok-key"] = over.key;
  const res = await handleUploadsCreate(postRequest(CREATE_URL, tinyBook(), headers), {
    env: testEnv(),
    kv,
    store,
    meta,
    now: new Date(`${DAY}T00:00:00Z`),
  });
  expect(res.status).toBe(200);
  const json = (await res.json()) as { id: string };
  return { id: json.id, cookies: cookiesFrom(res), kv, store, meta };
}

async function drive(flow: Flow, body: unknown = {}, deps: Record<string, unknown> = {}): Promise<Response> {
  return handleUploadStep(postRequest(stepUrl(flow.id), body, { cookie: flow.cookies, "x-real-ip": "1.2.3.4" }), flow.id, {
    env: testEnv(),
    kv: flow.kv,
    store: flow.store,
    meta: flow.meta,
    now: new Date(`${DAY}T00:00:00Z`),
    ...deps,
  });
}

function anonIdOf(cookies: string): string {
  const m = /img_anon=([^;]+)/.exec(cookies);
  return (m?.[1] ?? "").split(".")[0] ?? "";
}

function quotaOf(flow: Flow): { ip: string; anon: string } {
  return bookQuotaKeysFor({ day: DAY, ip: "1.2.3.4", salt: "ip-salt-for-tests", anonId: anonIdOf(flow.cookies) });
}

describe("step guards", () => {
  it("rejects bad ids and cross-site posts", async () => {
    const flow = await createFlow();
    const badId = await handleUploadStep(postRequest(stepUrl("nope"), {}), "u-nope", {
      env: testEnv(),
      kv: flow.kv,
      store: flow.store,
      meta: flow.meta,
    });
    expect(badId.status).toBe(404);
    const plain = new Request(stepUrl(flow.id), {
      method: "POST",
      headers: { "content-type": "text/plain", cookie: flow.cookies },
      body: "{}",
    });
    const res = await handleUploadStep(plain, flow.id, {
      env: testEnv(),
      kv: flow.kv,
      store: flow.store,
      meta: flow.meta,
    });
    expect(res.status).toBe(400);
  });

  it("hides free jobs from other browsers", async () => {
    const flow = await createFlow();
    const res = await handleUploadStep(postRequest(stepUrl(flow.id), {}, { "x-real-ip": "9.9.9.9" }), flow.id, {
      env: testEnv(),
      kv: flow.kv,
      store: flow.store,
      meta: flow.meta,
    });
    expect(res.status).toBe(404);
    expect(flow.meta.calls.length).toBe(1); // judge only, no segment work
  });

  it("rejects unknown chapters", async () => {
    const flow = await createFlow();
    const res = await drive(flow, { chapter: 99 });
    expect(res.status).toBe(400);
  });

  it("refuses expired jobs", async () => {
    const flow = await createFlow();
    const job = parseUploadJob(await flow.kv.get(`upload:job:${flow.id}`));
    expect(job).not.toBeNull();
    await saveUploadJob(flow.kv, { ...job!, createdAt: Date.now() - 31 * 24 * 3600 * 1000 });
    const res = await drive(flow);
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual(expect.objectContaining({ code: "expired" }));
  });
});

describe("step happy path", () => {
  it("drives two parts to done and reconciles spend", async () => {
    const flow = await createFlow();
    const first = await drive(flow);
    expect(await first.json()).toEqual({ status: "working", id: flow.id, done: 1, total: 2 });
    const second = await drive(flow);
    const done = (await second.json()) as { status: string; costUsd: number; done: number; total: number };
    expect(done.status).toBe("done");
    expect(done.done).toBe(2);
    expect(typeof done.costUsd).toBe("number");
    expect(done.costUsd).toBeGreaterThan(0);
    // Reserve reconciled to the real cost on both counters.
    const total = Number(await flow.kv.get(spendKey()));
    expect(total).toBe(Math.round(done.costUsd * 1_000_000));
    expect(await flow.kv.get(uploadDailySpendKey(DAY))).toBe(String(total));
    const analysis = flow.store.files.get(`uploads/${flow.id}/analysis.json`);
    expect(analysis).toBeDefined();
    const scenes = (JSON.parse(analysis as string) as { scenes: AnalyzedScene[] }).scenes;
    expect(scenes.map((s) => s.id)).toEqual(["c1s1", "c2s1"]);
    for (const scene of scenes) {
      expect(scene.final).not.toBeNull();
      expect(Object.keys(scene.final?.vector ?? {}).sort()).toEqual(
        ["alegria", "asombro", "aventura", "calma", "combate", "misterio", "suspenso", "tristeza"],
      );
    }
  });

  it("re-calling a finished job costs nothing", async () => {
    const flow = await createFlow();
    await drive(flow);
    await drive(flow);
    const calls = flow.meta.calls.length;
    const again = await drive(flow);
    expect((await again.json()).status).toBe("done");
    expect(flow.meta.calls.length).toBe(calls);
  });

  it("yields when another driver holds the part lock", async () => {
    const flow = await createFlow();
    await flow.kv.setNxEx(`upload:lock:${flow.id}:ch1p1`, "other-driver", 120);
    const before = flow.meta.calls.length;
    const res = await drive(flow, { chapter: 1 });
    expect(await res.json()).toEqual({ status: "working", id: flow.id, done: 0, total: 2 });
    expect(flow.meta.calls.length).toBe(before);
  });

  it("re-driving a finished chapter costs nothing", async () => {
    const flow = await createFlow();
    await drive(flow, { chapter: 1 });
    const calls = flow.meta.calls.length;
    const again = await drive(flow, { chapter: 1 });
    expect(await again.json()).toEqual({ status: "working", id: flow.id, done: 1, total: 2 });
    expect(flow.meta.calls.length).toBe(calls);
  });
});

describe("step failures", () => {
  it("keeps what was spent when segments stay invalid, exactly once", async () => {
    const meta = scriptedMeta((call) => {
      if (call.schemaName === "clean_judge") return { sections: [], headCut: 0, tailCut: 0 };
      return { scenes: [{ start_n: 999, end_n: 1000, title: "x", summary: "y", characters: [] }] };
    });
    const flow = await createFlow({ meta: meta as ReturnType<typeof helpfulMeta> });
    const res = await drive(flow);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual(expect.objectContaining({ code: "unavailable" }));
    // Judge plus two failed segment attempts stay on both counters...
    expect(await flow.kv.get(spendKey())).toBe("331");
    expect(await flow.kv.get(uploadDailySpendKey(DAY))).toBe("331");
    // ...and the book quota stays taken, so failures cannot farm quota.
    expect(await flow.kv.get(quotaOf(flow).ip)).toBe("1");
    // A second drive sees the failed job and adjusts nothing more.
    const retry = await drive(flow);
    expect(retry.status).toBe(503);
    expect(await flow.kv.get(spendKey())).toBe("331");
  });

  it("keeps the judge cost when Meta itself fails", async () => {
    const meta = scriptedMeta((call) => {
      if (call.schemaName === "clean_judge") return { sections: [], headCut: 0, tailCut: 0 };
      throw new Error("meta down");
    });
    const flow = await createFlow({ meta: meta as ReturnType<typeof helpfulMeta> });
    const res = await drive(flow);
    expect(res.status).toBe(503);
    expect(await flow.kv.get(spendKey())).toBe("110");
    expect(await flow.kv.get(uploadDailySpendKey(DAY))).toBe("110");
    expect(await flow.kv.get(quotaOf(flow).ip)).toBe("1");
  });

  it("refunds quota when the failure spent nothing", async () => {
    const meta = scriptedMeta(() => {
      throw new Error("meta down");
    });
    const flow = await createFlow({ meta: meta as ReturnType<typeof helpfulMeta> });
    // Fail the book read so the step dies before any model call.
    const real = flow.store.readText.bind(flow.store);
    flow.store.readText = async (path: string) => {
      if (path.endsWith("book.json")) throw new Error("blob down");
      return real(path);
    };
    const res = await drive(flow);
    expect(res.status).toBe(503);
    expect(await flow.kv.get(spendKey())).toBe("0");
    expect(await flow.kv.get(uploadDailySpendKey(DAY))).toBe("0");
    expect(await flow.kv.get(quotaOf(flow).ip)).toBe("0");
    expect(await flow.kv.get(quotaOf(flow).anon)).toBe("0");
  });

  it("accepts a fresh human proof on the step", async () => {
    const flow = await createFlow();
    const res = await handleUploadStep(
      postRequest(stepUrl(flow.id), { turnstileToken: "tok" }, { cookie: flow.cookies, "x-real-ip": "1.2.3.4" }),
      flow.id,
      {
        env: testEnv({ turnstileSecret: "ts-secret", turnstileSiteKey: "ts-site" }),
        kv: flow.kv,
        store: flow.store,
        meta: flow.meta,
        fetchFn: (async () =>
          new Response(JSON.stringify({ success: true }), { status: 200 })) as typeof fetch,
      },
    );
    expect((await res.json()).status).toBe("working");
  });

  it("clamps out-of-range model values instead of failing", async () => {
    const meta = scriptedMeta((call) => {
      if (call.schemaName === "clean_judge") return { sections: [], headCut: 0, tailCut: 0 };
      if (call.schemaName === "chapter_scenes") {
        const m = /first start_n is (\d+), last end_n is (\d+)/.exec(call.user);
        return {
          scenes: [{ start_n: Number(m?.[1]), end_n: Number(m?.[2]), title: "t".repeat(500), summary: "s", characters: ["c".repeat(500)] }],
        };
      }
      return {
        vector: { calma: 2, alegria: -1, tristeza: 0, suspenso: 0, misterio: 0, aventura: 0, combate: 0, asombro: 0 },
        intensity: 5,
        tempo: -2,
        reason: "r".repeat(500),
      };
    });
    const flow = await createFlow({ meta: meta as ReturnType<typeof helpfulMeta> });
    await drive(flow);
    const done = await drive(flow);
    expect((await done.json()).status).toBe("done");
    const scenes = (JSON.parse(flow.store.files.get(`uploads/${flow.id}/analysis.json`) as string) as { scenes: AnalyzedScene[] }).scenes;
    expect(scenes[0]?.final?.vector.calma).toBe(1);
    expect(scenes[0]?.final?.intensity).toBe(1);
    expect(scenes[0]?.final?.tempo).toBe(0);
    expect(scenes[0]?.title.length).toBeLessThanOrEqual(200);
  });

  it("keeps a null vector for a non-taxonomy emotion, never a fake", async () => {
    const meta = scriptedMeta((call) => {
      if (call.schemaName === "clean_judge") return { sections: [], headCut: 0, tailCut: 0 };
      if (call.schemaName === "chapter_scenes") {
        const m = /first start_n is (\d+), last end_n is (\d+)/.exec(call.user);
        return { scenes: [{ start_n: Number(m?.[1]), end_n: Number(m?.[2]), title: "S", summary: "s", characters: [] }] };
      }
      return { vector: { evil: 1 }, intensity: 0.5, tempo: 0.5, reason: "x" };
    });
    const flow = await createFlow({ meta: meta as ReturnType<typeof helpfulMeta> });
    await drive(flow);
    const done = await drive(flow);
    expect((await done.json()).status).toBe("done");
    const scenes = (JSON.parse(flow.store.files.get(`uploads/${flow.id}/analysis.json`) as string) as { scenes: AnalyzedScene[] }).scenes;
    expect(scenes[0]?.final).toBeNull();
    expect(scenes[0]?.error).toBe("direct vector invalid");
  });
});

describe("step emotion paths", () => {
  it("uses Jev with the override on low confidence", async () => {
    const flow = await createFlow();
    const jev = scriptedJev({ confidence: 0.1 });
    await drive(flow, {}, { jev });
    await drive(flow, {}, { jev });
    expect(jev.calls).toBe(2);
    expect(flow.meta.calls.some((c) => c.schemaName === "emotion_override")).toBe(true);
  });

  it("keeps BYOK on contributor-only emotion without our Jev key", async () => {
    const flow = await createFlow({ key: "byok-step-key-777" });
    const jev = scriptedJev();
    const step = (body: unknown = {}) =>
      handleUploadStep(postRequest(stepUrl(flow.id), body, { cookie: flow.cookies, "x-byok-key": "byok-step-key-777" }), flow.id, {
        env: testEnv({ jevKey: "server-jev-key" }),
        kv: flow.kv,
        store: flow.store,
        meta: flow.meta,
        jev,
      });
    await step();
    const done = await step();
    expect((await done.json()).status).toBe("done");
    expect(jev.calls).toBe(0);
    for (const write of flow.store.writes) {
      expect(write.json).not.toContain("byok-step-key-777");
    }
    expect(await flow.kv.get(`upload:job:${flow.id}`)).not.toContain("byok-step-key-777");
  });

  it("requires the key on every BYOK step", async () => {
    const flow = await createFlow({ key: "byok-step-key-888" });
    const res = await drive(flow);
    expect(res.status).toBe(400);
  });
});

describe("step concurrency", () => {
  it("loses no usage when two parts step in parallel", async () => {
    const flow = await createFlow();
    await Promise.all([drive(flow, { chapter: 1 }), drive(flow, { chapter: 2 })]);
    // The doneParts write may have raced; re-driving converges via the blobs.
    let status = "";
    for (let i = 0; i < 3 && status !== "done"; i++) {
      status = ((await (await drive(flow)).json()) as { status: string }).status;
    }
    expect(status).toBe("done");
    const job = parseUploadJob(await flow.kv.get(`upload:job:${flow.id}`));
    expect(job?.status).toBe("done");
    // Judge plus segment and classify per part, nothing lost to the race.
    expect(job?.usage.metaRequests).toBe(flow.meta.calls.length);
    expect(job?.usage.metaPrompt).toBe(flow.meta.calls.length * 1000);
    expect(job?.usage.metaCached).toBe(flow.meta.calls.length * 100);
    expect(job?.usage.metaCompletion).toBe(flow.meta.calls.length * 100);
    expect(Number(await flow.kv.get(spendKey()))).toBe(job?.costMicro);
  });

  it("retakes a stale finalize lease", async () => {
    expect(UPLOAD_FINALIZE_LEASE_SEC).toBe(150);
    const flow = await createFlow();
    await drive(flow);
    // A finalize killed at the route limit leaves its lease behind; once
    // the lease lapses the next driver finalizes instead of wedging the job.
    await flow.kv.setNxEx(uploadFinalizeKey(flow.id), "1", UPLOAD_FINALIZE_LEASE_SEC);
    await flow.kv.expire(uploadFinalizeKey(flow.id), 0);
    const done = await drive(flow);
    expect((await done.json()).status).toBe("done");
    const job = parseUploadJob(await flow.kv.get(`upload:job:${flow.id}`));
    expect(job?.status).toBe("done");
    expect(Number(await flow.kv.get(spendKey()))).toBe(job?.costMicro);
  });

  it("repairs spend when finalize died after the blob write", async () => {
    const flow = await createFlow();
    await drive(flow);
    // The winner wrote the analysis and died holding the lease while the
    // job was still working, so the next driver repairs from the blob.
    await flow.store.saveJson(
      `uploads/${flow.id}/analysis.json`,
      JSON.stringify({ bookId: flow.id, textVersion: "repair", scenes: [] }),
    );
    await flow.kv.setNxEx(uploadFinalizeKey(flow.id), "dead-winner", 90);
    const done = await drive(flow);
    const json = (await done.json()) as { status: string; costUsd: number };
    expect(json.status).toBe("done");
    const total = Number(await flow.kv.get(spendKey()));
    expect(total).toBe(Math.round(json.costUsd * 1_000_000));
    expect(await flow.kv.get(uploadDailySpendKey(DAY))).toBe(String(total));
    // Idempotent: a re-drive settles nothing more.
    await drive(flow);
    expect(Number(await flow.kv.get(spendKey()))).toBe(total);
  });
});
