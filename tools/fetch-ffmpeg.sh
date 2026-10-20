#!/bin/bash
# Downloads the ffmpeg.wasm core (32 MB) used for MP4 clip export into extension/vendor/ffmpeg-core/.
# Needs npm. Run once after cloning: bash tools/fetch-ffmpeg.sh
set -e
cd "$(dirname "$0")/.."
TMP=$(mktemp -d); cd "$TMP"
npm pack @ffmpeg/core@0.12.10 >/dev/null
tar xzf ffmpeg-core-0.12.10.tgz
cd - >/dev/null
cp "$TMP/package/dist/esm/ffmpeg-core.js" "$TMP/package/dist/esm/ffmpeg-core.wasm" extension/vendor/ffmpeg-core/
rm -rf "$TMP"
ls -la extension/vendor/ffmpeg-core/
echo "Done. Reload the unpacked extension; the Rec button will export MP4."
