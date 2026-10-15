# Medieval Fantasy City Generator

## Local Mac Fork

This fork runs Watabou's older open-source engine locally on macOS. It is not
the current hosted generator. The original generation and map-rendering code
is unchanged; the fork adds a local launcher and a PNG export button.
Coastline constraints and background-image import are not implemented yet.

### Run On This Mac

Double-click `Launch City Generator.command` in Finder. It builds the source,
starts a localhost-only server, and opens your browser. Keep its Terminal window
open while using the app; press Control-C there to stop it.

Alternatively:

```sh
npm run build
npm start
```

The default address is http://127.0.0.1:8788. If that port is occupied, the
launcher selects the next available port and prints its address. No internet
connection is needed after setup. This is a browser-based local app, not a
signed native `.app` bundle.

### First-Time Setup On Another Mac

Requires Node.js/npm and Apple's Command Line Tools (`xcode-select --install`).
The pinned compiler/runtime binaries are Intel builds; Apple Silicon requires
Rosetta 2. The setup has been tested on an Intel Mac.

```sh
npm ci
npm run setup
npm run build
npm start
```

Setup downloads checksum-verified Haxe 3.4.7, Haxe 4.3.7 (package manager only),
and Neko 2.4.1 into `.toolchain/`. Haxe 3.4.7 compiles the engine with the
original Lime 7.3.0, OpenFL 8.9.0, and msignal 1.2.5. Nothing is installed
system-wide. Rerun setup after moving this folder because the local runtime
library paths are absolute.

### Generate And Export

Choose one of the four city-size buttons to generate a city. Seed and size
are stored in the URL, for example:

```text
http://127.0.0.1:8788/?size=15&seed=682063530
```

Bookmark a URL to reproduce its city. **Export PNG** downloads a 2048 x 2048
image containing the full map, including outlying roads and farms, without UI
controls. This intentionally includes more terrain than the on-screen crop.

### Verification And Provenance

```sh
npm run build
npm test
```

Tests use installed Google Chrome; set `CHROME_PATH` for another Chrome location.
They build the untouched upstream commit
`7fbc87a9398cc508af24de93f79cf2ad027f352b` as a reference, compare map pixels
outside the controls at a fixed seed, check seed repeatability and different
seeds, exercise regeneration, render desktop/mobile views, and decode the
downloaded PNG. Screenshots and an example export go into ignored
`test-results/`. This checks the old engine, not parity with today's hosted app.

The original GPL-3.0 license is preserved in `LICENSE`. Upstream history is
retained. The future terrain work should start in
`Source/com/watabou/towngenerator/building/Model.hx`; keep the unconstrained
generation path intact as a regression baseline.

## Original Upstream README

This is the source code of the [Medieval Fantasy City Generator](https://watabou.itch.io/medieval-fantasy-city-generator/) (also available [here](http://fantasycities.watabou.ru/?size=15&seed=682063530)). It 
lacks some of the latest features, namely waterbodies, options UI and some smaller ones. Maybe I'll update it later. 

You'll need [OpenFL](https://github.com/openfl/openfl) and [msignal](https://github.com/massiveinteractive/msignal) 
to run this code, both available through `haxelib`.
