#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/environment.sh"
cd "$ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
    printf 'This toolchain setup targets macOS.\n' >&2
    exit 1
fi

download_tool() {
    local name="$1" url="$2" checksum="$3" destination="$4"
    local archive="$ROOT/.toolchain/$name.tar.gz"
    if [[ ! -f "$archive" ]]; then
        curl -fL --retry 2 "$url" -o "$archive"
    fi
    printf '%s  %s\n' "$checksum" "$archive" | shasum -a 256 -c -
    if [[ ! -d "$ROOT/.toolchain/$destination" ]]; then
        mkdir -p "$ROOT/.toolchain/$destination"
        tar -xzf "$archive" -C "$ROOT/.toolchain/$destination" --strip-components=1
    fi
}

mkdir -p .toolchain/bin "$HAXELIB_PATH"
download_tool haxe-3.4.7 \
    https://github.com/HaxeFoundation/haxe/releases/download/3.4.7/haxe-3.4.7-osx.tar.gz \
    ac8b57c2d716575c7be984da1b4b2e17f19be7c6df0b816fe2841e0eabd241dc haxe-3.4.7
download_tool haxe \
    https://github.com/HaxeFoundation/haxe/releases/download/4.3.7/haxe-4.3.7-osx.tar.gz \
    1d355cb28bc25784b33acce023caeb28d50ccb14e953134a62b889697947efdc haxe-4.3.7
download_tool neko \
    https://github.com/HaxeFoundation/neko/releases/download/v2-4-1/neko-2.4.1-osx64.tar.gz \
    9868b276ede135702b546fb908fce3c6c64e5dc67852d7b56e0e95dde38725e9 neko-2.4.1-osx64

for executable in .toolchain/haxe-4.3.7/haxelib .toolchain/neko-2.4.1-osx64/neko; do
    if ! otool -l "$executable" | grep -Fq "path $ROOT/.toolchain/neko-2.4.1-osx64 ("; then
        install_name_tool -add_rpath "$ROOT/.toolchain/neko-2.4.1-osx64" "$executable"
    fi
done

ln -sf ../haxe-3.4.7/haxe .toolchain/bin/haxe
ln -sf ../haxe-4.3.7/haxelib .toolchain/bin/haxelib
haxe -version
haxelib install lime 7.3.0 --always
haxelib install openfl 8.9.0 --always
haxelib install msignal 1.2.5 --always
printf 'Toolchain ready. Run npm run build, then npm start.\n'