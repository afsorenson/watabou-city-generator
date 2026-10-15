import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import polygonClipping from 'polygon-clipping';
import { startServer } from './serve.mjs';

await mkdir('test-results', { recursive: true });
const { server, url } = await startServer({ port: 0 });
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
const errors = [];

async function geometryHash(page, useParcels = false) {
  const snapshot = await page.evaluate(useParcels => {
    const model = window.__testModel;
    const points = polygon => polygon.map(point => [point.x, point.y]);
    return JSON.stringify({
      patches: model.patches.map((patch, index) => ({
        shape: points(patch.shape),
        geometry: ((useParcels ? model.footprintParcels[index] : null) ?? patch.ward.geometry ?? []).map(points),
        withinCity: patch.withinCity,
        withinWalls: patch.withinWalls,
      })),
      streets: model.streets.map(points),
      roads: model.roads.map(points),
      wall: model.wall ? {
        shape: points(model.wall.shape),
        gates: points(model.wall.gates),
        towers: points(model.wall.towers),
      } : null,
    });
  }, useParcels);
  return createHash('sha256').update(snapshot).digest('hex');
}

function polygonArea(ring) {
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const next = ring[(index + 1) % ring.length];
    area += ring[index][0] * next[1] - next[0] * ring[index][1];
  }
  return Math.abs(area) / 2;
}

async function buildingArea(page) {
  const polygons = await page.evaluate(() => window.__testModel.patches.flatMap(
    patch => patch.ward.geometry.map(polygon => polygon.map(point => [point.x, point.y]))));
  return polygons.reduce((sum, polygon) => sum + polygonArea(polygon), 0);
}

async function checkFrontage(page) {
  const fixture = await page.evaluate(() => {
    const parcel = [[0, 0], [12, 0], [9, 10], [3, 10]];
    const block = [[-2, -2], [14, -2], [14, 20], [-2, 20]];
    const result = window.__testFootprint(
      parcel.map(point => new window.__testPoint(...point)),
      block.map(point => new window.__testPoint(...point)), 9);
    return result.map(point => [point.x, point.y]);
  });
  assert.ok(Math.min(...fixture.map(point => point[1])) <= 0.2,
    'A tapered street-facing parcel must keep its building at the front setback');
  assert.ok(polygonArea(fixture) > 55, 'Independent width/depth fitting must avoid excessive shrinkage');
  assert.equal(fixture.length, 4, 'Frontage fixture must remain rectangular');
  const fallback = await page.evaluate(() => {
    const parcel = [[5, 0], [17, 12], [15, 14], [3, 2]];
    const block = [[-10, -2], [30, -2], [30, 40], [-10, 40]];
    return [parcel, parcel.slice(2).concat(parcel.slice(0, 2))].map(vertices => {
      const result = window.__testFootprint(vertices.map(point => new window.__testPoint(...point)),
        block.map(point => new window.__testPoint(...point)), 9);
      return result.map(point => [point.x, point.y]);
    });
  });
  for (let index = 0; index < fallback[0].length; index += 1) {
    assert.ok(Math.hypot(fallback[0][index][0] - fallback[1][index][0],
      fallback[0][index][1] - fallback[1][index][1]) < 1e-7,
    'Long-edge fallback must not reverse frontage when polygon starting vertex changes');
  }
  console.log('PASS: tapered-parcel frontage setback and occupied area');
}

