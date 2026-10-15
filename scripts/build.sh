#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/environment.sh"
cd "$ROOT"
if [[ ! -x .toolchain/bin/haxe || ! -x .toolchain/bin/haxelib ]]; then
    printf 'Run npm run setup first.\n' >&2
    exit 1
fi
haxelib run lime build html5
cp Browser/index.html Browser/controls.css Browser/controls.js Export/html5/bin/
mkdir -p Export/html5/bin/icons
cp node_modules/lucide-static/icons/refresh-cw.svg node_modules/lucide-static/icons/download.svg Export/html5/bin/icons/
cp node_modules/lucide-static/LICENSE Export/html5/bin/icons/LICENSE
mkdir -p Export/html5/bin/vendor
cp node_modules/polygon-clipping/dist/polygon-clipping.umd.min.js Export/html5/bin/vendor/
cp node_modules/polygon-clipping/LICENSE.md Export/html5/bin/vendor/polygon-clipping-LICENSE.md
printf 'Built Export/html5/bin/index.html\n'