#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/environment.sh"
cd "$ROOT"
if [[ ! -x .toolchain/bin/haxe || ! -x .toolchain/bin/haxelib ]]; then
    printf 'Run npm run setup first.\n' >&2
    exit 1
fi
haxelib run lime build html5
printf 'Built Export/html5/bin/index.html\n'