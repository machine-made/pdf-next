#!/bin/sh
# Copy the Monaspace variable webfonts into src/vendor/monaspace from a
# checkout of https://github.com/githubnext/monaspace, and rewrite VERSION with
# the tag, the commit and the SHA-256 of every file. Usage:
#   tools/update_monaspace.sh ../monaspace
set -eu
src=${1:?usage: tools/update_monaspace.sh <githubnext/monaspace checkout>}
out=src/vendor/monaspace
mkdir -p "$out"
for face in Neon Argon Xenon Radon Krypton; do
  cp "$src/fonts/Web Fonts/Variable Web Fonts/Monaspace $face/Monaspace $face Var.woff2" "$out/Monaspace$face-Variable.woff2"
done
cp "$src/LICENSE" "$out/OFL.txt"
commit=$(git -C "$src" rev-parse HEAD)
tag=$(git -C "$src" describe --tags --always 2>/dev/null || echo "$commit")
{
  echo "Monaspace Neon, Argon, Xenon, Radon and Krypton (variable WOFF2: wght 200-800, wdth 100-125, slnt -11-0),"
  echo "SIL Open Font License 1.1 (OFL.txt), Copyright (c) 2023 GitHub. Unmodified; files renamed only."
  echo "Source: https://github.com/githubnext/monaspace $tag ($commit), fonts/Web Fonts/Variable Web Fonts/"
  echo "Used for the Markdown body text and for code when chosen."
  echo "Update with: tools/update_monaspace.sh <path to a githubnext/monaspace checkout>"
  echo "SHA-256:"
  (cd "$out" && sha256sum ./*.woff2 | sed 's|  \./|  |; s/^/  /')
} > "$out/VERSION"
echo "Updated $out from githubnext/monaspace $tag"
