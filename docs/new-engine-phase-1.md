# Independent Engine: Phase 1

## Purpose And Boundary

Watabou is the visual reference, with the goal of equally pleasing or better
results. Exact equivalence with the current hosted generator is not a requirement.
The independent engine must eventually grow a connected, city-wide street network,
derive blocks from streets, assign frontage-owned plots, and place buildings.
It must not inherit the legacy engine's ward polygons as layout containers.

Phase 1 establishes only the input/output contract, terrain constraints, and their
visual inspection. Existing city generation modes remain available and unchanged.
The inspector never loads `TownGenerator.js` or the old frontage geometry adapter.
No Phase 1 action generates streets, blocks, plots, or buildings. Seed changes
change contract identity, not fixture geometry.

## Contract

`Engine/contracts.ts` defines strict runtime schemas and TypeScript types for a
language-neutral JSON interface. Unknown properties and unsupported versions are
rejected, not silently migrated.

- `schemaVersion: 1`, `engineId: "frontage-city-engine"`, `engineVersion: "0.1.0"`.
- Stable site ID/name and integer seed from 1 through 2147483646.
- Planar meters, X increasing right, Y increasing down; declared geometry precision
  is 0.001 meters. Coordinates are finite and bounded to +/-1,000,000 meters.
- Polygonal site land, water/forbidden masks, and protected landmark/reserve polygons.
  Rings explicitly close and can include interior holes; winding is not significant.
- Required entrances have stable IDs, boundary positions, inward headings in degrees,
  and clearance distances. Zero degrees points right; 90 degrees points down.
- Protected features declare whether later street growth must provide access.
- An optional background defines pixel dimensions, world origin, meters/pixel,
  clockwise rotation in this Y-down system, and opacity. Uploaded images are embedded
  as local PNG/JPEG/WebP data URLs. Bundled fixtures use deterministic raster references.

For an image pixel `(u, v)`, world registration applies scale, then rotation about
the image's top-left origin, then translation. The inverse drives the pointer's
image-pixel readout. Crosshairs at world positions 100/100, 900/100, and 100/700 can
be compared with corresponding marks in fixture rasters. These are registration
references, not constraint features.

`validateSite()` returns issues, buildable multipolygon geometry, and area/region
metrics. Buildable geometry is site land minus the union of masks and protected
features; exclusions are not a post-generation crop. Internal exclusions remain
holes. Mask overlaps are unioned once for buildable land; water and forbidden
category totals can overlap each other and should not simply be summed.

`contractResult()` rejects invalid contracts. A valid Phase 1 result contains
buildable geometry and the seed/version, an empty street graph, and empty block,
plot, and building arrays. Types for those later outputs are declared without
implementing their generation. No connectivity or building-quality claim is made.

## Validation

Errors block valid engine output and local visual approval:

- Invalid schema/version, duplicate feature IDs, nonfinite coordinates, or invalid seed.
- Open, degenerate, self-intersecting polygons; out-of-shell or overlapping holes.
- Protected features outside the site, overlapping masks, or overlapping one another.
- Constraints leaving no buildable land.
- Required entrances off the outer site boundary, pointing away from buildable
  interior, or crossing boundaries, masks, or protected features within their clearance.
- In the inspector, an undecodable/missing raster or incorrect declared pixel dimensions.

Warnings remain visible but do not automatically invalidate the contract:

- Masks outside the site or overlapping existing masks.
- Disconnected buildable regions. Later phases must resolve access or leave regions
  undeveloped; Phase 1 does not promise they can all be served.
- No required entrances. Later phases must choose access explicitly.

Geometry checks use Turf and polygon-clipping. Explicit hole containment/overlap
checks supplement Turf's validation because a wholly out-of-shell hole can pass
Turf alone. Entrance checks cover the clearance segment, not only its endpoint.
Raster decoding is an inspector review gate, separate from pure geometric validation.

## Inspect And Review

