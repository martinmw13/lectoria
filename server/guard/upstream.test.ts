import { describe, expect, it } from "vitest";
import { upstreamKind } from "./upstream";

const withStatus = (status: number, message = "x") => Object.assign(new Error(message), { status });

describe("upstreamKind", () => {
  it("treats 402 and auth failures as credits", () => {
    expect(upstreamKind(withStatus(402))).toBe("credits");
    expect(upstreamKind(withStatus(401))).toBe("credits");
    expect(upstreamKind(withStatus(403))).toBe("credits");
    expect(upstreamKind(new Error("chat upstream 402"))).toBe("credits");
  });

  it("treats an insufficient-credit 429 as credits, a plain 429 as transient", () => {
    expect(upstreamKind(withStatus(429, "failed with status 429: insufficient_quota"))).toBe("credits");
    expect(upstreamKind(withStatus(429, "rate limited"))).toBe("transient");
  });

  it("treats 5xx, timeouts, network and retryable errors as transient", () => {
    expect(upstreamKind(withStatus(503))).toBe("transient");
    expect(upstreamKind(Object.assign(new Error("t"), { name: "TimeoutError" }))).toBe("transient");
    expect(upstreamKind(new TypeError("fetch failed"))).toBe("transient");
    expect(upstreamKind(Object.assign(new Error("empty"), { retryable: true }))).toBe("transient");
    expect(upstreamKind(new Error("chat upstream first timeout"))).toBe("transient");
  });

  it("leaves anything else fatal", () => {
    expect(upstreamKind(withStatus(400, "bad schema"))).toBe("fatal");
    expect(upstreamKind(new Error("upload segment failed"))).toBe("fatal");
    expect(upstreamKind("nope")).toBe("fatal");
  });
});
