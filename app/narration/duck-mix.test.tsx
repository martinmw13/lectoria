// @vitest-environment jsdom
// Narration ducks music and rain under their sliders; it never pauses,
// stops, or starts either one.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Track } from "@/core/music";
import { AmbienceController } from "../ambience-controller";
import type { AmbienceEngine, AmbienceVoice } from "../ambience-controller";
import { Player } from "../player";
import { AMBIENCE_DUCK_DB, MUSIC_DUCK_DB, duckTarget } from "./duck";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const T1 = { id: "t1", src: "/music/t1.m4a", startSec: 0, title: "T1", loop: true } as unknown as Track;
const noop = () => undefined;
const db = (ratio: number) => 20 * Math.log10(ratio);
let pause: ReturnType<typeof vi.spyOn>;
let play: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", noop);
  play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(noop);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function mountPlayer() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = (duck: number) =>
    act(async () => {
      root.render(
        <Player
          track={T1}
          replayNonce={0}
          fadeSec={2}
          canPrev={false}
          onPrev={noop}
          canSkip={false}
          onSkip={noop}
          volume={0.6}
          muted={false}
          onVolumeChange={noop}
          onMutedChange={noop}
          modes={[]}
          current={null}
          onAdvance={noop}
          onEnded={noop}
          playlistOn={false}
          duck={duck}
        />,
      );
    });
  await render(1);
  const audios = [...host.querySelectorAll("audio")];
  const audio = { get volume() { return Math.max(...audios.map((a) => a.volume)); } };
  const click = () => act(async () => host.querySelector<HTMLButtonElement>("button.play")!.click());
  return { audio, render, click };
}

test("narration start does not pause music and lowers its gain", async () => {
  const { audio, render, click } = await mountPlayer();
  await click();
  const full = audio.volume;
  expect(full).toBeCloseTo(0.6, 5);
  pause.mockClear();

  await render(duckTarget(true, MUSIC_DUCK_DB));
  expect(pause).not.toHaveBeenCalled();
  expect(db(audio.volume / full)).toBeCloseTo(-MUSIC_DUCK_DB, 1);
  expect(audio.volume).toBeLessThan(full);

  await render(duckTarget(false, MUSIC_DUCK_DB));
  expect(audio.volume).toBeCloseTo(full, 5);
});

test("narration never starts music the user paused", async () => {
  const { render, click } = await mountPlayer();
  await click();
  await click();
  play.mockClear();
  await render(duckTarget(true, MUSIC_DUCK_DB));
  await render(duckTarget(false, MUSIC_DUCK_DB));
  expect(play).not.toHaveBeenCalled();
});

function fakeEngine() {
  const voices: Array<AmbienceVoice & { ramps: number[]; stops: number }> = [];
  const engine: AmbienceEngine = {
    load: () => Promise.resolve("handle"),
    start: (_handle, gain) => {
      const voice = {
        ramps: [gain],
        stops: 0,
        ramp: (g: number) => void voice.ramps.push(g),
        stop: () => void (voice.stops += 1),
      };
      voices.push(voice);
      return voice;
    },
    unlock: () => Promise.resolve(),
  };
  return { engine, voices };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("narration keeps rain playing about 6 dB lower, then restores it", async () => {
  const { engine, voices } = fakeEngine();
  const rain = new AmbienceController(engine);
  rain.setLevel("drizzle");
  await rain.unlock();
  await tick();
  const voice = voices[0]!;
  const full = voice.ramps[0]!;

  rain.setDuck(duckTarget(true, AMBIENCE_DUCK_DB));
  expect(voice.stops).toBe(0);
  expect(db(voice.ramps.at(-1)! / full)).toBeCloseTo(-AMBIENCE_DUCK_DB, 1);

  rain.setDuck(duckTarget(false, AMBIENCE_DUCK_DB));
  expect(voice.ramps.at(-1)).toBeCloseTo(full, 5);
  expect(voices).toHaveLength(1);
});

test("narration never turns rain on when it is off", async () => {
  const { engine, voices } = fakeEngine();
  const rain = new AmbienceController(engine);
  await rain.unlock();
  rain.setDuck(duckTarget(true, AMBIENCE_DUCK_DB));
  rain.setDuck(duckTarget(false, AMBIENCE_DUCK_DB));
  await tick();
  expect(voices).toHaveLength(0);
});
