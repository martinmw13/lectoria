# The frontend audio engine is a plain class, not a hook

`CrossfadeAudioPlayer` (`frontend/src/audio/crossfadePlayer.ts`) is a framework-free
TypeScript class — zero React imports — held in a `useRef` via a thin `useCrossfadeAudio`
hook, rather than being a hook itself. Its imperative core (the dual-track volume ramp, the
local→CDN load-with-fallback, play/pause/resume, teardown) is therefore unit-testable with a
fake `Audio` element and fake timers, with no React render. The engine **executes** crossfades
but never **decides** them: whether to crossfade stays a backend call (D12 hysteresis /
`should_crossfade`), which the component asks for via `checkCrossfade`.

## Considered options

- **A hook that owns the ramp (`useCrossfadeAudio` doing everything)** — the idiomatic React
  shape, but it drags React Testing Library and a render lifecycle into what is pure
  timer/volume math, and `<StrictMode>`'s effect double-invoke entangles the audio-element
  lifecycle with the test setup.
- **A plain class held in a `useRef`** (chosen) — the ramp, load-with-fallback, and teardown are
  tested directly against a fake `Audio`; the hook stays thin (engine lifecycle + an
  `onState`→React-state bridge). Trade-off: less idiomatic than a single all-in-one hook, and the
  policy/mechanism split must be maintained by hand.

## Consequences

- The engine has no React import; its unit tests are the repo's first frontend tests (Vitest +
  jsdom) and need no DOM render — see `frontend/src/audio/crossfadePlayer.test.ts`.
- The hook owns a StrictMode-safe lifecycle: `main.tsx` wraps the app in `<StrictMode>`, which
  double-invokes effects in dev, so the engine is created inside an effect (not in render) and
  disposed on cleanup; the hook returns the `useRef`, never a render-captured instance. See
  `frontend/src/hooks/useCrossfadeAudio.ts`.
- The engine is the single writer to `audio.volume`: the ramp tick reads the live target every
  step, so a volume/mute change mid-crossfade lands there. This removed a latent two-writer race
  (a `MusicPlayer` sync effect writing the element while the ramp also wrote it), and that sync
  effect is now deleted.
- Consistent with ADR-0001 — both are deliberate "why not the obvious React thing" calls.
