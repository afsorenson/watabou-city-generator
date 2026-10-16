import assert from 'node:assert/strict';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(resolve(root, '.toolchain'), { recursive: true });
await build({ entryPoints: [resolve(root, 'Engine/fixtures.ts'), resolve(root, 'Engine/streets.ts')],
  bundle: true, platform: 'node', format: 'esm', outdir: resolve(root, '.toolchain/street-api') });
await build({ entryPoints: [resolve(root, 'Engine/contracts.ts')], bundle: true, platform: 'node', format: 'esm', outfile: resolve(root, '.toolchain/street-api/contracts.js') });
const { fixtures } = await import(pathToFileURL(resolve(root, '.toolchain/street-api/fixtures.js')).href);
const { generateStreetNetwork } = await import(pathToFileURL(resolve(root, '.toolchain/street-api/streets.js')).href);
const { validateSite, canonicalJson } = await import(pathToFileURL(resolve(root, '.toolchain/street-api/contracts.js')).href);

function verifyGraph(site, result) {
  const { streets } = result;
  assert.equal(result.phase, 'streets');
  assert.equal(result.blocks.length + result.plots.length + result.buildings.length, 0, 'Phase 2 must not generate blocks or buildings');
  assert.equal(streets.connected, true, JSON.stringify(result.issues));
  assert.equal(streets.components, 1);
  assert.ok(streets.nodes.length > 8 && streets.edges.length > 8, 'Network must cover the site with real junctions');
  assert.ok(streets.edges.some(edge => edge.kind === 'primary'));
  assert.ok(streets.edges.filter(edge => edge.kind === 'secondary').length > streets.edges.filter(edge => edge.kind === 'primary').length * 2,
    'The primary hierarchy must be supported by a denser side-street network');
  assert.ok(streets.edges.filter(edge => edge.centerline.length > 2).length > streets.edges.length * .5,
    'Most routes should contain rounded, multi-point centerlines');
  assert.ok(streets.edges.some(edge => edge.kind === 'primary' && edge.centerline.length >= 17),
    'Long primary routes should use sampled Bézier-like curves');
  const nodeById = new Map(streets.nodes.map(node => [node.id, node]));
  const adjacent = new Map(streets.nodes.map(node => [node.id, []]));
  const directions = new Set();
  const validation = validateSite(site);
  const land = validation.buildable.map(coordinates => ({ type: 'Polygon', coordinates }));
  for (const edge of streets.edges) {
    assert.ok(nodeById.has(edge.start) && nodeById.has(edge.end), `Missing graph node for ${edge.id}`);
    assert.deepEqual(edge.centerline[0], nodeById.get(edge.start).position);
    assert.deepEqual(edge.centerline.at(-1), nodeById.get(edge.end).position);
    assert.ok(edge.centerline.length >= 2);
    adjacent.get(edge.start).push(edge.end); adjacent.get(edge.end).push(edge.start);
    for (let index = 0; index < edge.centerline.length; index += 1) {
      const point = edge.centerline[index];
      if (index) directions.add(Math.round(Math.atan2(point[1] - edge.centerline[index - 1][1], point[0] - edge.centerline[index - 1][0]) * 180 / Math.PI / 15));
      assert.ok(land.some(polygon => booleanPointInPolygon({ type: 'Point', coordinates: point }, polygon)),
        `Street ${edge.id} leaves buildable land at ${point}`);
      if (index) {
        const previous = edge.centerline[index - 1];
        const midpoint = [(previous[0] + point[0]) / 2, (previous[1] + point[1]) / 2];
        assert.ok(land.some(polygon => booleanPointInPolygon({ type: 'Point', coordinates: midpoint }, polygon)),
          `Street ${edge.id} crosses a constraint boundary`);
        for (const fraction of [.25, .5, .75]) {
          const sample = [previous[0] + (point[0] - previous[0]) * fraction, previous[1] + (point[1] - previous[1]) * fraction];
          const nearEntrance = site.entrances.some(entrance => Math.hypot(sample[0] - entrance.position[0], sample[1] - entrance.position[1]) < 12);
          if (nearEntrance) continue;
          for (let angle = 0; angle < 24; angle += 1) {
            const edgePoint = [sample[0] + Math.cos(angle * Math.PI / 12) * edge.widthMeters / 2,
              sample[1] + Math.sin(angle * Math.PI / 12) * edge.widthMeters / 2];
            assert.ok(land.some(polygon => booleanPointInPolygon({ type: 'Point', coordinates: edgePoint }, polygon)),
              `Street ${edge.id} width crosses a constraint boundary at ${edgePoint}`);
          }
        }
      }
    }
  }
  assert.ok(directions.size >= 12, 'Street bearings should not collapse into a checkerboard of cardinal/diagonal axes');
  assert.ok([...adjacent.values()].filter(neighbors => neighbors.length >= 3).length >= 8, 'Side streets should form a network of real junctions');
  const reached = new Set([streets.nodes[0].id]); const pending = [streets.nodes[0].id];
  while (pending.length) for (const neighbor of adjacent.get(pending.pop()) ?? []) if (!reached.has(neighbor)) { reached.add(neighbor); pending.push(neighbor); }
  assert.equal(reached.size, streets.nodes.length, 'Graph topology must connect through its junction nodes');
  for (const entrance of site.entrances) assert.ok(nodeById.has(`street-g-${entrance.id}`), `Missing entrance node ${entrance.id}`);
  const buildablePoints = validation.buildable.flatMap(part => part[0]);
  const west = Math.min(...buildablePoints.map(point => point[0])); const east = Math.max(...buildablePoints.map(point => point[0]));
  assert.ok(streets.nodes.some(node => node.position[0] > west + (east - west) * .75), 'Network should extend across the buildable area');
}

for (const fixture of fixtures.filter(entry => entry.id !== 'conflict')) {
  const site = fixture.create();
  const result = generateStreetNetwork(site);
  verifyGraph(site, result);
  assert.equal(canonicalJson(result), canonicalJson(generateStreetNetwork(JSON.parse(JSON.stringify(site)))), `${fixture.id}: generation must be deterministic`);
}

const open = fixtures[0].create();
const original = generateStreetNetwork(open);
const changedSeed = { ...open, seed: open.seed + 1 };
assert.notEqual(canonicalJson(original.streets), canonicalJson(generateStreetNetwork(changedSeed).streets), 'Seed should affect street placement');
assert.throws(() => generateStreetNetwork(fixtures.find(entry => entry.id === 'conflict').create()), /invalid site contract/);

const split = fixtures[0].create();
split.masks.push({ id: 'citywide-barrier', label: 'Full-width exclusion', kind: 'forbidden', geometry: {
  type: 'Polygon', coordinates: [[[490,0],[510,0],[510,800],[490,800],[490,0]]],
} });
const disconnected = generateStreetNetwork(split);
assert.equal(disconnected.streets.connected, false, 'A network may not claim to connect across a forbidden barrier');
assert.ok(disconnected.streets.components > 1);
assert.ok(disconnected.issues.some(issue => issue.code === 'STREET_NETWORK_DISCONNECTED'));
console.log('PASS: deterministic Delaunay street network, Bézier-like primary routes, rounded side streets, entrance connections, graph topology, clearance, seed variation, and unreachable-region reporting');