import { CONTRACT_VERSION, ENGINE_ID, ENGINE_VERSION, type Polygon, type SiteContract } from './contracts';

const polygon = (ring: number[][]): Polygon => ({ type: 'Polygon', coordinates: [ring as [number, number][]] });
const rectangle = (left: number, top: number, right: number, bottom: number): Polygon => polygon([[left, top], [right, top], [right, bottom], [left, bottom], [left, top]]);
const base = (): SiteContract => ({ schemaVersion: CONTRACT_VERSION, engineId: ENGINE_ID, engineVersion: ENGINE_VERSION,
  id: 'open-site', name: 'Open Land', seed: 1091337103,
  coordinates: { units: 'meters', xDirection: 'right', yDirection: 'down', precision: 0.001 },
  land: rectangle(0, 0, 1000, 800), masks: [], protected: [],
  entrances: [{ id: 'west-gate', label: 'West Entrance', position: [0, 400], headingDegrees: 0, clearanceMeters: 8 }],
  background: { label: 'Registered reference raster', pixelWidth: 1000, pixelHeight: 800, origin: [0, 0], metersPerPixel: 1,
    rotationDegrees: 0, opacity: 0.65, fixture: 'open' } });

export const fixtures: { id: string; label: string; create: () => SiteContract }[] = [
  { id: 'open', label: 'Open Land', create: base },
  { id: 'coast', label: 'Curved Coastline', create: () => {
    const site = base(); site.id = 'coastal-site'; site.name = 'Curved Coastline';
    site.masks = [{id: 'coastal-water', label: 'Water', kind: 'water', geometry: polygon([
      [680, 0], [650, 80], [620, 150], [615, 230], [640, 290], [700, 340], [725, 410],
      [710, 480], [660, 540], [605, 600], [590, 670], [620, 735], [670, 800], [1000, 800], [1000, 0], [680, 0],
    ])}];
    site.protected = [{id: 'old-keep', label: 'Old Keep', kind: 'landmark', accessRequired: true, geometry: rectangle(200, 220, 280, 300)}];
    site.entrances.push({id: 'south-gate', label: 'South Entrance', position: [320, 800], headingDegrees: 270, clearanceMeters: 8});
    if (site.background) site.background.fixture = 'coast';
    return site;
  } },
  { id: 'exclusion', label: 'Internal Exclusion', create: () => {
    const site = base(); site.id = 'exclusion-site'; site.name = 'Internal Exclusion';
    site.masks = [{id: 'forbidden-basin', label: 'Forbidden Basin', kind: 'forbidden', geometry: rectangle(390, 270, 610, 510)}];
    site.protected = [{id: 'protected-shrine', label: 'Protected Shrine', kind: 'landmark', accessRequired: true, geometry: rectangle(180, 160, 240, 220)}];
    if (site.background) site.background.fixture = 'exclusion';
    return site;
  } },
  { id: 'conflict', label: 'Conflicting Constraints', create: () => {
    const site = fixtures.find(fixture => fixture.id === 'coast')!.create();
    site.id = 'conflicting-site'; site.name = 'Conflicting Constraints';
    site.protected.push({id: 'flooded-landmark', label: 'Landmark in Water', kind: 'landmark', accessRequired: true, geometry: rectangle(820, 220, 900, 300)});
    site.entrances.push({id: 'blocked-east', label: 'Blocked East Entrance', position: [1000, 400], headingDegrees: 180, clearanceMeters: 8});
    return site;
  } },
];