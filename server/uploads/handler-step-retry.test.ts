import { describe, expect, it } from "vitest";
import { spendKey } from "@/server/guard/spend";
import { handleUploadStep, handleUploadsCreate } from "./handler";
import { parseUploadJob, UPLOAD_PART_ATTEMPTS, type UploadJob } from "./state";
import { cookiesFrom, createMemoryKV, helpfulMeta, memoryStore, postRequest, testEnv, tinyBook } from "./test-support";

// Passing upstream failures keep the job working and answer an uncoded
// 503 the client retries; only repeated failures of one part end the job.

const DAY = "2026-10-30";
const CREATE_URL = "https://lectoria.test/api/uploads";
const stepUrl = (id: string): string => `https://lectoria.test/api/uploads/${id}/step`;

type Meta = ReturnType<typeof helpfulMeta>;

interface Flow {
  id: string;
  cookies: string;
  kv: ReturnType<typeof createMemoryKV>;
  store: ReturnType<typeof memoryStore>;
  meta: Meta;
  headers: Record<string, string>;
}

function httpError(status: number, message = `meta http ${status}`): Error {
  return Object.assign(new Error(message), { status, retryable: false });
}

// Wraps the happy-path fake: `before` may throw or wait per call.
function wrapMeta(before: (schemaName: string) => Promise<void> | void): Meta {
  const good = helpfulMeta();
  return {
    calls: good.calls,
    model: good.model,
    async completeJson(input) {
      await before(input.schemaName);
      return good.completeJson(input);
    },
  } as Meta;
}

// Fails segment calls while `failing()` returns an error.
function flakyMeta(failing: () => Error | null): Meta {
  return wrapMeta((schemaName) => {
    if (schemaName !== "chapter_scenes") return;
    const err = failing();
    if (err) throw err;
  });
}

async function createFlow(meta: Meta, key?: string): Promise<Flow> {
  const kv = createMemoryKV();
  const store = memoryStore();
  const headers: Record<string, string> = { "x-real-ip": "1.2.3.4" };
  if (key) headers["x-byok-key"] = key;
  const res = await handleUploadsCreate(postRequest(CREATE_URL, tinyBook(), headers), {
    env: testEnv(),
    kv,
    store,
    meta,
    now: new Date(`${DAY}T00:00:00Z`),
  });
  expect(res.status).toBe(200);
  const json = (await res.json()) as { id: string };
  return { id: json.id, cookies: cookiesFrom(res), kv, store, meta, headers };
}

async function drive(flow: Flow, deps: Record<string, unknown> = {}): Promise<Response> {
  return handleUploadStep(postRequest(stepUrl(flow.id), {}, { cookie: flow.cookies, ...flow.headers }), flow.id, {
    env: testEnv(),
    kv: flow.kv,
    store: flow.store,
    meta: flow.meta,
    now: new Date(`${DAY}T00:00:00Z`),
    ...deps,
  });
}

async function jobOf(flow: Flow): Promise<UploadJob | null> {
  return parseUploadJob(await flow.kv.get(`upload:job:${flow.id}`));
}

async function driveToEnd(flow: Flow): Promise<Response> {
  for (let i = 0; i < 20; i++) {
    const res = await drive(flow);
    const body = (await res.clone().json()) as { status: string };
    if (body.status !== "working") return res;
  }
  throw new Error("upload never ended");
}

describe("step retries on passing upstream failures", () => {
  it("answers an uncoded 503, keeps the job working, and frees the part", async () => {
    let fails = 1;
    const flow = await createFlow(flakyMeta(() => (fails-- > 0 ? httpError(500) : null)));
    const res = await drive(flow);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "retry" });
    const job = await jobOf(flow);
    expect(job?.status).toBe("working");
    expect(Object.values(job?.partAttempts ?? {})).toEqual([1]);
    // The lock was released, so the retry runs the part and the book ends.
    const done = await driveToEnd(flow);
    expect((await done.json()).status).toBe("done");
    expect((await jobOf(flow))?.status).toBe("done");
  });

  it("treats timeouts and network errors as passing", async () => {
    const errors = [Object.assign(new Error("t"), { name: "TimeoutError" }), new TypeError("fetch failed")];
    const flow = await createFlow(flakyMeta(() => errors.shift() ?? null));
    expect((await drive(flow)).status).toBe(503);
    expect((await drive(flow)).status).toBe(503);
    expect((await jobOf(flow))?.status).toBe("working");
    expect((await (await driveToEnd(flow)).json()).status).toBe("done");
  });

  it(`fails the job after ${UPLOAD_PART_ATTEMPTS} tries of one part`, async () => {
    const flow = await createFlow(flakyMeta(() => httpError(503)));
    for (let i = 1; i < UPLOAD_PART_ATTEMPTS; i++) {
      const res = await drive(flow);
      expect(await res.json()).toEqual({ status: "retry" });
    }
    const last = await drive(flow);
    expect(last.status).toBe(503);
    expect(await last.json()).toEqual(expect.objectContaining({ status: "error", code: "unavailable" }));
    expect((await jobOf(flow))?.status).toBe("failed");
    // Settled once to the judge cost; nothing more on later drives.
    expect(await flow.kv.get(spendKey())).toBe("110");
    await drive(flow);
    expect(await flow.kv.get(spendKey())).toBe("110");
  });

  it("retries a step that ran past its deadline instead of saving it", async () => {
    const slow = wrapMeta(async (schemaName) => {
      if (schemaName !== "clean_judge") await new Promise((r) => setTimeout(r, 30));
    });
    const flow = await createFlow(slow);
    const res = await drive(flow, { stepDeadlineMs: 1 });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "retry" });
    const job = await jobOf(flow);
    expect(job?.status).toBe("working");
    expect(job?.doneParts).toEqual([]);
    // The model calls already made stay on the bill for the final settle.
    expect(job?.usage.metaRequests).toBeGreaterThan(0);
    expect((await (await driveToEnd(flow)).json()).status).toBe("done");
  });
});

describe("step when our Meta credit runs out", () => {
  it("answers daily_budget_reached and leaves the job to resume", async () => {
    let out = true;
    const flow = await createFlow(flakyMeta(() => (out ? httpError(402) : null)));
    for (let i = 0; i < UPLOAD_PART_ATTEMPTS + 1; i++) {
      const res = await drive(flow);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual(expect.objectContaining({ status: "error", code: "daily_budget_reached" }));
    }
    const job = await jobOf(flow);
    expect(job?.status).toBe("working");
    // Credit errors do not burn the part's tries.
    expect(Object.values(job?.partAttempts ?? {})).toEqual([0]);
    out = false;
    expect((await (await driveToEnd(flow)).json()).status).toBe("done");
  });

  it("maps a 429 that names credit to the same message", async () => {
    const flow = await createFlow(flakyMeta(() => httpError(429, "meta http 429 insufficient_quota credit")));
    expect(await (await drive(flow)).json()).toEqual(expect.objectContaining({ code: "daily_budget_reached" }));
  });

  it("does not blame our credit for a reader key's auth error", async () => {
    const flow = await createFlow(flakyMeta(() => httpError(401)), "reader-key-for-tests");
    const res = await drive(flow);
    expect(await res.json()).toEqual(expect.objectContaining({ status: "error", code: "unavailable" }));
    expect((await jobOf(flow))?.status).toBe("failed");
  });
});
