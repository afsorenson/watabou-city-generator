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
Footprints-mode filenames end in `-footprints.png` so comparisons are distinct.
Block Rows filenames end in `-frontage.png`.

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
