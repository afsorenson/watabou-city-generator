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

`Engine/streets.ts` uses the pinned `pathfinding` A* implementation over an
occupancy grid derived from the validated buildable multipolygon. Grid cells are
marked walkable only when their center and a 12-point radial clearance sample fit
inside buildable land; the sample radius is half the widest street class (7 m).
Routes use four-way movement, preventing diagonal corner-cutting through narrow
obstacles. The test suite additionally samples street-width boundaries at multiple
points along every segment against the buildable polygons.

The network starts with a roughly 115 m staggered lattice, bounded to 2-14 rows
and columns per axis. Junctions receive deterministic seed-based jitter and snap
to nearby clearance-safe cells. Neighboring junctions route horizontally and
vertically with A*, allowing paths to detour around coastlines and exclusions.
Lattice rows/columns at every third interval are primary streets (14 m); remaining
routes are secondary streets (9 m). Required entrances connect to the nearest
junction through 7 m access streets. All dimensions are planar meters.

Raw grid paths are merged into polylines while preserving junctions, bends, and
street-class changes as graph nodes. Crossings share grid nodes, so graph
connectivity is explicit rather than inferred from visual line intersections.
Street IDs and positions are stable for the same contract, engine version, and
seed. A changed seed changes junction placement. A* routes remain deterministic
for a fixed occupancy grid.

This is an initial urban scaffold, not a final style system. The jittered orthogonal
lattice can still feel overly regular, and the fixed road spacing/widths are not
user-configurable. The radial occupancy and width tests are discrete samples, not
a proof that every point of a continuous buffered road polygon fits the buildable
mask. Exact corridor geometry, street hierarchy refinement, and stronger
conformance checks remain candidates for later refinement before deriving blocks.

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

The automated Phase 2 gate verifies deterministic output, graph connectivity,
entrance attachment, seed variation, centerline and sampled width clearance,
disconnected-region reporting, desktop/mobile rendering, layer toggling, and JSON
export. Passing tests does not substitute for the urban-composition visual review.

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