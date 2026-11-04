#!/usr/bin/env bash
# Builds public/ambience/v2/rain-{drizzle,moderate,storm}.{webm,m4a}.
# Sources (all CC0) live outside the repo; see public/ambience/SOURCES.md.
# Swap the storm: STORM=/path/tormenta-4.mp3 scripts/ambience/build-rain.sh storm
set -euo pipefail
SRC=${SRC:-/workspace/rain-options}
DRIZZLE=${DRIZZLE:-$SRC/opcion-2.mp3}
MODERATE=${MODERATE:-$SRC/moderada-14-storm-truenos-lejanos.mp3}
STORM=${STORM:-$SRC/tormenta-2.mp3}
OUT=$(cd "$(dirname "$0")/../.." && pwd)/public/ambience/v2
X=3 # seam crossfade, seconds
mkdir -p "$OUT"; tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

lufs() { ffmpeg -nostats -i "$1" -af ebur128 -f null - 2>&1 | awk '/^ +I:/{v=$2} END{print v}'; }

# Fold the last X s into the first X s (equal power), so end runs into start.
seamless() { # in out
  ffmpeg -v error -y -i "$1" -ar 48000 -ac 2 -c:a pcm_f32le "$tmp/in.wav"
  ffmpeg -v error -y -i "$tmp/in.wav" -i "$tmp/in.wav" -filter_complex \
    "[0]atrim=start=$X,asetpts=PTS-STARTPTS[body];[1]atrim=0:$X,asetpts=PTS-STARTPTS[head];[body][head]acrossfade=d=$X:c1=qsin:c2=qsin" \
    -c:a pcm_f32le "$2"
}

build() { # level src target_lufs mode(asis|fold)
  local level=$1 src=$2 target=$3 mode=$4 wav="$tmp/$1.wav"
  if [ "$mode" = fold ]; then
    # Short source: make one seamless cycle, repeat it to about 150 s.
    seamless "$src" "$tmp/cycle.wav"
    local c n; c=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$tmp/cycle.wav")
    n=$(python3 -c "import math;print(max(1,round(150/$c)))")
    ffmpeg -v error -y -stream_loop $((n-1)) -i "$tmp/cycle.wav" -c:a pcm_f32le "$wav"
  else
    # Already a seamless loop: decode only.
    ffmpeg -v error -y -i "$src" -ar 48000 -ac 2 -c:a pcm_f32le "$wav"
  fi
  local i g; i=$(lufs "$wav"); g=$(python3 -c "print($target-($i))")
  ffmpeg -v error -y -i "$wav" -af "volume=${g}dB,alimiter=limit=0.89:level=false" -c:a pcm_f32le "$tmp/n.wav"
  ffmpeg -v error -y -i "$tmp/n.wav" -c:a libopus -b:a 64k -vbr on "$OUT/rain-$level.webm"
  ffmpeg -v error -y -i "$tmp/n.wav" -c:a aac -b:a 96k -movflags +faststart "$OUT/rain-$level.m4a"
  echo "$level: $(basename "$src") $i -> $(lufs "$OUT/rain-$level.webm") LUFS"
}

want=${1:-all}
[[ $want =~ all|drizzle ]] && build drizzle "$DRIZZLE" -23 asis
[[ $want =~ all|moderate ]] && build moderate "$MODERATE" -23 fold
[[ $want =~ all|storm ]] && build storm "$STORM" -21 asis
exit 0
