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
cd "$ROOT"
mkdir -p .toolchain/coverage-reference-source .toolchain/coverage-reference
git archive 5f324c0 | tar -x -C .toolchain/coverage-reference-source
cd .toolchain/coverage-reference-source
haxelib run lime build html5
cp Browser/index.html Browser/controls.css Browser/controls.js Export/html5/bin/
cp -R "$ROOT/Export/html5/bin/icons" Export/html5/bin/
cp -R "$ROOT/Export/html5/bin/vendor" Export/html5/bin/
cp -R Export/html5/bin/. "$ROOT/.toolchain/coverage-reference/"
cd "$ROOT"
mkdir -p .toolchain/topology-reference-source .toolchain/topology-reference
git archive fea8644 | tar -x -C .toolchain/topology-reference-source
cd .toolchain/topology-reference-source
haxelib run lime build html5
cp Browser/index.html Browser/controls.css Browser/controls.js Export/html5/bin/
cp -R "$ROOT/Export/html5/bin/icons" Export/html5/bin/
cp -R "$ROOT/Export/html5/bin/vendor" Export/html5/bin/
cp -R Export/html5/bin/. "$ROOT/.toolchain/topology-reference/"
cd "$ROOT"
mkdir -p .toolchain/transitions-reference-source .toolchain/transitions-reference
git archive f625b1f | tar -x -C .toolchain/transitions-reference-source
cd .toolchain/transitions-reference-source
haxelib run lime build html5
cp Browser/index.html Browser/controls.css Browser/controls.js Export/html5/bin/
cp -R "$ROOT/Export/html5/bin/icons" Export/html5/bin/
cp -R "$ROOT/Export/html5/bin/vendor" Export/html5/bin/
cp -R Export/html5/bin/. "$ROOT/.toolchain/transitions-reference/"
cd "$ROOT"
mkdir -p .toolchain/grouping-reference-source .toolchain/grouping-reference
git archive 69b0c79 | tar -x -C .toolchain/grouping-reference-source
cd .toolchain/grouping-reference-source
haxelib run lime build html5
cp Browser/index.html Browser/controls.css Browser/controls.js Export/html5/bin/
cp -R "$ROOT/Export/html5/bin/icons" Export/html5/bin/
cp -R "$ROOT/Export/html5/bin/vendor" Export/html5/bin/
cp -R Export/html5/bin/. "$ROOT/.toolchain/grouping-reference/"
cd "$ROOT"
mkdir -p .toolchain/hierarchy-reference-source .toolchain/hierarchy-reference
git archive 80d6a85 | tar -x -C .toolchain/hierarchy-reference-source
cd .toolchain/hierarchy-reference-source
haxelib run lime build html5
cp Browser/index.html Browser/controls.css Browser/controls.js Export/html5/bin/
cp -R "$ROOT/Export/html5/bin/icons" Export/html5/bin/
cp -R "$ROOT/Export/html5/bin/vendor" Export/html5/bin/
cp -R Export/html5/bin/. "$ROOT/.toolchain/hierarchy-reference/"
printf 'Built untouched upstream reference.\n'