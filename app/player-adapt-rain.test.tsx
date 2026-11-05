// @vitest-environment jsdom
// Regression guard: the music must follow a scene's mood within ~2 s
// even with the storm rain loop on. Rain is its own Web Audio layer and
// must never hold the music track, delay a switch, or stretch the fade.
// (A localhost build without 6abda28 had a 5 s entry dwell, a 45 s
// minimum track and a 3 s fade, which read as "the rain blocks it".)
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MUSIC_CONFIG } from "@/core/music";
import type { Track } from "@/core/music";
import { AMBIENCE_PREFS_KEY } from "./ambience-prefs";
import { Player } from "./player";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SUSPENSE = { id: "suspense", src: "/music/suspense.webm", startSec: 0, title: "S", loop: true, emotion: "suspenso" } as unknown as Track;
const COMBAT = { id: "combat", src: "/music/combat.webm", startSec: 0, title: "C", loop: true, emotion: "combate" } as unknown as Track;
const noop = () => undefined;

// Web Audio fake: enough for the rain engine to start a storm loop.
class FakeNode {
  gain = { value: 0, setValueAtTime: noop, linearRampToValueAtTime: noop, setTargetAtTime: noop, cancelScheduledValues: noop };
  buffer: unknown = null;
  loop = false;
  connect() {
    return this;
  }
  disconnect() {}
  start() {}
  stop() {}
}
class FakeAudioContext {
  state = "running";
  currentTime = 0;
  destination = new FakeNode();
  resume() {
    return Promise.resolve();
  }
  createGain() {
    return new FakeNode();
  }
  createBufferSource() {
    return new FakeNode();
  }
  decodeAudioData() {
    return Promise.resolve({});
  }
}

let frames: FrameRequestCallback[] = [];
let clock = 0;
let play: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  frames = [];
  clock = 0;
  localStorage.setItem(AMBIENCE_PREFS_KEY, JSON.stringify({ level: "storm", volume: 0.8 }));
  vi.stubGlobal("AudioContext", FakeAudioContext);
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
  vi.stubGlobal("cancelAnimationFrame", noop);
  vi.spyOn(performance, "now").mockImplementation(() => clock);
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

function advance(ms: number) {
  clock += ms;
  const run = frames;
  frames = [];
  for (const cb of run) cb(clock);
}

test("6abda28's fast-adapt settings are the ones in force", () => {
  expect(MUSIC_CONFIG.sceneEntryDwellSec).toBeLessThanOrEqual(1);
  expect(MUSIC_CONFIG.minTrackSec).toBeLessThanOrEqual(4);
  expect(MUSIC_CONFIG.crossfadeSec).toBeLessThanOrEqual(2);
});

test("with the storm loop on, a mood change starts the new track at once and finishes its fade within 2 s", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = (track: Track) =>
    act(async () => {
      root.render(
        <Player
          track={track}
          replayNonce={0}
          fadeSec={MUSIC_CONFIG.crossfadeSec}
          canPrev={false}
          onPrev={noop}
          canSkip={false}
          onSkip={noop}
          volume={0.8}
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
  await render(SUSPENSE);
  // A gesture starts the stored storm loop, as on a real page.
  await act(async () => {
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });
  expect(host.querySelector(".rain-group button")?.getAttribute("aria-label")).toBe("Rain: storm");
  expect(host.querySelector("button.play")?.getAttribute("aria-label")).toBe("Pause");
  play.mockClear();

  await render(COMBAT);
  // The combat track is asked to play in the same commit: no hold.
  const started = play.mock.contexts.map((el: unknown) => (el as HTMLAudioElement).getAttribute("src"));
  expect(started).toContain(COMBAT.src);
  const [a, b] = [...host.querySelectorAll<HTMLAudioElement>(".player audio")];
  const combatEl = a!.getAttribute("src") === COMBAT.src ? a! : b!;
  const suspenseEl = combatEl === a ? b! : a!;

  // Step the crossfade clock to 2 s: the new track is at full level and
  // the old one is silent.
  act(() => advance(0));
  for (let t = 0; t < 2000; t += 100) act(() => advance(100));
  expect(combatEl.volume).toBeCloseTo(0.8, 2);
  expect(suspenseEl.volume).toBeCloseTo(0, 2);
  act(() => root.unmount());
});
