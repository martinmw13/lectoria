// driveUpload: create -> steps -> done, BYOK header on every call,
// retries on network failure and uncoded 5xx, coded errors at once.
import { describe, expect, it, vi } from "vitest";
import { BYOK_HEADER } from "@/core/chat";
import type { RawSection } from "@/core/clean-types";
import { UPLOAD_MESSAGES, type UploadErrorCode } from "@/core/uploads";
import { driveUpload, IDLE_MS, STEP_RETRIES, UploadFlowError, type FlowProgress } from "./upload-flow";

const ID = "u-AAAAAAAAAAAAAAAAAAAAAA";
const SECTIONS = [
  {
    id: "s1",
    href: "s1.xhtml",
    linear: true,
    types: [],
    docTitle: null,
    navLabel: null,
    blocks: [{ text: "Once upon a time.", heading: false }],
  },
] as RawSection[];

type FetchMock = ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;

function mockFetch(
  impl?: (url: string, init?: RequestInit) => Promise<Response>,
): FetchMock {
  return vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(impl);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function error(code: UploadErrorCode, status: number): Response {
  return json({ status: "error", code, message: UPLOAD_MESSAGES[code] }, status);
}

async function drive(fetchFn: FetchMock, extra: Record<string, unknown> = {}) {
  const seen: FlowProgress[] = [];
  const out = await driveUpload({
    title: "Middlemarch",
    author: "George Eliot",
    sections: SECTIONS,
    key: null,
    token: null,
    jobId: null,
    fetchFn: fetchFn as unknown as typeof fetch,
    sleep: async () => {},
    onProgress: (p) => seen.push(p),
    ...extra,
  });
  return { out, seen };
}

async function driveError(fetchFn: FetchMock, extra: Record<string, unknown> = {}) {
  try {
    await drive(fetchFn, extra);
  } catch (err) {
    expect(err).toBeInstanceOf(UploadFlowError);
    return err as UploadFlowError;
  }
  throw new Error("expected driveUpload to throw");
}

describe("driveUpload", () => {
  it("creates, steps to done, and reports progress", async () => {
    const fetchFn = mockFetch();
    let steps = 0;
    fetchFn.mockImplementation(async (url: string) => {
      if (url === "/api/uploads") return json({ status: "created", id: ID, chapters: 2, parts: 2 });
      steps += 1;
      return steps === 1
        ? json({ status: "working", id: ID, done: 1, total: 2 })
        : json({ status: "done", id: ID, done: 2, total: 2, costUsd: 0.01 });
    });
    const { out, seen } = await drive(fetchFn);
    expect(out).toEqual({ id: ID, chapters: 2 });
    expect(seen).toEqual([
      { jobId: ID, done: 0, total: 2, chapters: 2 },
      { jobId: ID, done: 1, total: 2, chapters: 2 },
      { jobId: ID, done: 2, total: 2, chapters: 2 },
    ]);
    // Create posts title, author, sections; steps post an empty body.
    const [createUrl, createInit] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(createUrl).toBe("/api/uploads");
    expect(JSON.parse(createInit.body as string)).toEqual({
      title: "Middlemarch",
      author: "George Eliot",
      sections: SECTIONS,
    });
    const [stepUrl, stepInit] = fetchFn.mock.calls[1] as [string, RequestInit];
    expect(stepUrl).toBe(`/api/uploads/${ID}/step`);
    expect(JSON.parse(stepInit.body as string)).toEqual({});
  });

  it("sends the key in the header on every call, never in the body", async () => {
    const fetchFn = mockFetch(async (url: string) =>
      url === "/api/uploads"
        ? json({ status: "created", id: ID, chapters: 1, parts: 1 })
        : json({ status: "done", id: ID, done: 1, total: 1 }),
    );
    await drive(fetchFn, { key: "meta-test-key" });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchFn.mock.calls as [string, RequestInit][]) {
      const headers = init.headers as Record<string, string>;
      expect(headers[BYOK_HEADER]).toBe("meta-test-key");
      expect(init.body as string).not.toContain("meta-test-key");
    }
  });

  it("sends a friend code on create only when one is entered", async () => {
    const fetchFn = mockFetch(async (url: string) =>
      url === "/api/uploads"
        ? json({ status: "created", id: ID, chapters: 1, parts: 1 })
        : json({ status: "done", id: ID, done: 1, total: 1 }),
    );
    await drive(fetchFn, { friendCode: "maple" });
    const bodies = fetchFn.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
    expect(bodies[0]).toEqual(expect.objectContaining({ friendCode: "maple" }));
    expect(bodies.slice(1)).toEqual([{}]);
  });

  it("sends the human token once, on the first call", async () => {
    const fetchFn = mockFetch();
    let steps = 0;
    fetchFn.mockImplementation(async (url: string) => {
      if (url === "/api/uploads") return json({ status: "created", id: ID, chapters: 1, parts: 2 });
      steps += 1;
      return steps < 2
        ? json({ status: "working", id: ID, done: steps, total: 2 })
        : json({ status: "done", id: ID, done: 2, total: 2 });
    });
    await drive(fetchFn, { token: "human-token" });
    const bodies = fetchFn.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
    expect(bodies[0]).toEqual(expect.objectContaining({ turnstileToken: "human-token" }));
    expect(bodies.slice(1)).toEqual([{}, {}]);
  });

  it("resumes from a job id without recreating", async () => {
    const fetchFn = mockFetch(async () => json({ status: "done", id: ID, done: 4, total: 4 }));
    const { out, seen } = await drive(fetchFn, { jobId: ID });
    expect(out).toEqual({ id: ID, chapters: 0 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0]?.[0]).toBe(`/api/uploads/${ID}/step`);
    expect(seen).toEqual([{ jobId: ID, done: 4, total: 4, chapters: 0 }]);
  });

  it("retries a step on network failure, then succeeds", async () => {
    const fetchFn = mockFetch();
    let steps = 0;
    fetchFn.mockImplementation(async (url: string) => {
      if (url === "/api/uploads") return json({ status: "created", id: ID, chapters: 1, parts: 1 });
      steps += 1;
      if (steps < 3) throw new TypeError("fetch failed");
      return json({ status: "done", id: ID, done: 1, total: 1 });
    });
    const sleeps: number[] = [];
    const { out } = await drive(fetchFn, { sleep: async (ms: number) => void sleeps.push(ms) });
    expect(out.id).toBe(ID);
    expect(steps).toBe(3);
    expect(sleeps).toEqual([500, 1000]);
  });

  it("pauses when a step makes no progress, and not when it does", async () => {
    const answers = [1, 1, 1, 2];
    const fetchFn = mockFetch(async (url: string) => {
      if (url === "/api/uploads") return json({ status: "created", id: ID, chapters: 1, parts: 3 });
      const done = answers.shift() ?? 3;
      return json({ status: done === 3 ? "done" : "working", id: ID, done, total: 3 });
    });
    const sleeps: number[] = [];
    await drive(fetchFn, { sleep: async (ms: number) => void sleeps.push(ms) });
    // Two stalled answers at done=1 each wait; real progress loops at once.
    expect(sleeps).toEqual([IDLE_MS, IDLE_MS]);
  });

  it("retries an uncoded 503 the server sends for a passing failure", async () => {
    let steps = 0;
    const fetchFn = mockFetch(async (url: string) => {
      if (url === "/api/uploads") return json({ status: "created", id: ID, chapters: 1, parts: 1 });
      steps += 1;
      return steps === 1 ? json({ status: "retry" }, 503) : json({ status: "done", id: ID, done: 1, total: 1 });
    });
    const { out } = await drive(fetchFn);
    expect(out.id).toBe(ID);
    expect(steps).toBe(2);
  });

  it("gives up after three step retries with a network error", async () => {
    expect(STEP_RETRIES).toBe(3);
    const fetchFn = mockFetch(async (url: string) => {
      if (url === "/api/uploads") return json({ status: "created", id: ID, chapters: 1, parts: 1 });
      throw new TypeError("fetch failed");
    });
    const err = await driveError(fetchFn);
    expect(err.code).toBe("network");
    expect(err.jobId).toBe(ID);
    expect(fetchFn).toHaveBeenCalledTimes(1 + 1 + STEP_RETRIES);
  });

  it("retries an uncoded 5xx but surfaces coded ones at once", async () => {
    const plain500 = new Response("<html>killed</html>", { status: 500 });
    const fetchFn = mockFetch(async (url: string) => {
      if (url === "/api/uploads") return json({ status: "created", id: ID, chapters: 1, parts: 1 });
      return plain500.clone();
    });
    const err = await driveError(fetchFn);
    expect(err.code).toBe("network");
    expect(fetchFn).toHaveBeenCalledTimes(1 + 1 + STEP_RETRIES);

    const coded = mockFetch(async (url: string) => {
      if (url === "/api/uploads") return json({ status: "created", id: ID, chapters: 1, parts: 1 });
      return error("daily_budget_reached", 503);
    });
    const err2 = await driveError(coded);
    expect(err2.code).toBe("daily_budget_reached");
    expect(coded).toHaveBeenCalledTimes(2);
  });

  it("never retries create: one attempt, coded or network", async () => {
    const fetchFn = mockFetch(async () => error("daily_books_reached", 429));
    const err = await driveError(fetchFn);
    expect(err.code).toBe("daily_books_reached");
    expect(err.jobId).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const down = mockFetch(async () => {
      throw new TypeError("fetch failed");
    });
    const err2 = await driveError(down);
    expect(err2.code).toBe("network");
    expect(down).toHaveBeenCalledTimes(1);
  });

  it("maps every server code from create and step", async () => {
    const cases: [UploadErrorCode, number][] = [
      ["too_long", 413],
      ["daily_books_reached", 429],
      ["daily_budget_reached", 503],
      ["human_required", 403],
      ["bad_request", 400],
      ["unavailable", 503],
      ["not_found", 404],
      ["expired", 410],
    ];
    for (const [code, status] of cases) {
      const atCreate = mockFetch(async () => error(code, status));
      expect((await driveError(atCreate)).code).toBe(code);
      const atStep = mockFetch(async (url: string) =>
        url === "/api/uploads"
          ? json({ status: "created", id: ID, chapters: 1, parts: 1 })
          : error(code, status),
      );
      const err = await driveError(atStep);
      expect(err.code).toBe(code);
      expect(err.jobId).toBe(ID);
    }
  });

  it("rejects malformed bodies without hanging", async () => {
    const bad = [
      json({ status: "created", id: "nope", chapters: 1, parts: 1 }),
      json({ status: "created", id: ID, chapters: 1 }),
      json({ nonsense: true }),
      new Response("not json", { status: 200 }),
    ];
    for (const res of bad) {
      const fetchFn = mockFetch(async () => res.clone());
      const err = await driveError(fetchFn);
      expect(err.code).toBe("unavailable");
      expect(err.jobId).toBeNull();
    }
    const stepBad = mockFetch(async (url: string) =>
      url === "/api/uploads"
        ? json({ status: "created", id: ID, chapters: 1, parts: 1 })
        : json({ status: "working", id: ID, done: "x", total: 1 }),
    );
    expect((await driveError(stepBad)).code).toBe("unavailable");
  });

  it("an abort stops the drive without an UploadFlowError", async () => {
    const ctrl = new AbortController();
    const fetchFn = mockFetch(async (url: string) => {
      if (url === "/api/uploads") return json({ status: "created", id: ID, chapters: 1, parts: 2 });
      ctrl.abort();
      throw new DOMException("aborted", "AbortError");
    });
    await expect(
      drive(fetchFn, { signal: ctrl.signal, sleep: async () => {} }),
    ).rejects.toThrow("aborted");
  });

  it("surfaces friendAccepted true only on an exact true", async () => {
    const cases: [unknown, boolean][] = [
      [true, true],
      [false, false],
      ["yes", false],
      [1, false],
    ];
    for (const [value, want] of cases) {
      const fetchFn = mockFetch(async (url: string) =>
        url === "/api/uploads"
          ? json({ status: "created", id: ID, chapters: 1, parts: 1, friendAccepted: value })
          : json({ status: "done", id: ID, done: 1, total: 1 }),
      );
      const seen: boolean[] = [];
      await drive(fetchFn, { onFriendAccepted: (accepted: boolean) => void seen.push(accepted) });
      expect(seen).toEqual([want]);
    }
  });

  it("surfaces friendAccepted false when the field is missing", async () => {
    const fetchFn = mockFetch(async (url: string) =>
      url === "/api/uploads"
        ? json({ status: "created", id: ID, chapters: 1, parts: 1 })
        : json({ status: "done", id: ID, done: 1, total: 1 }),
    );
    const seen: boolean[] = [];
    await drive(fetchFn, { onFriendAccepted: (accepted: boolean) => void seen.push(accepted) });
    expect(seen).toEqual([false]);
  });
});
