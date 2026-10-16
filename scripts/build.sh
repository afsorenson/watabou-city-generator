#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/environment.sh"
cd "$ROOT"
if [[ ! -x .toolchain/bin/haxe || ! -x .toolchain/bin/haxelib ]]; then
    printf 'Run npm run setup first.\n' >&2
    exit 1
fi
BUILD_ID="$(node scripts/build-info.mjs prepare)"
./node_modules/.bin/tsc -p tsconfig.engine.json
haxelib run lime build html5 "-Dcity_build_id=$BUILD_ID"
cp Browser/index.html Browser/controls.css Browser/controls.js Browser/compare.html Browser/compare.js Export/html5/bin/
cp Browser/inspector.html Browser/inspector.css Export/html5/bin/
./node_modules/.bin/esbuild Browser/inspector.ts --bundle --format=esm --outfile=Export/html5/bin/inspector.js
mkdir -p Export/html5/bin/icons
for icon in upload file-json image zoom-in zoom-out maximize map; do
    cp "node_modules/lucide-static/icons/$icon.svg" Export/html5/bin/icons/
done
cp node_modules/lucide-static/icons/refresh-cw.svg node_modules/lucide-static/icons/download.svg Export/html5/bin/icons/
cp node_modules/lucide-static/icons/check.svg node_modules/lucide-static/icons/link.svg node_modules/lucide-static/icons/columns-2.svg Export/html5/bin/icons/
cp node_modules/lucide-static/icons/arrow-left.svg Export/html5/bin/icons/
cp node_modules/lucide-static/icons/settings-2.svg node_modules/lucide-static/icons/x.svg node_modules/lucide-static/icons/rotate-ccw.svg Export/html5/bin/icons/
cp node_modules/lucide-static/LICENSE Export/html5/bin/icons/LICENSE
mkdir -p Export/html5/bin/vendor
cp node_modules/polygon-clipping/dist/polygon-clipping.umd.min.js Export/html5/bin/vendor/
cp node_modules/polygon-clipping/LICENSE.md Export/html5/bin/vendor/polygon-clipping-LICENSE.md
./node_modules/.bin/esbuild Browser/frontage-geometry.js --bundle --format=iife --outfile=Export/html5/bin/vendor/frontage-geometry.js
cp node_modules/polylabel/LICENSE Export/html5/bin/vendor/polylabel-LICENSE
cp node_modules/tinyqueue/LICENSE Export/html5/bin/vendor/tinyqueue-LICENSE
node scripts/build-info.mjs finish
printf 'Built Export/html5/bin/index.html\n'