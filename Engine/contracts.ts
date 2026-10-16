import { z } from 'zod';
import polygonClipping from 'polygon-clipping';
import booleanValid from '@turf/boolean-valid';
import kinks from '@turf/kinks';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import booleanPointOnLine from '@turf/boolean-point-on-line';
import lineIntersect from '@turf/line-intersect';

export const ENGINE_ID = 'frontage-city-engine';
export const ENGINE_VERSION = '0.3.0';
export const CONTRACT_VERSION = 1;
export type Position = [number, number];
export type Polygon = { type: 'Polygon'; coordinates: Position[][] };
export type Land = number[][][][];

const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);
const position = z.tuple([coordinate, coordinate]);
const identifier = z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/);
const polygon = z.object({ type: z.literal('Polygon'), coordinates: z.array(z.array(position).min(4).max(10000)).min(1).max(100) }).strict();
const feature = z.object({ id: identifier, label: z.string().min(1).max(160), geometry: polygon }).strict();

export const siteSchema = z.object({
  schemaVersion: z.literal(CONTRACT_VERSION),
  engineId: z.literal(ENGINE_ID),
  engineVersion: z.literal(ENGINE_VERSION),
  id: identifier,
  name: z.string().min(1).max(160),
  seed: z.number().int().min(1).max(2147483646),
  coordinates: z.object({ units: z.literal('meters'), xDirection: z.literal('right'), yDirection: z.literal('down'), precision: z.literal(0.001) }).strict(),
  land: polygon,
  masks: z.array(feature.extend({ kind: z.enum(['water', 'forbidden']) })).max(100),
  protected: z.array(feature.extend({ kind: z.enum(['landmark', 'reserve']), accessRequired: z.boolean() })).max(100),
  entrances: z.array(z.object({ id: identifier, label: z.string().min(1).max(160), position,
    headingDegrees: z.number().finite().min(0).lt(360), clearanceMeters: z.number().finite().min(0.1).max(100) }).strict()).max(100),
  background: z.object({
    label: z.string().min(1).max(160), pixelWidth: z.number().int().min(1).max(16000), pixelHeight: z.number().int().min(1).max(16000),
    origin: position, metersPerPixel: z.number().finite().gt(0).max(10000), rotationDegrees: z.number().finite().min(-180).max(180),
    opacity: z.number().min(0).max(1), fixture: z.enum(['open', 'coast', 'exclusion']).optional(),
    imageDataUrl: z.string().max(12_000_000).regex(/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/).optional(),
  }).strict().nullable(),
}).strict();

export type SiteContract = z.infer<typeof siteSchema>;
export type Issue = { severity: 'error' | 'warning'; code: string; entityId: string; message: string };
export type Validation = { valid: boolean; issues: Issue[]; buildable: Land; metrics: {
  landArea: number; waterArea: number; forbiddenArea: number; protectedArea: number; buildableArea: number; regions: number;
} };
export type StreetGraph = { connected: boolean; components: number; nodes: { id: string; position: Position }[]; edges: {
  id: string; start: string; end: string; centerline: Position[]; widthMeters: number; kind: 'primary' | 'secondary' | 'access';
}[] };
export type StreetBlock = { id: string; geometry: Polygon; streetIds: string[] };
export type FrontagePlot = { id: string; blockId: string; geometry: Polygon; streetId: string; frontage: Position[] };
export type BuildingFootprint = { id: string; plotId: string; geometry: Polygon };
export type EngineResult = { engineId: typeof ENGINE_ID; engineVersion: typeof ENGINE_VERSION; phase: 'contract' | 'streets'; seed: number;
  buildable: Land; streets: StreetGraph; blocks: StreetBlock[]; plots: FrontagePlot[]; buildings: BuildingFootprint[]; issues: Issue[] };

export const asLand = (shape: Polygon): Land => [shape.coordinates];
export function ringArea(ring: number[][]): number {
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const next = ring[(index + 1) % ring.length];
    area += ring[index][0] * next[1] - next[0] * ring[index][1];
  }
  return Math.abs(area) / 2;
}
export const landArea = (land: Land): number => land.reduce((total, part) => total
  + part.reduce((area, ring, index) => area + (index === 0 ? 1 : -1) * ringArea(ring), 0), 0);
const intersection = (first: Land, second: Land): Land => polygonClipping.intersection(first as never, second as never) as Land;
const difference = (first: Land, second: Land): Land => polygonClipping.difference(first as never, second as never) as Land;

