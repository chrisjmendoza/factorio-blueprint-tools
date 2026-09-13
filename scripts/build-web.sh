#!/usr/bin/env bash
# Build the static web copy of the viewer, for Vercel or any static host.
#
#   bash scripts/build-web.sh [outdir]        (default: public/)
#
# The viewer already runs outside VS Code: it takes a blueprint by drop, paste
# or file picker, computes the flow in the page with flow.js, and keeps feeds in
# localStorage. So the whole site is the media folder with viewer.html as the
# index. The icon atlas is deliberately NOT part of it: that art is Wube's and
# is not ours to redistribute, so the page falls back to coloured tiles and a
# stub tells it the icons are absent rather than 404ing on every load.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="${1:-$root/public}"
media="$root/vscode/media"

rm -rf "$out"
mkdir -p "$out"
cp "$media/viewer.html" "$out/index.html"
for f in viewer.js viewer.css flow.js gamedata.js; do
  cp "$media/$f" "$out/$f"
done
cp "$root/tests/fixtures/mall.txt" "$out/sample.txt"

if [ "${FBP_WEB_ICONS:-0}" = "1" ] && [ -f "$media/icons.js" ] && [ -f "$media/icons.png" ]; then
  # Opt-in, and only for a build you are not publishing: this copies Wube's artwork.
  echo "WARNING: including the icon atlas; do not publish this build" >&2
  cp "$media/icons.js" "$media/icons.png" "$out/"
else
  cat > "$out/icons.js" <<'STUB'
// No icon atlas on this build: Factorio's artwork belongs to Wube Software and is
// not redistributable, so `fbp icons` builds it from your own installation. The
// viewer falls back to coloured tiles and disables the icons toggle.
window.FBP_ICONS = null;
STUB
fi

echo "built $(ls "$out" | wc -l) files into $out"
