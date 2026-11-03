// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  applyReading,
  DEFAULT_READING,
  loadReading,
  parseReading,
  READING_KEY,
  READING_SCRIPT,
  saveReading,
  SIZE_STEPS,
  SPACING_STEPS,
} from "./reading-prefs";

const root = document.documentElement;

afterEach(() => {
  localStorage.clear();
  root.removeAttribute("style");
  root.removeAttribute("data-justify");
});

describe("parseReading", () => {
  it("falls back to the defaults for missing or broken values", () => {
    expect(parseReading(null)).toEqual(DEFAULT_READING);
    expect(parseReading("{nope")).toEqual(DEFAULT_READING);
    expect(parseReading('"x"')).toEqual(DEFAULT_READING);
    expect(parseReading('{"size":9,"spacing":-1,"justify":"yes"}')).toEqual(DEFAULT_READING);
    expect(parseReading('{"size":1.5}')).toEqual(DEFAULT_READING);
  });

  it("keeps valid steps and an explicit justify choice", () => {
    expect(parseReading('{"size":3,"spacing":0,"justify":false}')).toEqual({
      size: 3,
      spacing: 0,
      justify: false,
    });
  });
});

describe("applyReading", () => {
  it("sets the scale, leading and justify on <html>, and clears justify for the skin default", () => {
    applyReading({ size: 3, spacing: 2, justify: true });
    expect(root.style.getPropertyValue("--read-scale")).toBe(String(SIZE_STEPS[3]));
    expect(root.style.getPropertyValue("--read-leading")).toBe(String(SPACING_STEPS[2]));
    expect(root.getAttribute("data-justify")).toBe("on");
    applyReading(DEFAULT_READING);
    expect(root.style.getPropertyValue("--read-scale")).toBe("1");
    expect(root.hasAttribute("data-justify")).toBe(false);
  });

  it("round-trips through localStorage", () => {
    saveReading({ size: 0, spacing: 2, justify: false });
    expect(loadReading()).toEqual({ size: 0, spacing: 2, justify: false });
  });
});

describe("READING_SCRIPT", () => {
  const run = () => new Function(READING_SCRIPT)();

  it("applies stored prefs before paint, matching applyReading", () => {
    localStorage.setItem(READING_KEY, JSON.stringify({ size: 2, spacing: 0, justify: false }));
    run();
    expect(root.style.getPropertyValue("--read-scale")).toBe(String(SIZE_STEPS[2]));
    expect(root.style.getPropertyValue("--read-leading")).toBe(String(SPACING_STEPS[0]));
    expect(root.getAttribute("data-justify")).toBe("off");
  });

  it("leaves the page alone for nothing stored or garbage", () => {
    run();
    localStorage.setItem(READING_KEY, "{broken");
    expect(run).not.toThrow();
    localStorage.setItem(READING_KEY, JSON.stringify({ size: 99, justify: "x" }));
    run();
    expect(root.getAttribute("style")).toBeNull();
    expect(root.hasAttribute("data-justify")).toBe(false);
  });
});
