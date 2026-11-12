#!/usr/bin/env bash
# Makes assets/readme/view-{dark,light}.png from frame.html with a headless Chromium.
# Usage: scripts/readme/shoot.sh <chromium or chrome-headless-shell>
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p assets/readme
for theme in dark light; do
  "$1" --no-sandbox --allow-file-access-from-files --virtual-time-budget=4000 --force-device-scale-factor=2 \
    --window-size=1000,430 --screenshot="assets/readme/view-$theme.png" "file://$PWD/scripts/readme/frame.html#$theme"
done