async function checkFootprints(page) {
  const pairs = await page.evaluate(() => {
    const model = window.__testModel;
    const points = polygon => polygon.map(point => [point.x, point.y]);
    return model.patches.flatMap((patch, patchIndex) => patch.ward.geometry.map((footprint, index) => ({
      footprint: points(footprint),
      parcel: points(model.footprintParcels[patchIndex][index]),
    })));
  });
  const counts = { rectangles: 0, lShapes: 0, stepped: 0 };
  for (const { footprint, parcel } of pairs) {
    if (JSON.stringify(footprint) === JSON.stringify(parcel)) continue;
    assert.ok(footprint.every(point => point.every(Number.isFinite)), 'Footprint coordinates must be finite');
    const area = polygonArea(footprint);
    assert.ok(area > 0 && area < polygonArea(parcel), 'Footprint must leave space inside its parcel');
    const outside = polygonClipping.difference([footprint], [parcel]);
    const outsideArea = outside.reduce((sum, polygon) => sum + polygonArea(polygon[0]), 0);
    assert.ok(outsideArea < 1e-7 * polygonArea(parcel), 'Footprint must remain within its original parcel');
    for (let index = 0; index < footprint.length; index += 1) {
      const previous = footprint[(index + footprint.length - 1) % footprint.length];
      const current = footprint[index];
      const next = footprint[(index + 1) % footprint.length];
      const incoming = [current[0] - previous[0], current[1] - previous[1]];
      const outgoing = [next[0] - current[0], next[1] - current[1]];
      const dot = incoming[0] * outgoing[0] + incoming[1] * outgoing[1];
      assert.ok(Math.abs(dot) < 1e-7 * Math.hypot(...incoming) * Math.hypot(...outgoing),
        'New footprints must have orthogonal corners');
    }
    if (footprint.length === 4) counts.rectangles += 1;
    else if (footprint.length === 6) counts.lShapes += 1;
    else if (footprint.length === 8) counts.stepped += 1;
    else assert.fail('Unexpected footprint shape');
  }
  assert.ok(counts.rectangles > 0, 'Footprint mode must change eligible building parcels');
  return counts;
}

async function checkBlockRows(page) {
  const preservesOutskirts = await page.evaluate(() => {
    const model = window.__testModel;
    if (!model.wall) return true;
    const points = polygons => polygons.map(polygon => polygon.map(point => [point.x, point.y]));
    return model.patches.every((patch, index) => patch.withinWalls
      || JSON.stringify(points(patch.ward.geometry)) === JSON.stringify(points(model.footprintParcels[index])));
  });
  assert.ok(preservesOutskirts, 'Block Rows must preserve original outside-wall development');
  const blocks = await page.evaluate(() => {
    const model = window.__testModel;
    const points = polygon => polygon.map(point => [point.x, point.y]);
    return model.frontageBlocks.flatMap((block, index) => block.length ? [{
      block: points(block),
      courtyard: points(model.frontageCourtyards[index]),
      access: points(model.frontageAccess[index]),
      plots: model.frontagePlots[index].map(points),
      buildings: model.patches[index].ward.geometry.map(points),
    }] : []);
  });
  assert.ok(blocks.length > 0, 'Block Rows must replace eligible blocks');
  let buildingCount = 0;
  let articulated = 0;
  let rearBuildings = 0;
  const clippingArea = polygons => polygons.reduce((sum, polygon) => sum + polygonArea(polygon[0]), 0);
  const bounds = polygon => ({
    minX: Math.min(...polygon.map(point => point[0])), maxX: Math.max(...polygon.map(point => point[0])),
    minY: Math.min(...polygon.map(point => point[1])), maxY: Math.max(...polygon.map(point => point[1])),
  });
  for (const { block, courtyard, access, plots, buildings } of blocks) {
    const tolerance = polygonArea(block) * 1e-7;
    assert.equal(plots.length, buildings.length, 'Every block-row building must retain its owning plot');
    rearBuildings += plots.length - new Set(plots.map(plot => JSON.stringify(plot))).size;
    assert.ok(polygonArea(courtyard) > 0, 'Rows must reserve a nonempty courtyard');
    assert.ok(clippingArea(polygonClipping.intersection([courtyard], [access])) > 0,
      'Access passage must reach the courtyard');
    assert.ok(clippingArea(polygonClipping.difference([access], [block])) > tolerance,
      'Access passage must cross the block boundary to reach the street');
    const boxes = buildings.map(bounds);
    for (let index = 0; index < buildings.length; index += 1) {
      const building = buildings[index];
      assert.ok(building.every(point => point.every(Number.isFinite)), 'Block buildings must have finite coordinates');
      assert.ok(polygonArea(building) > 0, 'Block buildings must have positive area');
      assert.ok(polygonArea(building) < polygonArea(plots[index]),
        'A building footprint must be smaller than its owning frontage plot');
      assert.ok(clippingArea(polygonClipping.difference([building], [plots[index]])) < tolerance,
        'Distinct building footprints must stay inside their owning plots');
      assert.ok([4, 6, 8].includes(building.length), 'Block buildings must be rectangles, L-shapes, or stepped footprints');
      if (building.length > 4) articulated += 1;
      for (let corner = 0; corner < building.length; corner += 1) {
        const previous = building[(corner + building.length - 1) % building.length];
        const current = building[corner];
        const next = building[(corner + 1) % building.length];
        const incoming = [current[0] - previous[0], current[1] - previous[1]];
        const outgoing = [next[0] - current[0], next[1] - current[1]];
        const dot = incoming[0] * outgoing[0] + incoming[1] * outgoing[1];
        assert.ok(Math.abs(dot) < 1e-7 * Math.hypot(...incoming) * Math.hypot(...outgoing),
          'Distinct block-row buildings must not retain wedge-shaped plot corners');
      }
      assert.ok(clippingArea(polygonClipping.difference([building], [block])) < tolerance,
        'Block buildings must stay inside the city block');
      assert.ok(clippingArea(polygonClipping.intersection([building], [courtyard])) < tolerance,
        'Courtyard must remain clear of buildings');
      assert.ok(clippingArea(polygonClipping.intersection([building], [access])) < tolerance,
        'Access passage must remain clear of buildings');
      for (let other = 0; other < index; other += 1) {
        if (boxes[index].maxX < boxes[other].minX || boxes[other].maxX < boxes[index].minX
          || boxes[index].maxY < boxes[other].minY || boxes[other].maxY < boxes[index].minY) continue;
        assert.ok(clippingArea(polygonClipping.intersection([building], [buildings[other]])) < tolerance,
          'Neighboring frontage plots must not overlap');
      }
    }
    buildingCount += buildings.length;
  }
  return { blocks: blocks.length, buildings: buildingCount, articulated, rearBuildings };
}

