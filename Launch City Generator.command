#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
if [[ ! -d node_modules/lucide-static || ! -d node_modules/polygon-clipping || ! -d node_modules/polylabel || ! -x node_modules/.bin/esbuild ]]; then
    npm ci
fi
if [[ ! -x .toolchain/bin/haxe ]]; then
    npm run setup
fi
npm run build
npm start