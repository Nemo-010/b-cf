#!/bin/sh
# Clone the third-party repositories that RESEARCH.md cites, at the exact
# commits the citations were taken from.  They are deliberately NOT vendored:
# jina-ai/reader is "All rights reserved", socksflare and the munew solver are
# GPL-3.0, and Theyka's solver is CC-BY-NC-4.0.  Fetch them, do not ship them.
#
#   sh tools/fetch-repos.sh                -> ./repos/<name>   (git-ignored)
#   REPO_DIR=/tmp/x sh tools/fetch-repos.sh
#
# Uses a shallow fetch of the exact commit, so the trees are small and the
# file:line citations in RESEARCH.md resolve to the same bytes.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DEST="${REPO_DIR:-$ROOT/repos}"

mkdir -p "$DEST"

# name url commit
MANIFEST='
b-ids https://github.com/Azathothas/b-ids.git 43c73e81374dc6c713069499e29ff17fd94f4214
browser-use https://github.com/browser-use/browser-use.git c75e8476e26d18b7617643bc2ae082fae8eae431
jina-reader https://github.com/jina-ai/reader.git 1574bfd380d249c86c82db4dace0d9c8fe17e2b1
reverse-proxies https://github.com/pkgforge-dev/reverse-proxies.git 03f6d1dbd78a4377b3277a9b82b797e7a31544c9
socksflare https://github.com/EithonX/socksflare.git 62fba5f3156b9d1f9aba82720cd9f408d9127061
ts-munew https://github.com/munew/cloudflare-turnstile-solver.git ba6cbd2faa8471394ab7e016a12ef52e6ebcc52e
ts-theyka https://github.com/Theyka/Turnstile-Solver.git c28af92c479bec96178fdca2dc2bacdb227b5b0f
tunnelfetch https://github.com/latentharbor/tunnelfetch.git 81b75f37f3d1272a3e28b903abf7b2489735f302
'

echo "$MANIFEST" | while read -r name url commit; do
  [ -n "$name" ] || continue
  short=$(printf '%.12s' "$commit")
  dir="$DEST/$name"
  if [ -d "$dir/.git" ] && [ "$(git -C "$dir" rev-parse HEAD 2>/dev/null || echo none)" = "$commit" ]; then
    echo "ok       $name @ $short"
    continue
  fi
  rm -rf "$dir"
  mkdir -p "$dir"
  git -C "$dir" init --quiet
  git -C "$dir" remote add origin "$url"
  git -C "$dir" -c advice.detachedHead=false fetch --quiet --depth 1 origin "$commit"
  git -C "$dir" -c advice.detachedHead=false checkout --quiet FETCH_HEAD
  echo "fetched  $name @ $short"
done

echo
echo "done -> $DEST"
echo "RESEARCH.md cites these trees by file:line; re-read them before trusting a quote."
