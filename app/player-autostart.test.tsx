// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Player } from "./player";
import { MUSIC_INTENT_TTL_MS, takeAutostartIntent, unlockMusicFromGesture } from "./player-autostart";
import { DEFAULT_VOLUME, MUSIC_PREFS_KEY } from "./music-prefs";
import type { Track } from "@/core/music";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const blocked = () => Promise.reject(Object.assign(new Error("no gesture"), { name: "NotAllowedError" }));
const T1 = { id: "t1", src: "/music/t1.m4a", startSec: 0, title: "T1", loop: true } as unknown as Track;
const noop = () => undefined;
// jsdom has no Web Audio; the rain button unlocks it on the first gesture.
class FakeAudioContext {
  resume() {
    return Promise.resolve();
  }
}
let play: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", noop);
  vi.stubGlobal("AudioContext", FakeAudioContext);
  play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(noop);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = "";
});

async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <Player
        track={T1}
        replayNonce={0}
        fadeSec={2}
        canPrev={false}
        onPrev={noop}
        canSkip={false}
        onSkip={noop}
        volume={0.5}
        muted={false}
        onVolumeChange={noop}
        onMutedChange={noop}
        modes={[]}
        current={null}
        onAdvance={noop}
        onEnded={noop}
        playlistOn={false}
      />,
    );
  });
  const button = host.querySelector<HTMLButtonElement>("button.play")!;
  return { button, root, host };
}

test("music starts on load without a press", async () => {
  const { button } = await mount();
  expect(play).toHaveBeenCalledTimes(1);
  expect(button.getAttribute("aria-label")).toBe("Pause");
});

test("blocked autoplay starts on the first gesture, once", async () => {
  play.mockImplementationOnce(blocked);
  const { button } = await mount();
  expect(button.getAttribute("aria-label")).toBe("Play");
  await act(async () => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
  });
  expect(play).toHaveBeenCalledTimes(2);
  expect(button.getAttribute("aria-label")).toBe("Pause");
  await act(async () => {
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });
  expect(play).toHaveBeenCalledTimes(2);
});

test("a first press on the rain button starts blocked music", async () => {
  play.mockImplementationOnce(blocked);
  const { button, host } = await mount();
  expect(button.getAttribute("aria-label")).toBe("Play");
  const rain = host.querySelector(".rain-group button")!;
  await act(async () => {
    rain.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });
  expect(play).toHaveBeenCalledTimes(2);
  expect(button.getAttribute("aria-label")).toBe("Pause");
});

test("a press on Play itself leaves the gesture armed for its click", async () => {
  play.mockImplementationOnce(blocked);
  const { button } = await mount();
  await act(async () => {
    button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });
  expect(play).toHaveBeenCalledTimes(1);
  await act(async () => {
    button.click();
  });
  expect(button.getAttribute("aria-label")).toBe("Pause");
  expect(play).toHaveBeenCalledTimes(2);
  await act(async () => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
  });
  expect(play).toHaveBeenCalledTimes(2);
});

test("an explicit pause is remembered and prevents the next auto-start", async () => {
  const first = await mount();
  await act(async () => first.button.click());
  expect(first.button.getAttribute("aria-label")).toBe("Play");
  await act(async () => first.root.unmount());
  play.mockClear();

  const second = await mount();
  expect(play).not.toHaveBeenCalled();
  expect(second.button.getAttribute("aria-label")).toBe("Play");
});

test("the Start reading click unlocks audio with a silent play, even after a pause", async () => {
  localStorage.setItem("lectoria.music.paused", "1");
  expect(unlockMusicFromGesture()).toBe(true);
  expect(play).toHaveBeenCalledTimes(1);
  expect((play.mock.contexts[0] as HTMLAudioElement).src).toMatch(/^data:audio\/wav/);
  expect(localStorage.getItem("lectoria.music.paused")).toBeNull();
});

test("Start reading turns a stored mute or zero volume back on, keeping the rest", () => {
  localStorage.setItem(
    MUSIC_PREFS_KEY,
    JSON.stringify({ style: "film", volume: 0, muted: true, playlist: true }),
  );
  unlockMusicFromGesture();
  const stored = JSON.parse(localStorage.getItem(MUSIC_PREFS_KEY)!);
  expect(stored).toMatchObject({ style: "film", muted: false, volume: DEFAULT_VOLUME, playlist: true });
});

test("Start reading keeps a stored non-zero volume", () => {
  localStorage.setItem(MUSIC_PREFS_KEY, JSON.stringify({ style: null, volume: 0.3, muted: true, playlist: false }));
  unlockMusicFromGesture();
  expect(JSON.parse(localStorage.getItem(MUSIC_PREFS_KEY)!)).toMatchObject({ muted: false, volume: 0.3 });
});

test("music starts after Start reading even when it was paused before", async () => {
  const first = await mount();
  await act(async () => first.button.click());
  await act(async () => first.root.unmount());
  play.mockClear();

  unlockMusicFromGesture();
  play.mockClear();
  const second = await mount();
  expect(play).toHaveBeenCalledTimes(1);
  expect(second.button.getAttribute("aria-label")).toBe("Pause");
});

test("the intent survives a blocked autoplay: the first gesture in the reader starts music", async () => {
  unlockMusicFromGesture();
  play.mockClear();
  play.mockImplementationOnce(blocked);
  const { button } = await mount();
  expect(button.getAttribute("aria-label")).toBe("Play");
  await act(async () => {
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });
  expect(play).toHaveBeenCalledTimes(2);
  expect(button.getAttribute("aria-label")).toBe("Pause");
});

test("the autostart intent is read once and expires", () => {
  unlockMusicFromGesture(1_000);
  expect(takeAutostartIntent(1_500)).toBe(true);
  expect(takeAutostartIntent(1_600)).toBe(false);
  unlockMusicFromGesture(1_000);
  expect(takeAutostartIntent(1_000 + MUSIC_INTENT_TTL_MS + 1)).toBe(false);
});

test("a pause in the reader still sticks for a plain reload (no Start reading)", async () => {
  const first = await mount();
  await act(async () => first.button.click());
  await act(async () => first.root.unmount());
  play.mockClear();
  sessionStorage.clear();
  const second = await mount();
  expect(play).not.toHaveBeenCalled();
  expect(second.button.getAttribute("aria-label")).toBe("Play");
});

test("a refused unlock fails silently", async () => {
  play.mockImplementationOnce(blocked);
  expect(() => unlockMusicFromGesture()).not.toThrow();
  await Promise.resolve();
});