Open `/inspector.html`, or choose **Site Contract** in the existing generator.
The page identifies the independent engine version, contract version, and compiled
build. Its map supports pan, zoom, fit-to-site, layer visibility, world/image
coordinate readout, and feature selection through constraint/issue lists. Errors
are linked to feature IDs and highlighted on the map.

Fixtures provide four review cases:

1. **Open Land:** the unobstructed baseline, with a required west entrance.
2. **Curved Coastline:** water exclusion, a protected keep, west/south entrances,
   and a registered coastline raster.
3. **Internal Exclusion:** an interior forbidden hole and a protected shrine.
4. **Conflicting Constraints:** a landmark in water and a blocked east entrance;
   this must remain invalid and unapprovable.

Import/edit JSON to change constraint geometry and attributes. There is no polygon
drawing tool, coastline tracing, automatic terrain extraction, or image-driven
geometry inference yet. Uploading an image registers it for visual comparison;
it does not automatically change buildable land. Registration controls edit image
origin, scale, rotation, and opacity without moving constraints.

Review checklist:

1. Land and forbidden/water regions describe the intended growth area.
2. Protected features occupy the correct positions and remain outside masks.
3. Required entrances are on the site edge and point into clear buildable land.
4. Raster alignment matches the world constraints, including scale and rotation.
5. Seed and engine/build identity are the versions being reviewed.
6. Validation issues are understood; the deliberate conflict fixture is rejected.

The Phase 1 acceptance statement is: **"The engine understands where the city may
grow, what it must avoid, and where access must connect."** This is not approval
of street layouts, urban composition, plots, buildings, or final rendering.

**Approve Contract** is a deliberate human action. Approval stores a SHA-256
fingerprint of canonical contract JSON, engine version, build ID, and timestamp
in local browser storage. Changes invalidate the current approval. Returning to an
identical previously reviewed contract on the same build can restore that review.
**Revoke** removes it. Browser storage is local, clearable, and not authenticated
or a tamper-proof signature. It does not automatically save working drafts.
No test or release step records visual approval on the user's behalf.

## Exports And Reproduction

**Contract** exports a JSON review artifact containing contract data, validation,
build/version identity, fingerprint, optional review, and a valid Phase 1 result
only when validation is complete and successful. Invalid drafts can be exported
for diagnosis, but their result and review are null. Import accepts this artifact
or a bare contract; validation and fingerprinting are recomputed. Imported review
claims do not become local approval automatically.

**PNG** exports a 2048 x 1536 diagnostic of the current view/layers with validity,
seed, version/build, and fingerprint prefix. It is not a generated city image.
Exported JSON, not a PNG or fixture URL alone, preserves custom constraints and
embedded uploaded backgrounds.

Fixture URLs accept `?fixture=coast&seed=123`. Custom draft changes are not encoded
in the URL. Engine/browser code participates in the existing build fingerprint;
the built inspector bundle has its own SHA-256 in `build-info.json`. Archived
inspector pages use their archived assets; their back navigation returns to the
current generator.

## Verification And Next Phases

```sh
npm run test:contracts
npm run build
npm run test:inspector
npm run test:identity
```

Contract tests cover deterministic fixtures, holes, conflicts, full entrance
clearance, coordinate-transform roundtrips, invalid input, winding, and empty
layout outputs. Installed-Chrome inspector checks cover desktop/mobile pixels,
overflow, registration/upload, cached-image validation/recovery, conflict gates,
approval persistence/invalidation, JSON/PNG exports, and archived navigation.
Screenshots are written to ignored `test-results/`. Build runs TypeScript checking.
The legacy identity smoke check covers the existing seed/share/compare/export path.

Passing these checks means Phase 1 is ready for human review, not that its visual
gate has been accepted. Phase 2's independent connected street network is now
implemented; see [Phase 2 Street Network](new-engine-phase-2.md). Remaining phases
are derived blocks, frontage/access plots, then building footprints and
renderer/export integration. Deferred legacy performance work and legacy
generation bugs are not part of these phases.