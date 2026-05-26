#!/usr/bin/env bash
# Generates demo media under public/samples/ (requires ffmpeg).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/samples"
mkdir -p "$OUT"

ffmpeg -y \
  -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=5" \
  -f lavfi -i "sine=frequency=440:duration=5" \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest \
  "$OUT/video.mp4"

ffmpeg -y \
  -f lavfi -i "color=c=0x00ccff@0.6:size=400x400:duration=1" \
  -frames:v 1 \
  "$OUT/overlay.png"

echo "Created $OUT/video.mp4 and $OUT/overlay.png"
