#!/bin/sh
# Copy the machine-made webfonts into src/vendor/machine-made-type from a
# checkout of https://github.com/machine-made/type, and rewrite VERSION with
# the commit and the SHA-256 of every file. Usage:
#   tools/update_mm_fonts.sh ../type
set -eu
type_dir=${1:?usage: tools/update_mm_fonts.sh <machine-made/type checkout>}
out=src/vendor/machine-made-type
mkdir -p "$out"
cp "$type_dir/fonts/weft/webfonts/MachineMadeWeft[FRAG,wght].woff2" "$out/MachineMadeWeft-Variable.woff2"
cp "$type_dir/fonts/sans/webfonts/MachineMadeSans[wght].woff2" "$out/MachineMadeSans-Variable.woff2"
cp "$type_dir/fonts/sans/webfonts/MachineMadeSans-Italic[wght].woff2" "$out/MachineMadeSans-Italic-Variable.woff2"
cp "$type_dir/fonts/heddle/webfonts/MachineMadeHeddle[wdth,wght].woff2" "$out/MachineMadeHeddle-Variable.woff2"
cp "$type_dir/weft/OFL.txt" "$out/OFL-Weft.txt"
cp "$type_dir/sans/OFL.txt" "$out/OFL-Sans.txt"
cp "$type_dir/heddle/OFL.txt" "$out/OFL-Heddle.txt"
commit=$(git -C "$type_dir" rev-parse HEAD)
{
  echo "machine-made Weft, machine-made Sans and machine-made Heddle (variable WOFF2),"
  echo "SIL Open Font License 1.1 (OFL-Weft.txt, OFL-Sans.txt, OFL-Heddle.txt). Unmodified; files renamed only."
  echo "Source: https://github.com/machine-made/type at $commit, fonts/*/webfonts/"
  echo "Used for the Markdown body text when chosen, and for the interface when chosen in Settings."
  echo "Update with: tools/update_mm_fonts.sh <path to a machine-made/type checkout>"
  echo "SHA-256:"
  (cd "$out" && sha256sum ./*.woff2 | sed 's|  \./|  |; s/^/  /')
} > "$out/VERSION"
echo "Updated $out from machine-made/type $commit"
