#!/bin/sh
# Vendor the reading fonts into src/vendor/fonts/<id>/ from Fontsource's npm
# packages, pinned below: the latin and latin-ext WOFF2 subsets, the licence
# (OFL.txt) and a VERSION file with the SHA-256 of every file. Then write
# src/vendor/fonts/fonts.css from Fontsource's own @font-face rules (their
# unicode-range values), pointing at the vendored files. Needs npm and node;
# nothing else is fetched. Run from the repository root:
#   tools/update_fonts.sh
set -eu

# package@version|family|axis of a variable package, or weights of a static one
FONTS='
@fontsource-variable/literata@5.3.0|Literata|opsz
@fontsource-variable/merriweather@5.3.0|Merriweather|wght
@fontsource-variable/source-serif-4@5.3.1|Source Serif 4|opsz
@fontsource-variable/libre-baskerville@5.3.0|Libre Baskerville|wght
@fontsource-variable/lora@5.3.0|Lora|wght
@fontsource-variable/eb-garamond@5.3.0|EB Garamond|wght
@fontsource-variable/crimson-pro@5.3.0|Crimson Pro|wght
@fontsource-variable/newsreader@5.3.0|Newsreader|opsz
@fontsource/spectral@5.3.0|Spectral|400 700
@fontsource-variable/atkinson-hyperlegible-next@5.3.0|Atkinson Hyperlegible Next|wght
@fontsource-variable/lexend@5.3.0|Lexend|wght
@fontsource-variable/inter@5.3.0|Inter|wght
@fontsource-variable/source-sans-3@5.3.1|Source Sans 3|wght
@fontsource-variable/geist@5.3.0|Geist|wght
@fontsource-variable/manrope@5.3.0|Manrope|wght
@fontsource-variable/space-grotesk@5.3.0|Space Grotesk|wght
'

out=src/vendor/fonts
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
rm -rf "$out"
mkdir -p "$out"
css="$out/fonts.css"
{
  echo "/* Reading fonts for the Markdown view: Fontsource's @font-face rules for the"
  echo "   latin and latin-ext subsets, pointing at the files vendored next to this one."
  echo "   Written by tools/update_fonts.sh; do not edit by hand. */"
} > "$css"

echo "$FONTS" | while IFS='|' read -r spec family axis; do
  [ -n "$spec" ] || continue
  pkg=${spec%@*}
  version=${spec##*@}
  id=${pkg#*/}
  dir="$out/$id"
  mkdir -p "$dir" "$tmp/$id"
  (cd "$tmp/$id" && npm pack --silent "$spec" > /dev/null && tar -xzf ./*.tgz)
  src="$tmp/$id/package"
  styles=$(node -p "require('$src/metadata.json').styles.includes('italic') ? 'normal italic' : 'normal'")
  case $pkg in
    @fontsource-variable/*)
      variants=$axis
      shape=$(node -p "const v = require('$src/metadata.json').variable; ['wght', '$axis'].filter((a, i, all) => v[a] && all.indexOf(a) === i).map((a) => a + ' ' + v[a].min + '-' + v[a].max).join(', ')")
      shape="variable WOFF2: $shape" ;;
    *)
      variants=$axis
      shape="static WOFF2: weights $(echo "$axis" | sed 's/ /, /g')" ;;
  esac
  for variant in $variants; do
    for style in $styles; do
      sheet=$variant
      [ "$style" = italic ] && sheet="$variant-italic"
      for subset in latin-ext latin; do
        stem="$id-$subset-$variant-$style"
        cp "$src/files/$stem.woff2" "$dir/"
        echo >> "$css"
        awk -v want="/* $stem */" '$0 == want { on = 1 } on { print } on && /^}/ { exit }' "$src/$sheet.css" |
          sed "s|font-family: '[^']*';|font-family: \"$family\";|; s|src: url(./files/\\([^)]*\\.woff2\\)) format('woff2[^']*')[^;]*;|src: url('./$id/\\1') format('woff2');|" >> "$css"
      done
    done
  done
  cp "$src/LICENSE" "$dir/OFL.txt"
  gf=$(node -p "require('$src/metadata.json').version")
  styles_text=$(echo "$styles" | sed 's/ / and /')
  {
    echo "$family ($shape; $styles_text; latin and latin-ext subsets),"
    echo "SIL Open Font License 1.1 (OFL.txt). Unmodified Fontsource subsets of Google Fonts $gf."
    echo "Source: npm $pkg $version (https://www.npmjs.com/package/$pkg), files/"
    echo "Used for the Markdown body text when chosen. Update with: tools/update_fonts.sh"
    echo "SHA-256:"
    (cd "$dir" && sha256sum OFL.txt ./*.woff2 | sed 's|  \./|  |; s/^/  /')
  } > "$dir/VERSION"
  echo "$family: $pkg $version"
done
echo "Updated $out ($(du -sh "$out" | cut -f1))"
