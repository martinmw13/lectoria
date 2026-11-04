// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { continueHref, loadAllProgress, PROGRESS_KEY, PROGRESS_MAX, saveProgress } from "./reading-progress";

afterEach(() => localStorage.clear());

const at = (n: number) => ({
  sceneId: `c1s${n}`,
  index: n,
  total: 40,
  at: 1000 + n,
});

describe("reading progress", () => {
  it("saves the last scene per book and links back to it", () => {
    saveProgress("oz", at(3));
    saveProgress("oz", at(5));
    saveProgress("alice", at(2));
    expect(continueHref("oz")).toBe("/read/oz/c1s5");
    expect(continueHref("alice")).toBe("/read/alice/c1s2");
  });

  it("offers no continue link for the first scene or an unread book", () => {
    saveProgress("oz", at(0));
    expect(continueHref("oz")).toBeNull();
    expect(continueHref("dracula")).toBeNull();
  });

  it("ignores bad ids and tampered storage", () => {
    saveProgress("../x", at(2));
    saveProgress("oz", { ...at(2), sceneId: "c1s2/../../api" });
    expect(loadAllProgress()).toEqual({});
    localStorage.setItem(
      PROGRESS_KEY,
      JSON.stringify({
        oz: { sceneId: "javascript:x", index: 3 },
        "a b": at(2),
      }),
    );
    expect(loadAllProgress()).toEqual({});
    localStorage.setItem(PROGRESS_KEY, "{broken");
    expect(continueHref("oz")).toBeNull();
  });

  it("keeps only the most recent books", () => {
    for (let i = 0; i < PROGRESS_MAX + 5; i++) saveProgress(`b${i}`, { ...at(1), at: i });
    const all = loadAllProgress();
    expect(Object.keys(all)).toHaveLength(PROGRESS_MAX);
    expect(all.b0).toBeUndefined();
    expect(all[`b${PROGRESS_MAX + 4}`]).toBeDefined();
  });
});