function pixelVariation(bytes) {
  const image = PNG.sync.read(bytes);
  let differing = 0;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (image.data[offset] !== image.data[0]
      || image.data[offset + 1] !== image.data[1]
      || image.data[offset + 2] !== image.data[2]) differing += 1;
  }
  return differing;
}

function pixelHash(bytes) {
  return createHash('sha256').update(PNG.sync.read(bytes).data).digest('hex');
}

async function capture(page, address, path) {
  await page.goto(address);
  await page.locator('canvas').first().waitFor();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    return canvas?.width > 0 && canvas?.height > 0 && window.__testModel;
  });
  await page.evaluate(() => new Promise(resolveFrame => {
    requestAnimationFrame(() => requestAnimationFrame(resolveFrame));
  }));
  const bytes = await page.screenshot({ path });
  assert.ok(pixelVariation(bytes) > 1000, 'Rendered city must not be blank');
  return bytes;
}

try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(`${page.url()}\n${error.stack ?? error.message}`));
  page.on('response', response => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  await page.route('**/TownGenerator.js', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const assignment = 'com_watabou_towngenerator_building_Model.instance = this;';
    assert.ok(source.includes(assignment), 'Test instrumentation must find the original model assignment');
    await route.fulfill({ response, body: source.replace(assignment,
      `${assignment} window.__testModel = this; window.__testPoint = openfl_geom_Point;
      window.__testFootprint = typeof com_watabou_towngenerator_building_BuildingFootprints === 'undefined'
        ? null : com_watabou_towngenerator_building_BuildingFootprints.create;`) });
  });
  const seedUrl = `${url}/?size=15&seed=682063530`;
  const first = await capture(page, seedUrl, 'test-results/desktop.png');
  const second = await capture(page, seedUrl, 'test-results/desktop-repeat.png');
  assert.equal(pixelHash(first), pixelHash(second), 'Same seed must reproduce the same image');
  const different = await capture(page, `${url}/?size=15&seed=42`, 'test-results/different-seed.png');
  assert.notEqual(pixelHash(first), pixelHash(different), 'Different seeds must change the city');

  const baselineRoot = resolve('.toolchain/upstream-baseline');
  if (existsSync(resolve(baselineRoot, 'index.html'))) {
    const baseline = await startServer({ root: baselineRoot, port: 0 });
    try {
      for (const [size, seed] of [[6, 42], [15, 682063530], [40, 123456]]) {
        const query = `/?size=${size}&seed=${seed}`;
        await capture(page, `${url}${query}`);
        const current = await geometryHash(page);
        await capture(page, `${baseline.url}${query}`, `test-results/upstream-${size}.png`);
        assert.equal(current, await geometryHash(page), `Unspecified walls must preserve original geometry at size ${size}`);
      }
      console.log('PASS: building, street, road, and wall geometry matches upstream at three sizes');
    } finally {
      await new Promise(resolveClose => baseline.server.close(resolveClose));
    }
  } else {
    console.log('SKIP: upstream comparison (no .toolchain/upstream-baseline build)');
  }

  await capture(page, `${url}/?size=40&seed=682063530&walls=1`, 'test-results/desktop.png');
  assert.equal(await page.getByLabel('Walls', { exact: true }).isChecked(), true);
  assert.equal(await page.evaluate(() => window.__testModel.wall !== null), true);
  const walledGeometry = await geometryHash(page);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'city-40-682063530-walled.png');
  await download.saveAs('test-results/export.png');
  const exportedBytes = await readFile('test-results/export.png');
  const exported = PNG.sync.read(exportedBytes);
  assert.equal(exported.width, 2048);
  assert.equal(exported.height, 2048);
  assert.ok(pixelVariation(exportedBytes) > 200000, 'City-focused export must fill a substantial part of the image');
  assert.deepEqual([...exported.data.subarray(0, 4)], [255, 255, 255, 255], 'Export ground must be white');
  for (let offset = 0; offset < exported.data.length; offset += 4) {
    assert.equal(exported.data[offset], exported.data[offset + 1], 'Export must be grayscale');
    assert.equal(exported.data[offset], exported.data[offset + 2], 'Export must be grayscale');
  }

  await page.getByLabel('Walls', { exact: true }).uncheck();
  assert.equal(new URL(page.url()).searchParams.get('walls'), '0');
  assert.equal(await page.evaluate(() => window.__testModel.wall), null);
  assert.equal(new URL(page.url()).searchParams.get('seed'), '682063530');
  const openGeometry = await geometryHash(page);
  await page.reload();
  await page.waitForFunction(() => window.cityGenerator);
  assert.equal(await page.getByLabel('Walls', { exact: true }).isChecked(), false);
  assert.equal(await geometryHash(page), openGeometry, 'Wall-free geometry must survive reload');
  await page.getByLabel('Walls', { exact: true }).check();
  assert.equal(await geometryHash(page), walledGeometry, 'Restoring walls at the same seed must reproduce geometry');
  await page.getByLabel('City size', { exact: true }).fill('24');
  await page.getByLabel('City size', { exact: true }).press('Tab');
  assert.equal(new URL(page.url()).searchParams.get('size'), '24');
  assert.equal(new URL(page.url()).searchParams.get('seed'), '682063530');
  await page.getByRole('button', { name: 'Generate a new city' }).click();
  assert.notEqual(new URL(page.url()).searchParams.get('seed'), '682063530');
  assert.equal(new URL(page.url()).searchParams.get('walls'), '1');

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await capture(page, `${url}/?size=40&seed=682063530&walls=1`, `test-results/mobile-${width}.png`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Toolbar must fit mobile width');
    const toolbar = await page.locator('.toolbar').boundingBox();
    const canvas = await page.locator('canvas').first().boundingBox();
    assert.ok(canvas.y >= toolbar.y + toolbar.height - 1, 'Controls must not overlap the map');
    const mobileDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
    assert.equal((await mobileDownload).suggestedFilename(), 'city-40-682063530-walled.png');
  }
  await page.setViewportSize({ width: 1200, height: 900 });
  await capture(page, `${url}/?size=40&seed=682063530&walls=1`, 'test-results/metropolis.png');
  await capture(page, `${url}/?size=6&seed=42&walls=0&custom=kept#map`, 'test-results/small-open.png');
  await page.getByLabel('Walls', { exact: true }).check();
  assert.equal(new URL(page.url()).searchParams.get('custom'), 'kept');
  assert.equal(new URL(page.url()).hash, '#map');

  let articulated = 0;
  for (const [size, seed, walls] of [[6, 42, 0], [15, 682063530, 1], [40, 682063530, 1]]) {
    const address = `${url}/?size=${size}&seed=${seed}&walls=${walls}`;
    await capture(page, address);
    const original = await geometryHash(page);
    await page.getByLabel('Buildings', { exact: true }).selectOption('footprints');
    assert.equal(await geometryHash(page, true), original, 'Footprints must not change parcels, streets, roads, or walls');
    assert.notEqual(await geometryHash(page), original, 'Footprint mode must change building outlines');
    assert.equal(new URL(page.url()).searchParams.get('seed'), String(seed));
    assert.equal(new URL(page.url()).searchParams.get('buildings'), 'footprints');
    const counts = await checkFootprints(page);
    articulated += counts.lShapes + counts.stepped;
    console.log(`PASS: size ${size} contained footprints: ${JSON.stringify(counts)}`);
    await checkFrontage(page);
    const currentArea = await buildingArea(page);
    const previous = await startServer({ root: resolve('.toolchain/footprints-reference'), port: 0 });
    try {
      await capture(page, `${previous.url}/?size=${size}&seed=${seed}&walls=${walls}&buildings=footprints`,
        `test-results/previous-footprints-${size}.png`);
      const previousArea = await buildingArea(page);
      assert.ok(currentArea > previousArea * 1.05, 'Frontage placement must improve occupied area over centroid-only fitting');
      console.log(`PASS: size ${size} building area improved ${((currentArea / previousArea - 1) * 100).toFixed(1)}%`);
    } finally {
      await new Promise(resolveClose => previous.server.close(resolveClose));
    }
    await capture(page, `${address}&buildings=footprints`);
    const footprintHash = await geometryHash(page);
    await page.reload();
    await page.waitForFunction(() => window.cityGenerator);
    assert.equal(await geometryHash(page), footprintHash, 'Footprints must reproduce after reload');
    assert.equal(await page.getByLabel('Buildings', { exact: true }).inputValue(), 'footprints');
    await page.getByLabel('Buildings', { exact: true }).selectOption('original');
    assert.equal(await geometryHash(page), original, 'Original mode must restore the exact original geometry');
  }
  assert.ok(articulated > 0, 'Footprints must include articulated L-shaped or stepped buildings');

  const footprintUrl = `${url}/?size=40&seed=682063530&walls=1&buildings=footprints`;
  await capture(page, footprintUrl, 'test-results/footprints-desktop.png');
  const footprintDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
  const footprintExport = await footprintDownload;
  assert.equal(footprintExport.suggestedFilename(), 'city-40-682063530-walled-footprints.png');
  await footprintExport.saveAs('test-results/footprints-export.png');
  const footprintPng = PNG.sync.read(await readFile('test-results/footprints-export.png'));
  assert.equal(footprintPng.width, 2048);
  assert.equal(footprintPng.height, 2048);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await capture(page, footprintUrl, `test-results/footprints-mobile-${width}.png`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Building selector must fit mobile width');
    const toolbar = await page.locator('.toolbar').boundingBox();
    const canvas = await page.locator('canvas').first().boundingBox();
    assert.ok(canvas.y >= toolbar.y + toolbar.height - 1, 'Building selector must not overlap the map');
    await page.getByLabel('Walls', { exact: true }).uncheck();
    assert.equal(new URL(page.url()).searchParams.get('buildings'), 'footprints');
    await page.getByRole('button', { name: 'Generate a new city' }).click();
    assert.equal(new URL(page.url()).searchParams.get('buildings'), 'footprints');
  }
  await page.setViewportSize({ width: 1200, height: 900 });
  for (const [size, seed, walls] of [[6, 42, 0], [15, 682063530, 1], [40, 682063530, 1], [40, 123456, 0]]) {
    const address = `${url}/?size=${size}&seed=${seed}&walls=${walls}`;
    await capture(page, address);
    const original = await geometryHash(page);
    await page.getByLabel('Buildings', { exact: true }).selectOption('frontage');
    assert.equal(await geometryHash(page, true), original, 'Block Rows must preserve base parcels, streets, and walls');
    assert.notEqual(await geometryHash(page), original, 'Block Rows must replace building layout');
    const blockStats = await checkBlockRows(page);
    assert.ok(blockStats.articulated > 0, 'Test cities must include distinct L-shaped or stepped block buildings');
    assert.ok(blockStats.rearBuildings > 0, 'Deep plots must support separate front and rear buildings');
    console.log(`PASS: size ${size} block rows: ${JSON.stringify(blockStats)}`);
    const rows = await geometryHash(page);
    await page.reload();
    await page.waitForFunction(() => window.cityGenerator);
    assert.equal(await geometryHash(page), rows, 'Block Rows must reproduce after reload');
    assert.equal(await page.getByLabel('Buildings', { exact: true }).inputValue(), 'frontage');
    await page.getByLabel('Buildings', { exact: true }).selectOption('footprints');
    assert.equal(await geometryHash(page, true), original, 'Switching to Footprints must retain base geometry');
    await checkFootprints(page);
    await page.getByLabel('Buildings', { exact: true }).selectOption('original');
    assert.equal(await geometryHash(page), original, 'Switching from Block Rows must restore Original exactly');
  }
  const rowsUrl = `${url}/?size=40&seed=682063530&walls=1&buildings=frontage`;
  await capture(page, rowsUrl, 'test-results/block-rows-desktop.png');
  const rowsDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
  const rowsExport = await rowsDownload;
  assert.equal(rowsExport.suggestedFilename(), 'city-40-682063530-walled-frontage.png');
  await rowsExport.saveAs('test-results/block-rows-export.png');
  const rowsBytes = await readFile('test-results/block-rows-export.png');
  const rowsPng = PNG.sync.read(rowsBytes);
  assert.equal(rowsPng.width, 2048);
  assert.equal(rowsPng.height, 2048);
  assert.ok(pixelVariation(rowsBytes) > 200000, 'Block Rows export must contain visible city detail');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await capture(page, rowsUrl, `test-results/block-rows-mobile-${width}.png`);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Block Rows controls must fit mobile width');
    const toolbar = await page.locator('.toolbar').boundingBox();
    const canvas = await page.locator('canvas').first().boundingBox();
    assert.ok(canvas.y >= toolbar.y + toolbar.height - 1, 'Block Rows toolbar must not overlap the map');
    await page.getByLabel('Walls', { exact: true }).uncheck();
    assert.equal(new URL(page.url()).searchParams.get('buildings'), 'frontage');
    await page.getByLabel('City size', { exact: true }).fill('24');
    await page.getByLabel('City size', { exact: true }).press('Tab');
    assert.equal(new URL(page.url()).searchParams.get('buildings'), 'frontage');
    await page.getByRole('button', { name: 'Generate a new city' }).click();
    assert.equal(new URL(page.url()).searchParams.get('buildings'), 'frontage');
    const mobileRowsDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
    assert.match((await mobileRowsDownload).suggestedFilename(), /-frontage\.png$/);
  }
  assert.deepEqual(errors, [], 'Browser must not report runtime errors');
  console.log('PASS: seeded walls on/off, size and regeneration controls, desktop/mobile layout, monochrome 2048px PNG export');
} finally {
  await browser.close();
  await new Promise(resolveClose => server.close(resolveClose));
}