export function validateSite(input: unknown): Validation {
  const issues: Issue[] = [];
  const metrics = { landArea: 0, waterArea: 0, forbiddenArea: 0, protectedArea: 0, buildableArea: 0, regions: 0 };
  const parsed = siteSchema.safeParse(input);
  if (!parsed.success) return { valid: false, buildable: [], metrics,
    issues: parsed.error.issues.map(issue => ({ severity: 'error', code: 'SCHEMA', entityId: issue.path.join('.') || 'site', message: issue.message })) };
  const site = parsed.data;
  const add = (severity: Issue['severity'], code: string, entityId: string, message: string) => issues.push({ severity, code, entityId, message });
  const shapes = [{ id: 'land', geometry: site.land }, ...site.masks, ...site.protected];
  const ids = new Set<string>(['land']);
  for (const feature of [...site.masks, ...site.protected, ...site.entrances]) {
    if (ids.has(feature.id)) add('error', 'DUPLICATE_ID', feature.id, 'Feature identifiers must be unique.');
    ids.add(feature.id);
  }
  for (const feature of shapes) {
    for (const ring of feature.geometry.coordinates) {
      if (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])
        add('error', 'OPEN_RING', feature.id, 'Polygon rings must explicitly close.');
      if (new Set(ring.slice(0, -1).map(point => `${point[0]},${point[1]}`)).size < 3)
        add('error', 'DEGENERATE_RING', feature.id, 'A ring needs three distinct vertices.');
    }
    try {
      if (!booleanValid(feature.geometry) || kinks(feature.geometry).features.length > 0)
        add('error', 'INVALID_POLYGON', feature.id, 'Polygon has invalid holes, intersections, or boundary geometry.');
      const shell: Land = [[feature.geometry.coordinates[0]]];
      let holes: Land = [];
      for (const ring of feature.geometry.coordinates.slice(1)) {
        const hole: Land = [[ring]];
        if (landArea(difference(hole, shell)) > 0.001)
          add('error', 'HOLE_OUTSIDE_SHELL', feature.id, 'Polygon hole must lie entirely inside its outer shell.');
        if (landArea(intersection(hole, holes)) > 0.001)
          add('error', 'OVERLAPPING_HOLES', feature.id, 'Polygon holes must not overlap or contain one another.');
        holes = polygonClipping.union(holes as never, hole as never) as Land;
      }
      if (landArea(asLand(feature.geometry)) <= 0.001) add('error', 'EMPTY_POLYGON', feature.id, 'Polygon must have positive area.');
    } catch { add('error', 'INVALID_POLYGON', feature.id, 'Polygon could not be validated.'); }
  }
  if (issues.some(issue => issue.severity === 'error')) return { valid: false, issues, buildable: [], metrics };
  let buildable: Land = [];
  try {
    const land = asLand(site.land);
    metrics.landArea = landArea(land);
    const tolerance = Math.max(0.001, metrics.landArea * 1e-9);
    let excluded: Land = [];
    let water: Land = [];
    let forbidden: Land = [];
    for (const mask of site.masks) {
      const inside = intersection(land, asLand(mask.geometry));
      if (landArea(inside) <= tolerance) add('warning', 'MASK_OUTSIDE_SITE', mask.id, 'Mask does not intersect the site.');
      if (landArea(intersection(excluded, inside)) > tolerance) add('warning', 'OVERLAPPING_MASKS', mask.id, 'Mask overlaps an existing mask; excluded area is counted once.');
      excluded = polygonClipping.union(excluded as never, inside as never) as Land;
      if (mask.kind === 'water') water = polygonClipping.union(water as never, inside as never) as Land;
      else forbidden = polygonClipping.union(forbidden as never, inside as never) as Land;
    }
    metrics.waterArea = landArea(water); metrics.forbiddenArea = landArea(forbidden);
    let protectedLand: Land = [];
    for (const feature of site.protected) {
      const geometry = asLand(feature.geometry);
      if (landArea(difference(geometry, land)) > tolerance) add('error', 'PROTECTED_OUTSIDE_SITE', feature.id, 'Protected feature extends beyond the site boundary.');
      if (landArea(intersection(geometry, excluded)) > tolerance) add('error', 'PROTECTED_MASK_CONFLICT', feature.id, 'Protected feature overlaps water or forbidden land.');
      if (landArea(intersection(geometry, protectedLand)) > tolerance) add('error', 'PROTECTED_OVERLAP', feature.id, 'Protected features overlap.');
      protectedLand = polygonClipping.union(protectedLand as never, geometry as never) as Land;
    }
    metrics.protectedArea = landArea(intersection(land, protectedLand));
    buildable = difference(difference(land, excluded), protectedLand);
    metrics.buildableArea = landArea(buildable); metrics.regions = buildable.length;
    if (metrics.buildableArea <= tolerance) add('error', 'NO_BUILDABLE_LAND', 'land', 'Constraints leave no buildable land.');
    if (buildable.length > 1) add('warning', 'DISCONNECTED_LAND', 'land', 'Buildable land has multiple regions; later phases must provide access or leave regions undeveloped.');
    for (const entrance of site.entrances) {
      const point = { type: 'Point' as const, coordinates: entrance.position };
      if (!booleanPointOnLine(point, { type: 'LineString', coordinates: site.land.coordinates[0] }, { epsilon: 1e-6 }))
        add('error', 'ENTRANCE_OFF_BOUNDARY', entrance.id, 'Required entrance must lie on the outer site boundary.');
      const angle = entrance.headingDegrees * Math.PI / 180;
      const inward: Position = [entrance.position[0] + Math.cos(angle) * entrance.clearanceMeters,
        entrance.position[1] + Math.sin(angle) * entrance.clearanceMeters];
      const probe = { type: 'Point' as const, coordinates: inward };
      if (!buildable.some(part => booleanPointInPolygon(probe, { type: 'Polygon', coordinates: part }, { ignoreBoundary: true })))
        add('error', 'ENTRANCE_BLOCKED', entrance.id, 'Entrance direction/clearance does not reach buildable land.');
      const path = { type: 'LineString' as const, coordinates: [entrance.position, inward] };
      const obstacles = [site.land, ...site.masks.map(mask => mask.geometry), ...site.protected.map(feature => feature.geometry)];
      if (obstacles.some(obstacle => lineIntersect(path, obstacle).features.some(hit =>
        Math.hypot(hit.geometry.coordinates[0] - entrance.position[0], hit.geometry.coordinates[1] - entrance.position[1]) > 0.001)))
        add('error', 'ENTRANCE_CLEARANCE_BLOCKED', entrance.id, 'Entrance clearance crosses a site boundary, mask, or protected feature.');
    }
    if (!site.entrances.length) add('warning', 'NO_REQUIRED_ENTRANCES', 'land', 'No required entrances are specified; later street growth must choose access explicitly.');
  } catch { add('error', 'GEOMETRY_OPERATION_FAILED', 'land', 'Constraint geometry could not be evaluated safely. No buildable result is approved.'); buildable = []; }
  return { valid: !issues.some(issue => issue.severity === 'error'), issues, buildable, metrics };
}

