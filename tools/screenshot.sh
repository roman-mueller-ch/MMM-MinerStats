#!/bin/sh
# Renders the module with made-up readings to docs/demo.png, or to the path given.
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
chrome="${CHROME:-chromium}"
out="${1:-$root/docs/demo.png}"
profile="$(mktemp -d)"
trap 'rm -rf "$profile"' EXIT

"$chrome" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
	--force-device-scale-factor=2 --user-data-dir="$profile" --window-size=460,400 \
	--virtual-time-budget=4000 --screenshot="$out" "file://$root/tools/preview.html" >/dev/null 2>&1

echo "$out"
