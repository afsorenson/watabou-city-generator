# Independent Engine: Phase 2 Street Network

## Scope

Phase 2 builds on the Phase 1 site contract and generates a deterministic,
city-spanning street graph inside its buildable land. It does not derive blocks,
plots, or building footprints, and it does not change or import the legacy
generator's wards. A generated graph with multiple disconnected components is
reported as disconnected; it is never presented as a successful connected city.

The `Site & Streets` inspector keeps contract validation and street generation
separate. **Streets** runs the current seed, displays the graph over registered
background/constraints, and reports connectivity. Editing a contract clears the
previous graph. The street layer can be hidden without changing the generated
result. Contract visual approval remains attached to the contract itself; it is
not approval of road composition.

## Generator

`Engine/streets.ts` uses a pinned Delaunay triangulation to construct irregular
junction relationships, plus the pinned `pathfinding` A* implementation to route
them over an occupancy grid derived from the validated buildable multipolygon.
Walkable cells require a radial clearance margin for the widest road. A* uses
eight-direction movement without corner cutting; a greedy line-of-sight simplifier
removes cell-scale turns only when every rasterized grid point remains walkable.

Candidate junctions are sampled deterministically from walkable cells with a
minimum spacing of 12% of the site extent and a cap of 72 points, producing a
blue-noise-like distribution rather than rows and columns. Delaunay edges form a
local neighbor graph. A minimum-spanning backbone connects sampled points, while
a small random subset of short Delaunay edges adds side-street loops. A small set
of more widely spaced hubs is linked by primary routes (14 m); the mesh is
secondary streets (9 m), and required boundary entrances get 7 m access streets.
The hub links participate in the same connectivity structure as the local mesh.
Candidate side routes are rejected when most of their corridor already follows an
existing road. Defaults are internal, not user controls.

Centerlines preserve junction endpoints and smooth the route between them.
Multi-bend paths use corner rounding. Long direct connectors use seeded cubic
Bézier-like bows. Each candidate curve is sampled across its full street width
against buildable land and checked in a local grid occupancy map before acceptance;
curves that fail those checks fall back to the terrain-safe route. Crossings in the
graph itself remain shared junction nodes. Clearance-grid connected components are
computed before routing, so impossible cross-barrier routes are skipped instead
of repeatedly attempting A* across unreachable land.

The network density regression caps total centerline length at 1.8% of buildable
area on the open, coast, and exclusion fixtures. Current default-seed examples
range from 0.011 to 0.014. Against the prior version's roughly 0.020 to 0.028
across these fixtures, the centerline length is about half while each fixture
remains connected. This is a test limit for these fixtures, not a universal
city-planning optimum.

The output still does not have the user's desired final urban character. It is an
irregular procedural street mesh with a visibly dominant hub/radial structure and
no user-placed civic anchors. Some routes can remain straight where curvature
would be unsafe. The raster clearance and sampled road-width checks provide strong
practical safeguards, not a mathematical proof for continuous buffered polygons.
The next visual refinement should focus on varied hierarchy/settlement structure,
less radial dominance, and user-directed anchors before block generation.

## Output And Failures

`generateStreetNetwork(site)` rejects invalid site contracts. It returns the
existing buildable geometry plus `phase: "streets"`, the graph, empty blocks,
plots/buildings, and issues. A valid connected graph has `streets.connected: true`
and one component. Each edge records start/end node IDs, a centerline, width in
meters, and `primary`, `secondary`, or `access` class. Nodes represent entrances,
junctions, or bends. Phase 1's `contractResult()` remains available and still
returns an empty graph with `phase: "contract"`.

If no routed streets fit or the graph cannot be connected without crossing a
constraint, `streets.connected` is false, component count is included, and an
`STREET_NETWORK_DISCONNECTED` error issue explains the result. The partial graph
remains inspectable for diagnosis, but it is not a connected-city result. The
generator does not bridge water, forbidden masks, protected features, or separated
buildable islands. A disconnected region without an entrance cannot be accessed
unless a future contract/phase explicitly provides a legal connection.

**JSON** exports the street graph, buildable area, seed/version, validation, and
connectivity issues. **PNG** shows the current map/layer selection with a phase
label. Neither artifact contains blocks or buildings at this phase.

## Review Checklist

1. Generate Open Land with multiple seeds; verify the network spans the site and
   all street classes read clearly at fit and zoomed views.
2. Generate Curved Coastline; confirm no roads cross water and the accessible land
   remains served.
3. Generate Internal Exclusion; confirm streets route around the exclusion and
   protected landmark.
4. Confirm every required entrance appears as a graph node and connects into the
   city network.
5. Confirm the graph reports one component for the included connected fixtures.
6. Import a full-width forbidden barrier; confirm the inspector reports multiple
   components rather than drawing a false bridge.
7. Change the seed and confirm road placement changes while identical inputs remain
   deterministic.
8. Confirm streets are visualized/exported and blocks, plots, and buildings remain
   empty.

The automated Phase 2 gate verifies deterministic output, non-grid bearings,
curved multi-point centerlines including primary routes, side-street density,
branch junctions, graph connectivity, entrance attachment, seed variation,
centerline and sampled width clearance, a per-area density ceiling,
disconnected-region reporting,
desktop/mobile open/coast/exclusion rendering, layer toggling, and JSON export.
Passing tests does not substitute for the urban-composition visual review.

## Verification

```sh
npm run test:contracts
npm run test:streets
npm run build
npm run test:inspector
npm run test:identity
```

The next phase derives street blocks from the network, including its actual
junction topology and terrain boundary. Do not treat the current road graph as
evidence that a valid block subdivision or frontage system already exists.