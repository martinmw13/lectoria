import { describe, expect, test } from "vitest";
import { clampSize } from "./chat-panel";

describe("chat panel size", () => {
  test("clamps to bounds so the panel never covers the reader", () => {
    expect(clampSize(100, 100)).toEqual({ w: 320, h: 360 });
    expect(clampSize(5000, 5000).h).toBe(820);
    expect(clampSize(5000, 5000).w).toBeLessThanOrEqual(720);
    expect(clampSize(400.4, 500.6)).toEqual({ w: 400, h: 501 });
  });
});
