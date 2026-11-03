import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MSG_CREDITS_OUT } from "@/core/images";
import { spendKey } from "@/server/guard/spend";
import { MetaImageError } from "./meta";
import { orchestrate } from "./orchestrate";
import { deps, passage } from "./orchestrate-fixtures";

// Our Meta key out of credit shows the credits-out copy (the BYOK state),
// with spend released; policy refusals and reader keys stay as they were.

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function failing(e: Error) {
  return { generate: async (): Promise<Uint8Array> => Promise.reject(e) };
}

describe("orchestrate when Meta credit runs out", () => {
  for (const status of [401, 402, 403]) {
    it(`maps ${status} on our key to the credits-out message`, async () => {
      const d = deps({ generate: failing(new MetaImageError(status, "code=insufficient_balance")) });
      const res = await orchestrate(passage, d);
      expect(res).toEqual({ status: "error", code: "budget", message: MSG_CREDITS_OUT });
      expect(Number(await d.kv.get(spendKey()))).toBe(0);
    });
  }

  it("maps a 429 that names credit, not a plain rate limit", async () => {
    const credit = await orchestrate(passage, deps({ generate: failing(new MetaImageError(429, "type=billing")) }));
    expect(credit).toMatchObject({ code: "budget" });
    const plain = await orchestrate(passage, deps({ generate: failing(new MetaImageError(429, "rate limited")) }));
    expect(plain).toMatchObject({ code: "unavailable" });
  });

  it("keeps policy refusals and reader keys off the credits path", async () => {
    const policy = await orchestrate(
      passage,
      deps({ generate: failing(new MetaImageError(403, "code=content_policy_violation")) }),
    );
    expect(policy).toMatchObject({ code: "unavailable" });
    const reader = await orchestrate(passage, { ...deps({ generate: failing(new MetaImageError(401, "")) }), byok: true });
    expect(reader).toMatchObject({ code: "unavailable" });
  });
});
