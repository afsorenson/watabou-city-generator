#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/environment.sh"
cd "$ROOT"
if [[ ! -x .toolchain/bin/haxe || ! -x .toolchain/bin/haxelib ]]; then
    printf 'Run npm run setup first.\n' >&2
    exit 1
fi
BUILD_ID="$(node scripts/build-info.mjs prepare)"
haxelib run lime build html5 "-Dcity_build_id=$BUILD_ID"
cp Browser/index.html Browser/controls.css Browser/controls.js Browser/compare.html Browser/compare.js Export/html5/bin/
mkdir -p Export/html5/bin/icons
cp node_modules/lucide-static/icons/refresh-cw.svg node_modules/lucide-static/icons/download.svg Export/html5/bin/icons/
cp node_modules/lucide-static/icons/check.svg node_modules/lucide-static/icons/link.svg node_modules/lucide-static/icons/columns-2.svg Export/html5/bin/icons/
cp node_modules/lucide-static/icons/arrow-left.svg Export/html5/bin/icons/
cp node_modules/lucide-static/LICENSE Export/html5/bin/icons/LICENSE
mkdir -p Export/html5/bin/vendor
cp node_modules/polygon-clipping/dist/polygon-clipping.umd.min.js Export/html5/bin/vendor/
cp node_modules/polygon-clipping/LICENSE.md Export/html5/bin/vendor/polygon-clipping-LICENSE.md
node scripts/build-info.mjs finish
printf 'Built Export/html5/bin/index.html\n'