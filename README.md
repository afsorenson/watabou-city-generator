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

The toolbar shows the **Build** ID actually compiled into the engine. PNG filenames
include that ID as well as size, seed, walls, and building mode. The ID combines
the Git revision with a source fingerprint; `dirty` means the build included local
uncommitted runtime changes. The engine's SHA-256 is recorded in `build-info.json`.
A mismatch between the page metadata and engine produces a visible warning.

Enter an integer **Seed** from 1 to 2147483646 and choose **Apply** (or press Enter)
to restore it without changing the other settings. **New City** chooses a new seed.
Refresh preserves the seed and settings already in the URL. Invalid URL seeds are
replaced with a valid seed rather than passed to the random generator.

**Copy Link** copies the actual seed, size, wall state, building mode, and render style into a
link bound to an archived build. If clipboard access is unavailable, a dialog
provides the link. Links are local to this server, not cloud-shared map saves.

Set **City size** from 6 to 40 (the original engine's patch count). New sessions
default to 40 for a large-city comparison. Change size to rebuild at the current
seed, or choose **New City** for a new seed. **Walls** controls the city perimeter;
castles can remain individually fortified even with city walls off.

Size, seed, and explicit wall choices are stored in the URL, for example:

```text
http://127.0.0.1:8788/?size=40&seed=682063530&walls=1
```

Bookmark a URL to reproduce its city. `walls=1` enables city walls and `walls=0`
disables them. URLs without `walls` retain the original engine's seeded random
wall choice. Changing size preserves this automatic behavior until you explicitly
toggle the checkbox. Changing either setting keeps the seed.

### Compare Builds

Choose **Compare** to open two real local engine snapshots with the same seed,
size, wall state, building mode, and rendering style. Select **Before** and **After**, then **Apply**
to render them. **View** switches between the whole 2048px map and matching 600px
Northwest, Center, or South neighborhood crops. Each panel identifies its actual
build and can download its full map or selected crop. **Copy Link** preserves both
build IDs, all settings, and the selected view.

Builds are retained under `.toolchain/build-history/` and published into the local
server's generated `builds/` directory at build time. They are not silently pruned.
Back up that history if exact restoration matters; it is ignored by Git and is not
automatically transferred to another Mac. A seed alone cannot guarantee the same
city after generation algorithms change. Version-bound links need their archived
engine to remain available. Saving city geometry is still future work.

The existing pre-identification build is preserved with a `legacy-<engine hash>`
label rather than assigning it an unverified Git revision. Since this update does
not change valid-seed generation, comparing it against the preceding build should
show the same city. Differences are expected only when comparing actual engine
changes. Missing or incompatible builds are reported rather than replaced by the
current engine.

### Rendering Styles

**Style** is independent of **Buildings**. **Flat** preserves the established
monochrome drawing. **Roofed** adds muted gray pitched-roof planes, subtle eaves,
consistent southeast shadows from a northwest light, ridge lines, and occasional
small chimneys. L-shaped and stepped footprints receive multiple roof sections.
Suitable irregular convex footprints use equal-pitch hipped faces formed from
inward distances to their perimeter edges, with orientation-aware lighting.
Hip/ridge lines follow intersections of those planes rather than a bounding-box
midpoint split. Difficult irregular concave footprints, or numerically unsafe hip
plans, use restrained single-tone shading without invented ridges. Clipping uses
normalized coordinates and validates footprint coverage; an unsuitable roof cannot
abort the city render. Parks and market features stay flat.
This is a 2D roof treatment, not a full 3D or architectural roof simulation.

```text
http://127.0.0.1:8788/?size=40&seed=1091337103&walls=1&buildings=footprints&style=roofed
```

Changing style redraws the same model: it does not regenerate buildings, streets,
walls, or the seed. Ridge/chimney detail simplifies at small screen scales. Roofed
PNG exports use a fresh export-scale drawing tree, so the 2048px result does not
depend on the screen viewport or its cached graphics. Switching back to Flat
restores the Flat drawing.

Style survives seed restoration, New City, copied links, and comparisons. Roofed
filenames include `roofed` before the compiled build ID. Comparison uses one shared
style for both engines; if a selected archived engine lacks it, the page reports
the incompatibility rather than substituting Flat. Builds record supported styles,
and automatic comparison selection prefers compatible archives.

### Building Modes

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
Ordinary concave parcels, castles, landmarks, parks, and farms retain their
original geometry, except for the explicit severe-outlier cleanup below. This is a parcel-based frontage improvement, not the current
Watabou implementation or a simulation of shared walls, access, and courtyards.

Both **Footprints** and **Block Rows** run a conservative footprint-quality pass.
It flags triangular taper, convex corners below 22 degrees, extreme aspect ratios
above 14:1, and degenerate/sliver geometry in common residential/commercial and
military building wards. Plausible skewed polygons, rectangles, and L-shaped
buildings are not normalized merely for being irregular. Flagged footprints are
fitted with contained rectangles; long usable needles can become a bounded series
of short footprints. The fitter attempts a conservative contained fit for concave
outliers too. Outliers that cannot support the minimum usable dimensions are omitted.

Original mode remains untouched. Castles, cathedrals, parks, markets, and farms are
excluded, as are already-regenerated Block Rows and their attached groups. Streets,
walls, lanes, district definitions, and all unflagged vertices remain unchanged.
Cleanup is independent of Flat/Roofed rendering and consumes no generator randomness.
This is a deliberately narrow outlier filter, not a complete architectural
plausibility test or an organic-layout update. Some unusual but non-extreme shapes
remain by design.

**Block Rows** is a separate experimental alternative. Eligible residential and
commercial blocks are subdivided into smaller building groups with narrow secondary
lanes. Lot sizes follow the district's original lot-area setting; widths, row depths,
and lane spacing vary deterministically. Internal connecting lanes bend gently
with the block's boundary profile, and shorter connectors are offset between
neighboring bands to form staggered T-junctions rather than a continuous grid.
Each plot follows its local lane limits, preserving building density along bends.
Groups contain back-to-back building rows,
not a universal hollow perimeter. Only selected larger districts reserve a small
lane-connected courtyard.

Along shared boundaries between eligible residential/commercial districts, target
lot sizes blend toward the geometric mean of the two districts' original lot areas.
The effect fades over roughly 2.5 original building widths; locations outside that
band retain their original district scale. Row counts and frontage widths follow
the local target rather than changing the entire district. Compatible boundary
buildings can align to the shared street edge, but a rotated fit is accepted only
when it retains at least 90% of the original fit area. Neighborhood lane geometry
is unchanged by this transition pass. Parks, landmarks, and opposite sides of the
city wall are excluded from the blend.

Plots are clipped to block boundaries and fitted with distinct rectangular,
L-shaped, or stepped footprints. Denser fitting avoids repeatedly shrinking lots
into tiny buildings. Unsafe tiny or concave boundary lots are omitted rather than
drawn as wedges, and blocks with too few usable buildings retain their original
geometry. Buildings do not overlap, and secondary lanes stay clear. The clipping
engine is bundled locally; this mode does not need an online service.

Compatible consecutive frontage plots can form short attached groups of 2-5
buildings. Each building keeps its own polygon and visible outline, with an exact
shared side-wall segment and varied rear wings. Clear end passages separate
groups, and detached buildings remain mixed in. Clipped or incompatible plots
keep their detached footprints; very small cities may have no accepted groups.
Grouping preserves the lane network and building count. Each replacement group
must retain 97-108% of its previous building area and fit inside its cell and
block without obstructing a courtyard. This is a conservative first grouping
pass, not a general corner-building or shared-wall construction simulation.

Block Rows uses an explicit width hierarchy in the original engine's coordinate
units: main routes remain 2.0 and district streets 1.0, neighborhood spines reserve
0.52-0.90, local connectors 0.34-0.56, and group-end passages 0.18-0.28. Wider
neighborhood spines remain narrower than district streets. Plot setbacks use the
same reserved widths as the lane geometry, so clearance changes are real rather
than painted over buildings. Ordinary gaps between buildings are not promoted to
roads. Rendered white space also includes setbacks and stroke effects, so it is
not identical to the nominal width. Routes and junction connections are retained;
plots, fitting, and some building/group counts can change with the new clearance.

```text
http://127.0.0.1:8788/?size=40&seed=682063530&walls=1&buildings=frontage
```

Original outside-wall development, unsuitable/tiny blocks, landmarks, parks, farms,
and castles are retained. Streets, perimeter walls, and the underlying original
parcels stay unchanged. The original random sequence is not consumed. Switching
back to Original or Footprints restores that mode at the same seed. This is an
experimental subdivision layout, not a reproduction of modern Watabou algorithms
or a full simulation of plot ownership and shared walls. It remains more regular
than the current Watabou reference; boundary-responsive bends and staggered
junctions are not a complete historical street-growth model.

The view and **Export PNG** use the same city-focused boundary: city patches
and the castle, with an 8% margin for adjacent development. Distant farms and
approach roads are cropped, not removed from the generated model. Exports remain
2048 x 2048 with an additional 64-pixel minimum outer margin and no UI controls.
Ground and streets are white, buildings gray, and outlines and walls black.
Export filenames include `footprints` or `frontage` when selected, followed by the
compiled build ID. Comparison exports also identify before/after and the crop.

### Next Visual Refinements

Prioritized follow-ups after neighborhood street topology:

- [x] **Soften district transitions (first pass).** Use shared street context to blend building
	scale, orientation, and density near boundaries without erasing district identity.
- [x] **Vary building grouping (first pass).** Mix short attached frontages and
	detached buildings, preserve individual outlines, vary rear wings, and reserve end
	passages. More elaborate corner buildings and independent rear structures remain future work.
- [x] **Clarify street hierarchy (first pass).** Distinguish main routes, neighborhood connecting
	lanes, and narrow access passages through consistent widths and frontage spacing.
- [ ] **Refine outskirts.** Replace raw wedge-shaped roadside plots with distinct
	buildings and a gradual density falloff, preserving farms and approach roads.

For each update, retain fixed-seed city and neighborhood comparisons alongside the
Watabou reference. Check coverage and access as well as containment; geometrically
valid output alone does not establish visual similarity. Original and Footprints
should remain available as unchanged comparison modes.

### Verification And Provenance

Known pre-existing generator limitation: size 40, seed `1155767784`, walls off,
Footprints mode can fail in `Graph.aStar`/`Topology.buildPath` before building
geometry or quality cleanup runs (`undefined.__id__`). The same failure is
reproducible in the archived pre-cleanup build `a5d4581-3e660ff168`. This narrow
cleanup intentionally does not alter upstream street routing. Random New City
smoke checks may encounter this older failure; fixed-seed cleanup checks remain
separate and do not suppress it.

```sh
npm run build
npm test
```

For just seed/build identity and comparison workflows after a build:

```sh
npm run test:identity
```

For just renderer and roof workflows after a build:

```sh
npm run test:roofs
```

For just footprint-quality fixtures, actual-seed audits, and exports:

```sh
npm run test:quality
```

Quality checks cover normal/skewed/L-shaped buildings, triangles, needles, acute
corners, slivers, and rotated fixtures. Actual cities must preserve exact unflagged
geometry, protected features, and source containment. Tests bound affected source
footprints to 5% and total area loss to 5%; these are regression limits, not claims
that every seed changes by those amounts. For seed 1091337103, the fixtures affect
2/2494 source footprints in Footprints mode and 18/2425 in Block Rows, with less than
0.3% total area loss. Each repair or omission is recorded in `quality-*.json`.
Where the preceding build (`a5d4581`) is archived, its geometry must exactly match
the pre-cleanup source. Matching `quality-before-*-neighborhood.png` and
`quality-after-*-neighborhood.png` crops support visual review.

Roof checks cover rotated rectangles and compound footprints, roof-plane coverage,
nonoverlap and containment, model reuse and unchanged geometry, deterministic
Flat restoration, visible shaded planes, identical desktop/mobile PNG pixels,
all building modes, shared style restoration, equal-build Roofed comparisons,
and explicit failure for incompatible archived styles. Matching crops are
`test-results/roof-flat-neighborhood.png` and `test-results/roofed-neighborhood.png`.
Irregular-roof fixtures also cover skewed quadrilaterals, triangles, convex
pentagons, reversed order, collinear vertices, and a difficult concave fallback.
They verify equal-height hip/ridge lines, complete nonoverlapping roof coverage,
and unchanged footprint/model geometry. Where the original Roofed build (`9fcb9d3`)
is archived locally, matching crops focus on the reported upper-left neighborhood:
`irregular-roofs-before-neighborhood.png` and `irregular-roofs-after-neighborhood.png`.
Actual-seed plan diagnostics are saved as `irregular-roofs-original.json` and
`irregular-roofs-footprints.json` under `test-results/`.

These checks validate seed restoration after refresh/New City, invalid inputs,
compiled engine fingerprints, build-bound links and clipboard fallback, locked
comparison settings, real archived-engine rendering, identical-build crop pixels,
full/cropped PNG downloads, and desktop/mobile layouts. The full test command
includes these checks alongside the geometry regressions below.

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
orthogonal corners, articulated shapes, pairwise building nonoverlap, selective
courtyard sizing, clear secondary lanes, preserved outside-wall development,
deterministic mode switching, and desktop/mobile PNG exports across several sizes
and seeds, including cities with and without perimeter walls.
The pre-subdivision version (`5f324c0`) is built for matching-seed comparisons.
Per-district area and coverage reports are written to `test-results/coverage-*.json`.
The pre-topology subdivision fixtures measured roughly 35-37% to 64-66% building
coverage in shared districts. Current width-hierarchy fixtures measure about 59.5-62%,
retaining over 90% of the dense version's coverage; these are regression
measurements, not universal guarantees.
Matching 600-pixel crops are saved as `coverage-before-neighborhood.png`,
`coverage-after-neighborhood.png`, `coverage-before-south.png`, and
`coverage-after-south.png` for visual comparison, not just numerical validation.
The dense-grid version (`fea8644`) is also built for neighborhood-topology
comparisons. Checks require real boundary-responsive bends, staggered T-junctions,
short connectors, clear lanes, and connectivity from active lanes to block-boundary
routes. `topology-*.json` records coverage and topology measurements, while
`topology-before-neighborhood.png` and `topology-after-neighborhood.png` provide
matching visual crops.
The pre-transition version (`f625b1f`) verifies preserved neighborhood routes and
junctions; widths are intentionally different after the hierarchy pass. Transition
checks cover reciprocal shared-edge targets, monotonic inward
fade, isolated districts, compatible street-facing alignment, and actual building
area contrast across paired boundary frontages. Fixed fixtures show approximately
25-31% lower mean absolute log-area contrast, not a universal visual-similarity
guarantee. `transitions-*.json` records those measurements; matching crops are
`transitions-before-neighborhood.png` and `transitions-after-neighborhood.png`.
The pre-grouping version (`69b0c79`) verifies preserved neighborhood routes and
a tight building-area budget. Checks require groups of 2-5 individual polygons
with positive-length party walls, detached fallbacks, clear end passages, and no
overlaps. `grouping-*.json` records group counts and matching-district areas;
`grouping-before-neighborhood.png` and `grouping-after-neighborhood.png` provide
same-seed visual crops. Test reference servers explicitly close their connections
after captures to avoid waiting indefinitely on browser HTTP teardown.
The pre-hierarchy version (`80d6a85`) verifies preserved route placement and
junction connectivity separately from the intended width changes. Tests measure
reserved polygons against role widths, require narrower connectors and passages,
check building clearance and access, and bound same-district building-area changes
to 3%. The fixed fixtures change building area by less than 1%. Reports are
`hierarchy-*.json`; matching visual crops are `hierarchy-before-neighborhood.png`
and `hierarchy-after-neighborhood.png`.
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
