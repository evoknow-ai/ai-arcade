#!/bin/bash
# Zip the PNGs of a downloaded Kenney pack so they can be mapped into extension/sprites/<game>/.
# usage: bash tools/pack-kenney.sh ~/Downloads/kenney_space-shooter-redux
SRC="$1"; [ -d "$SRC" ] || { echo "usage: $0 <kenney pack folder>"; exit 1; }
NAME=$(basename "$SRC"); OUT="$HOME/Desktop/$NAME.zip"; rm -f "$OUT"
( cd "$SRC" && find . -iname '*.png' -not -path '*Retina*' -not -path '*Double*' -print0 | xargs -0 zip -q -9 "$OUT" ; zip -q -9 "$OUT" License.txt 2>/dev/null )
echo "Packed $(unzip -l "$OUT" | tail -1 | awk '{print $2}') files -> $OUT"
