# Ambience sources

Rain loops for the reader's ambience button, in `v2/`. All sources are
CC0 (public domain dedication), so no attribution is required. We credit
them anyway. Built on 2026-11-03 by `scripts/ambience/build-rain.sh`
(ffmpeg); no AI generation. `v1/` (October loops) is retired.

| File | Level | Source | Author | License |
| --- | --- | --- | --- | --- |
| v2/rain-drizzle.{webm,m4a} | Drizzle | Candidate "opcion-2" (150 s loop from a Freesound CC0 rain recording; exact sound id not recorded in the build notes, TODO confirm) | Freesound | CC0 |
| v2/rain-moderate.{webm,m4a} | Moderate rain | Candidate "14-storm-truenos-lejanos" (distant-thunder rain, CC0 candidate set) | see candidate index | CC0 |
| v2/rain-storm.{webm,m4a} | Storm | "Rain and thunder in Thailand", https://freesound.org/people/felix.blume/sounds/447510/ (from 164 s) | felix.blume | CC0 |

Storm alternates (same build, not shipped): SpeedY 17055, AVstudent
344994, Sramon 614129; all CC0 on Freesound.

## Processing

- Drizzle: already a 150 s seamless loop (3 s qsin seam crossfade). Decoded
  and renormalized.
- Moderate: the source is 40 s. Its last 3 s fold into its first 3 s
  (equal-power crossfade) for a 37 s seamless cycle, repeated 4 times:
  148 s loop.
- Storm: 150 s seamless loop cut with no thunder within about 4 s of the seam.
- Loudness (EBU R128, integrated): drizzle and moderate -23 LUFS, storm
  -21 LUFS. Limiter at -1 dBFS.
- Encodes: Opus 64 kbps VBR in WebM (primary), AAC-LC 96 kbps in M4A
  (fallback). The engine loops the decoded AudioBuffer
  (`AudioBufferSourceNode.loop`), so the seam is sample-exact.

## Swapping the storm

`STORM=/workspace/rain-options/tormenta-4.mp3 scripts/ambience/build-rain.sh storm`
rewrites `v2/rain-storm.{webm,m4a}`; update the storm row above. If v2
has already been deployed, bump the folder (immutable cache) in
`core/ambience.ts` and `next.config.ts`.

## Why public/ and not Blob

Same origin (no `connect-src` change for the Web Audio fetch) and no Blob
write token needed. About 8.6 MB total.
