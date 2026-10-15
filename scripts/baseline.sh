#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/environment.sh"
cd "$ROOT"
mkdir -p .toolchain/upstream-source .toolchain/upstream-baseline
git archive 7fbc87a9398cc508af24de93f79cf2ad027f352b | tar -x -C .toolchain/upstream-source
cd .toolchain/upstream-source
haxelib run lime build html5
cp -R Export/html5/bin/. "$ROOT/.toolchain/upstream-baseline/"
cd "$ROOT"
mkdir -p .toolchain/footprints-reference-source .toolchain/footprints-reference
git archive 291272b | tar -x -C .toolchain/footprints-reference-source
cd .toolchain/footprints-reference-source
haxelib run lime build html5
cp -R Export/html5/bin/. "$ROOT/.toolchain/footprints-reference/"
printf 'Built untouched upstream reference.\n'