export function contractResult(site: SiteContract): EngineResult {
  const validation = validateSite(site);
  if (!validation.valid) throw new Error('Invalid contract cannot become engine input.');
  return { engineId: ENGINE_ID, engineVersion: ENGINE_VERSION, phase: 'contract', seed: site.seed,
    buildable: validation.buildable, streets: {connected: false, components: 0, nodes: [], edges: []}, blocks: [], plots: [], buildings: [], issues: [] };
}

export function imageToWorld(point: Position, background: NonNullable<SiteContract['background']>): Position {
  const angle = background.rotationDegrees * Math.PI / 180;
  return [background.origin[0] + background.metersPerPixel * (point[0] * Math.cos(angle) - point[1] * Math.sin(angle)),
    background.origin[1] + background.metersPerPixel * (point[0] * Math.sin(angle) + point[1] * Math.cos(angle))];
}
export function worldToImage(point: Position, background: NonNullable<SiteContract['background']>): Position {
  const angle = background.rotationDegrees * Math.PI / 180;
  const offset = [point[0] - background.origin[0], point[1] - background.origin[1]];
  return [(offset[0] * Math.cos(angle) + offset[1] * Math.sin(angle)) / background.metersPerPixel,
    (-offset[0] * Math.sin(angle) + offset[1] * Math.cos(angle)) / background.metersPerPixel];
}

export function canonicalJson(value: unknown): string {
  const sorted = (input: unknown): unknown => Array.isArray(input) ? input.map(sorted)
    : input && typeof input === 'object' ? Object.fromEntries(Object.entries(input).sort(([first], [second]) => first.localeCompare(second)).map(([key, entry]) => [key, sorted(entry)])) : input;
  return JSON.stringify(sorted(value));
}