# Medieval Fantasy City Generator

## Local Mac Fork

This fork runs Watabou's older open-source engine locally on macOS. It is not
the current hosted generator. It retains the original building and street
generation as the default, with optional Footprints and Block Rows modes, monochrome
presentation, city-focused framing, optional city walls, a local launcher, and
PNG export.
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

Set **City size** from 6 to 40 (the original engine's patch count). New sessions
default to 40 for a large-city comparison. Change size to rebuild at the current
seed, or choose **Generate** for a new seed. **Walls** controls the city perimeter;
castles can remain individually fortified even with city walls off.

Size, seed, and explicit wall choices are stored in the URL, for example:

```text
http://127.0.0.1:8788/?size=40&seed=682063530&walls=1
```

Bookmark a URL to reproduce its city. `walls=1` enables city walls and `walls=0`
disables them. URLs without `walls` retain the original engine's seeded random
wall choice. Changing size preserves this automatic behavior until you explicitly
toggle the checkbox. Changing either setting keeps the seed.

**Buildings** switches between **Original** parcel-shaped buildings and the
optional **Footprints** mode. Switching modes preserves the seed, size, walls,
streets, and city blocks. `buildings=footprints` persists the choice in a URL;
omitting it selects Original. For example:

```text
http://127.0.0.1:8788/?size=40&seed=682063530&walls=1&buildings=footprints
```

Footprints mode runs after original city generation. Common residential and
commercial ward parcels receive inset rectangles, with L-shaped and stepped
variants for sufficiently large buildings. Placement favors the closest city
block edge and searches building depth and sideways position independently,
rather than uniformly shrinking a rectangle at the parcel centroid. The fit
balances occupied area with a preference for a small front setback, using tighter
side gaps to produce denser frontage. Long-edge fallback preserves the same
front-facing direction. All candidates remain inside their original parcels.
It does not consume the original generator's random sequence.
Concave or degenerate parcels, castles, landmarks, parks, and farms retain their
original geometry. This is a parcel-based frontage improvement, not the current
Watabou implementation or a simulation of shared walls, access, and courtyards.

**Block Rows** is a separate experimental alternative. It replaces eligible convex
residential/commercial blocks with coordinated street-edge rows, using the district's
original lot-area setting to size frontages. Larger blocks receive deeper rows.
A central courtyard and one street-to-courtyard passage remain clear. Frontage
plots are clipped to separate edge-owned sectors, then fitted with distinct inset
building footprints rather than drawn directly. Buildings have seeded width/depth
variation and rectangular, L-shaped, or stepped outlines. Deep plots may contain
separate front and rear buildings with a clear gap. Tiny or concave clipped plots
that cannot safely contain an orthogonal footprint are omitted rather than rendered
as wedges. The courtyard layout remains unchanged in this footprint refinement.
Neighboring buildings do not overlap. The clipping engine is bundled
locally; this mode does not need an online service.

```text
http://127.0.0.1:8788/?size=40&seed=682063530&walls=1&buildings=frontage
```

Original outside-wall development, concave/tiny blocks, landmarks, parks, farms,
and castles are retained. Streets, perimeter walls, and the underlying original
parcels stay unchanged. The original random sequence is not consumed. Switching
back to Original or Footprints restores that mode at the same seed. This is an
experimental perimeter-row layout, not a reproduction of modern Watabou algorithms
or a full simulation of plot ownership and shared walls.

The view and **Export PNG** use the same city-focused boundary: city patches
and the castle, with an 8% margin for adjacent development. Distant farms and
approach roads are cropped, not removed from the generated model. Exports remain
2048 x 2048 with an additional 64-pixel minimum outer margin and no UI controls.
Ground and streets are white, buildings gray, and outlines and walls black.
Footprints-mode filenames end in `-footprints.png` so comparisons are distinct.
Block Rows filenames end in `-frontage.png`.

### Verification And Provenance

```sh
npm run build
npm test
```

Tests use installed Google Chrome; set `CHROME_PATH` for another Chrome location.
They build the untouched upstream commit
`7fbc87a9398cc508af24de93f79cf2ad027f352b` as a reference and compare building,
street, road, and perimeter-wall geometry at three sizes without wall overrides.
Presentation pixels intentionally differ. Tests also check seed repeatability,
wall overrides and reloads, size changes and regeneration, desktop/mobile layout,
and the decoded monochrome PNG. Footprint tests independently check containment
using polygon-clipping, orthogonal corners, exact base-geometry preservation,
mode switching, deterministic reloads, and desktop/mobile controls and exports.
They also build the first footprint version (`291272b`) for same-seed occupied-area
comparisons, and check a tapered parcel's front setback and long-edge fallback
orientation. These checks measure the tested cities, not a universal density gain.
Block Rows checks cover owning-plot and block containment, distinct inset footprints,
orthogonal corners, articulated shapes, separate rear buildings, pairwise building nonoverlap, clear
courtyards, clear street-to-courtyard passages, preserved outside-wall development,
deterministic mode switching, and desktop/mobile PNG exports across several sizes
and seeds, including cities with and without perimeter walls.
Screenshots and example exports go into ignored
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
