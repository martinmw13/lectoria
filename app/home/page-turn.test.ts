import { describe, expect, it } from "vitest";
import { turnFrame, type Point } from "./page-turn";

const area = (pts: Point[]) =>
  Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length] ?? p; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

describe("page turn geometry", () => {
  const W = 1440, H = 900;

  it("starts with the whole page down and ends with it turned away", () => {
    expect(area(turnFrame(0, W, H).keep)).toBeCloseTo(W * H, -2);
    expect(area(turnFrame(1, W, H).keep)).toBe(0);
  });

  it("lifts the bottom-right corner first", () => {
    const { flap, keep } = turnFrame(0.3, W, H);
    expect(flap.some(([x, y]) => x === W && y === H)).toBe(true);
    expect(keep.some(([x, y]) => x === 0 && y === 0)).toBe(true);
  });

  it("draws the back as the flap folded over, same size, and never shrinks the kept page back", () => {
    let last = Infinity;
    for (let t = 0; t <= 1; t += 0.05) {
      const fr = turnFrame(t, W, H);
      expect(area(fr.back)).toBeCloseTo(area(fr.flap), 3);
      expect(area(fr.keep) + area(fr.flap)).toBeCloseTo(W * H, -1);
      expect(area(fr.keep)).toBeLessThanOrEqual(last + 1);
      last = area(fr.keep);
    }
  });
});
