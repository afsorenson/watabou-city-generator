import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
const currentBuild = JSON.parse(await readFile('Export/html5/bin/build-info.json', 'utf8'));
assert.equal(createHash('sha256').update(await readFile('Export/html5/bin/TownGenerator.js')).digest('hex'),
  currentBuild.engineSha256, 'Build manifest must fingerprint the compiled engine actually on disk');

async function closeTestServer(server) {
  server.closeAllConnections();
  await new Promise(resolveClose => server.close(resolveClose));
}

async function geometryHash(page, useParcels = false, beforeQuality = false) {
  const snapshot = await page.evaluate(({ useParcels, beforeQuality }) => {
    const model = window.__testModel;
    const points = polygon => polygon.map(point => [point.x, point.y]);
    return JSON.stringify({
      patches: model.patches.map((patch, index) => ({
        shape: points(patch.shape),
        geometry: ((beforeQuality ? model.footprintQualityOriginals[index] : null)
          ?? (useParcels ? model.footprintParcels[index] : null) ?? patch.ward.geometry ?? []).map(points),
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
  }, { useParcels, beforeQuality });
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

async function districtCoverage(page) {
  const districts = await page.evaluate(() => {
    const model = window.__testModel;
    const points = polygon => polygon.map(point => [point.x, point.y]);
    return model.frontageBlocks.flatMap((block, index) => block.length ? [{
      index, name: model.patches[index].ward.getLabel(), block: points(block),
      courtyard: points(model.frontageCourtyards[index]),
      buildings: model.patches[index].ward.geometry.map(points),
    }] : []);
  });
  return districts.map(district => {
    const area = polygonArea(district.block);
    const buildingArea = district.buildings.reduce((sum, building) => sum + polygonArea(building), 0);
    return { index: district.index, name: district.name, area, buildingArea,
      coverage: buildingArea / area, courtyardArea: polygonArea(district.courtyard) };
  });
}

async function neighborhoodLaneHash(page) {
  const snapshot = await page.evaluate(() => {
    const model = window.__testModel;
    const points = polygon => polygon.map(point => [point.x, point.y]);
    return JSON.stringify(model.frontageLanePaths.map((paths, district) => {
      if (!paths.length) return [];
      const kinds = model.frontageLaneKinds[district];
      const spines = paths.filter((path, index) => kinds[index] === 'spine');
      const first = spines[0][0];
      const last = spines[0][spines[0].length - 1];
      const length = Math.hypot(last.x - first.x, last.y - first.y);
      const axis = { x: (last.x - first.x) / length, y: (last.y - first.y) / length };
      const junction = point => {
        let closest = -1;
        let nearest = 0.51;
        spines.forEach((path, index) => {
          for (let segment = 1; segment < path.length; segment += 1) {
            const start = path[segment - 1];
            const end = path[segment];
            const direction = { x: end.x - start.x, y: end.y - start.y };
            const squared = direction.x ** 2 + direction.y ** 2;
            const fraction = Math.max(0, Math.min(1, ((point.x - start.x) * direction.x
              + (point.y - start.y) * direction.y) / squared));
            const distance = Math.hypot(point.x - start.x - fraction * direction.x,
              point.y - start.y - fraction * direction.y);
            if (distance < nearest) { nearest = distance; closest = index; }
          }
        });
        return closest;
      };
      return paths.map((path, index) => kinds[index] === 'spine' ? { kind: 'spine', path: points(path) } : {
        kind: 'connector', offset: Math.round((path[0].x * axis.x + path[0].y * axis.y) * 10000) / 10000,
        start: junction(path[0]), end: junction(path[path.length - 1]),
      });
    }));
  });
  return createHash('sha256').update(snapshot).digest('hex');
}

async function checkStreetHierarchy(page) {
  const districts = await page.evaluate(() => {
    const model = window.__testModel;
    const points = polygon => polygon.map(point => [point.x, point.y]);
    return model.frontageBlocks.flatMap((block, index) => block.length ? [{
      lanes: model.frontageLanes[index].map(points), kinds: model.frontageLaneKinds[index],
      widths: model.frontageLaneWidths[index], passages: model.frontageGroupPassages[index].map(points),
    }] : []);
  });
  let spines = 0;
  let connectors = 0;
  let passages = 0;
  for (const district of districts) {
    assert.equal(district.widths.length, district.lanes.length, 'Every reserved lane must have an explicit width role');
    const spineWidths = district.widths.filter((width, index) => district.kinds[index] === 'spine');
    const connectorWidths = district.widths.filter((width, index) => district.kinds[index] === 'connector');
    assert.ok(spineWidths.every(width => width >= 0.52 && width <= 0.9 && width < 1),
      'Neighborhood spines must remain below the original district-street width');
    assert.ok(connectorWidths.every(width => width >= 0.34 && width <= 0.56 && width < Math.min(...spineWidths)),
      'Local connectors must be narrower than their neighborhood spines');
    district.lanes.forEach((lane, index) => {
      const isSpine = district.kinds[index] === 'spine';
      const opposite = isSpine ? lane.length - 1 : 1;
      const actual = Math.hypot(lane[0][0] - lane[opposite][0], lane[0][1] - lane[opposite][1]);
      assert.ok(Math.abs(actual - district.widths[index]) < 3e-6,
        'Reserved lane geometry must reflect its classified width, not just metadata');
      if (isSpine) spines += 1;
      else connectors += 1;
    });
    for (const passage of district.passages) {
      const width = Math.hypot(passage[0][0] - passage[1][0], passage[0][1] - passage[1][1]);
      assert.ok(width >= 0.18 - 1e-6 && width <= 0.28 + 1e-6 && width < 0.34,
        'Group-end passages must be narrower than local connectors');
      passages += 1;
    }
  }
  assert.ok(spines > 0, 'Test cities must exercise neighborhood spine widths');
  return { spines, connectors, passages };
}

async function checkDistrictTransitions(page) {
  const result = await page.evaluate(() => {
    const make = (baseArea, neighborArea, direction) => {
      const context = Object.create(window.__testDistrictTransitions.prototype);
      context.baseArea = baseArea;
      context.range = 10;
      context.borders = [{ start: new window.__testPoint(0, direction ? 0 : 20),
        end: new window.__testPoint(0, direction ? 20 : 0), neighborArea, neighborIndex: 1 }];
      return context;
    };
    const small = make(16, 100, true);
    const large = make(100, 16, false);
    const smallSamples = [0, 2.5, 5, 10, 20].map(distance => small.sample(new window.__testPoint(-distance, 10)).area);
    const largeSamples = [0, 2.5, 5, 10, 20].map(distance => large.sample(new window.__testPoint(distance, 10)).area);
    const noNeighbors = make(16, 100, true);
    noNeighbors.borders = [];
    const plot = [[0, 0], [12, 0], [12, 8], [0, 8]].map(point => new window.__testPoint(...point));
    const direction = new window.__testPoint(1, 0.02);
    direction.normalize(1);
    const fitted = window.__testFrontageBuilding(plot, plot, 9, true, direction)[0];
    const fittedSide = { x: fitted[1].x - fitted[0].x, y: fitted[1].y - fitted[0].y };
    const alignmentError = Math.abs(fittedSide.x * direction.y - fittedSide.y * direction.x)
      / Math.hypot(fittedSide.x, fittedSide.y);
    let borders = 0;
    let edgeAligned = 0;
    for (let index = 0; index < window.__testModel.frontageTransitions.length; index += 1) {
      const context = window.__testModel.frontageTransitions[index];
      if (!context) continue;
      borders += context.borders.length;
      for (const border of context.borders) {
        const sample = context.sample(new window.__testPoint((border.start.x + border.end.x) / 2,
          (border.start.y + border.end.y) / 2));
        const expected = Math.sqrt(context.baseArea * border.neighborArea);
        if (Math.abs(sample.area - expected) > 1e-7 * expected) throw new Error('Shared-edge target must be the geometric mean');
      }
      for (const building of window.__testModel.patches[index].ward.geometry) {
        const center = { x: building.reduce((sum, point) => sum + point.x, 0) / building.length,
          y: building.reduce((sum, point) => sum + point.y, 0) / building.length };
        const alignment = context.alignmentAt(new window.__testPoint(center.x, center.y));
        if (!alignment) continue;
        const side = { x: building[1].x - building[0].x, y: building[1].y - building[0].y };
        const length = Math.hypot(side.x, side.y);
        if (Math.abs(side.x * alignment.y - side.y * alignment.x) / length < 1e-6) edgeAligned += 1;
      }
    }
    return { smallSamples, largeSamples, isolated: noNeighbors.sample(new window.__testPoint(0, 10)).area,
      interiorAlignment: small.alignmentAt(new window.__testPoint(-20, 10)), alignmentError, borders, edgeAligned };
  });
  assert.ok(Math.abs(result.smallSamples[0] - 40) < 1e-7 && Math.abs(result.largeSamples[0] - 40) < 1e-7,
    'Both sides must converge to the same shared street-edge scale');
  assert.equal(result.smallSamples[3], 16);
  assert.equal(result.smallSamples[4], 16);
  assert.equal(result.largeSamples[3], 100);
  assert.equal(result.largeSamples[4], 100);
  for (let index = 1; index < result.smallSamples.length; index += 1) {
    assert.ok(result.smallSamples[index] <= result.smallSamples[index - 1], 'Small-district blending must fade monotonically inward');
    assert.ok(result.largeSamples[index] >= result.largeSamples[index - 1], 'Large-district blending must fade monotonically inward');
  }
  assert.equal(result.isolated, 16, 'Districts without eligible neighbors must retain their original scale');
  assert.equal(result.interiorAlignment, null, 'District interiors must not be rotated by boundary alignment');
  assert.ok(result.alignmentError < 1e-7, 'A compatible street-facing fit must use the requested shared-edge direction');
  assert.ok(result.borders > 0, 'Test cities must have real shared district boundaries');
  assert.ok(result.edgeAligned > 0, 'Boundary buildings must include street-aligned footprints');
  return { borders: result.borders, edgeAligned: result.edgeAligned };
}

async function transitionGeometry(page) {
  return page.evaluate(() => {
    const model = window.__testModel;
    return model.patches.map(patch => patch.ward.geometry.map(polygon => polygon.map(point => [point.x, point.y])));
  });
}

async function sharedBoundaryPairs(page) {
  return page.evaluate(() => window.__testModel.frontageTransitions.flatMap((context, index) => !context ? [] :
    context.borders.filter(border => border.neighborIndex > index
      && window.__testModel.frontageTransitions[border.neighborIndex]).map(border => ({
      first: index, second: border.neighborIndex, start: [border.start.x, border.start.y],
      end: [border.end.x, border.end.y], range: Math.min(context.range,
        window.__testModel.frontageTransitions[border.neighborIndex].range),
    }))));
}

function boundaryScaleContrast(geometry, borders) {
  const rows = [];
  for (const border of borders) {
    const direction = [border.end[0] - border.start[0], border.end[1] - border.start[1]];
    const lengthSquared = direction[0] ** 2 + direction[1] ** 2;
    const means = [border.first, border.second].map(index => {
      const nearby = geometry[index].filter(building => {
        const center = building.reduce((sum, point) => [sum[0] + point[0] / building.length,
          sum[1] + point[1] / building.length], [0, 0]);
        const projection = ((center[0] - border.start[0]) * direction[0]
          + (center[1] - border.start[1]) * direction[1]) / lengthSquared;
        if (projection < 0.1 || projection > 0.9) return false;
        return Math.abs(direction[0] * (center[1] - border.start[1])
          - direction[1] * (center[0] - border.start[0])) / Math.sqrt(lengthSquared) < border.range * 0.55;
      });
      return nearby.length ? nearby.reduce((sum, building) => sum + polygonArea(building), 0) / nearby.length : null;
    });
    if (means.every(value => value > 0)) rows.push({ first: border.first, second: border.second,
      contrast: Math.abs(Math.log(means[0] / means[1])), meanAreas: means });
  }
  return rows;
}

async function saveNeighborhood(bytes, path, left, top) {
  const image = PNG.sync.read(bytes);
  const crop = new PNG({ width: 600, height: 600 });
  PNG.bitblt(image, crop, left, top, 600, 600, 0, 0);
  await writeFile(path, PNG.sync.write(crop));
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
      parcel: points(model.footprintParcels[patchIndex][model.footprintQualitySources?.[patchIndex]?.[index] ?? index]),
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
      || JSON.stringify(points(model.footprintQualityOriginals?.[index] ?? patch.ward.geometry)) === JSON.stringify(points(model.footprintParcels[index])));
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
      lanes: model.frontageLanes[index].map(points),
      buildings: model.patches[index].ward.geometry.map(points),
    }] : []);
  });
  assert.ok(blocks.length > 0, 'Block Rows must replace eligible blocks');
  let buildingCount = 0;
  let articulated = 0;
  let rearBuildings = 0;
  let courtCount = 0;
  let coveredArea = 0;
  let blockArea = 0;
  const clippingArea = polygons => polygons.reduce((sum, polygon) => sum + polygonArea(polygon[0]), 0);
  const bounds = polygon => ({
    minX: Math.min(...polygon.map(point => point[0])), maxX: Math.max(...polygon.map(point => point[0])),
    minY: Math.min(...polygon.map(point => point[1])), maxY: Math.max(...polygon.map(point => point[1])),
  });
  for (const { block, courtyard, access, plots, lanes, buildings } of blocks) {
    const tolerance = polygonArea(block) * 1e-7;
    blockArea += polygonArea(block);
    coveredArea += buildings.reduce((sum, building) => sum + polygonArea(building), 0);
    assert.equal(plots.length, buildings.length, 'Every block-row building must retain its owning plot');
    rearBuildings += plots.length - new Set(plots.map(plot => JSON.stringify(plot))).size;
    assert.ok(lanes.length > 0, 'Subdivided blocks must reserve secondary lanes');
    if (courtyard.length) {
      courtCount += 1;
      assert.ok(polygonArea(courtyard) < polygonArea(block) * 0.2, 'Selective courtyards must not dominate their block');
      assert.ok(clippingArea(polygonClipping.intersection([courtyard], [access])) > 0,
        'Access lane must reach the optional courtyard');
    }
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
      if (courtyard.length) assert.ok(clippingArea(polygonClipping.intersection([building], [courtyard])) < tolerance,
        'Optional courtyard must remain clear of buildings');
      assert.ok(clippingArea(polygonClipping.intersection([building], [access])) < tolerance,
        'Access passage must remain clear of buildings');
      for (const lane of lanes) {
        assert.ok(clippingArea(polygonClipping.intersection([building], [lane])) < tolerance,
          'Secondary lanes must remain clear of buildings');
      }
      for (let other = 0; other < index; other += 1) {
        if (boxes[index].maxX < boxes[other].minX || boxes[other].maxX < boxes[index].minX
          || boxes[index].maxY < boxes[other].minY || boxes[other].maxY < boxes[index].minY) continue;
        assert.ok(clippingArea(polygonClipping.intersection([building], [buildings[other]])) < tolerance,
          'Neighboring frontage plots must not overlap');
      }
    }
    buildingCount += buildings.length;
  }
  assert.ok(courtCount < blocks.length, 'Courtyards must be selective rather than universal');
  const coverage = coveredArea / blockArea;
  assert.ok(coverage > 0.35, 'Regenerated districts must retain substantial building coverage');
  return { blocks: blocks.length, buildings: buildingCount, articulated, rearBuildings, courtyards: courtCount,
    coverage: Number(coverage.toFixed(3)) };
}

async function checkNeighborhoodTopology(page) {
  const districts = await page.evaluate(() => {
    const model = window.__testModel;
    const points = polygon => polygon.map(point => [point.x, point.y]);
    return model.frontageBlocks.flatMap((block, index) => block.length ? [{
      block: points(block), lanes: model.frontageLanes[index].map(points),
      paths: model.frontageLanePaths[index].map(points), kinds: model.frontageLaneKinds[index],
    }] : []);
  });
  const area = polygons => polygons.reduce((sum, polygon) => sum + polygonArea(polygon[0]), 0);
  let bends = 0;
  let junctions = 0;
  for (const { block, lanes, paths, kinds } of districts) {
    const tolerance = polygonArea(block) * 1e-7;
    assert.equal(paths.length, lanes.length);
    assert.equal(kinds.length, lanes.length);
    const active = lanes.map((lane, index) => ({ index, lane }))
      .filter(({ lane }) => area(polygonClipping.intersection([lane], [block])) > tolerance);
    const connected = new Set(active.filter(({ lane }) => area(polygonClipping.difference([lane], [block])) > tolerance)
      .map(({ index }) => index));
    const adjacency = new Map(active.map(({ index }) => [index, []]));
    for (let first = 0; first < active.length; first += 1) {
      for (let second = 0; second < first; second += 1) {
        if (area(polygonClipping.intersection([active[first].lane], [active[second].lane], [block])) <= tolerance) continue;
        adjacency.get(active[first].index).push(active[second].index);
        adjacency.get(active[second].index).push(active[first].index);
      }
    }
    const pending = [...connected];
    while (pending.length) {
      for (const neighbor of adjacency.get(pending.pop())) {
        if (connected.has(neighbor)) continue;
        connected.add(neighbor);
        pending.push(neighbor);
      }
    }
    assert.equal(connected.size, active.length, 'Every active neighborhood lane must connect to a block-boundary route');
    for (const { index, lane } of active) {
      const path = paths[index];
      if (kinds[index] === 'spine') {
        const start = path[0];
        const end = path[path.length - 1];
        const span = Math.hypot(end[0] - start[0], end[1] - start[1]);
        if (path.some(point => Math.abs((end[0] - start[0]) * (point[1] - start[1])
          - (end[1] - start[1]) * (point[0] - start[0])) / span > 0.02)) bends += 1;
      } else {
        const spines = adjacency.get(index).filter(neighbor => kinds[neighbor] === 'spine');
        assert.ok(spines.length <= 2, 'Connectors must terminate at adjacent spines, not cross the full neighborhood');
        for (const spine of spines) {
          const joint = polygonClipping.intersection([lane], [lanes[spine]], [block]);
          for (const other of active.filter(candidate => candidate.index !== index && kinds[candidate.index] === 'connector')) {
            assert.ok(area(polygonClipping.intersection(joint, [other.lane])) < tolerance,
              'Opposite-band connectors must be staggered T-junctions rather than four-way crossings');
          }
          junctions += 1;
        }
      }
    }
  }
  assert.ok(bends > 0, 'Test cities must include block-boundary-responsive lane bends');
  return { bends, junctions };
}

async function checkBuildingGroups(page) {
  const districts = await page.evaluate(() => {
    const model = window.__testModel;
    const points = polygon => polygon.map(point => [point.x, point.y]);
    return model.frontageBlocks.flatMap((block, index) => block.length ? [{
      buildings: model.patches[index].ward.geometry.map(points), ids: model.frontageGroupIds[index],
      passages: model.frontageGroupPassages[index].map(points),
    }] : []);
  });
  const sharedWall = (first, second) => {
    let longest = 0;
    for (let index = 0; index < first.length; index += 1) {
      const start = first[index];
      const end = first[(index + 1) % first.length];
      const direction = [end[0] - start[0], end[1] - start[1]];
      const length = Math.hypot(...direction);
      if (length < 1e-7) continue;
      for (let other = 0; other < second.length; other += 1) {
        const otherStart = second[other];
        const otherEnd = second[(other + 1) % second.length];
        const distances = [otherStart, otherEnd].map(point => Math.abs(direction[0] * (point[1] - start[1])
          - direction[1] * (point[0] - start[0])) / length);
        if (distances.some(distance => distance > 1e-6)) continue;
        const projections = [otherStart, otherEnd].map(point => ((point[0] - start[0]) * direction[0]
          + (point[1] - start[1]) * direction[1]) / length);
        longest = Math.max(longest, Math.min(length, Math.max(...projections)) - Math.max(0, Math.min(...projections)));
      }
    }
    return longest;
  };
  let groups = 0;
  let attached = 0;
  let detached = 0;
  for (const district of districts) {
    assert.equal(district.ids.length, district.buildings.length, 'Every building must retain group membership metadata');
    const members = new Map();
    district.ids.forEach((id, index) => {
      if (id < 0) detached += 1;
      else members.set(id, [...(members.get(id) ?? []), index]);
    });
    assert.equal(district.passages.length, members.size * 2, 'Each accepted group must reserve two end passages');
    for (const indices of members.values()) {
      assert.ok(indices.length >= 2 && indices.length <= 5, 'Attached frontages must be short groups of 2–5 buildings');
      for (let index = 1; index < indices.length; index += 1) {
        assert.ok(sharedWall(district.buildings[indices[index - 1]], district.buildings[indices[index]]) > 0.3,
          'Consecutive attached buildings must share a positive-length party wall, not merely approach or touch at a point');
      }
      groups += 1;
      attached += indices.length;
    }
    for (const passage of district.passages) {
      assert.ok(polygonArea(passage) > 0, 'Group-end passages must have positive width');
      for (const building of district.buildings) {
        const intersection = polygonClipping.intersection([passage], [building]);
        const overlap = intersection.reduce((sum, polygon) => sum + polygonArea(polygon[0]), 0);
        assert.ok(overlap < 1e-6, 'Group-end passages must remain free of all buildings');
      }
    }
  }
  assert.ok(detached > 0, 'Grouping must preserve a mixture of detached buildings');
  return { groups, attached, detached };
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
  await page.route('**/TownGenerator.js*', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const assignment = 'com_watabou_towngenerator_building_Model.instance = this;';
    assert.ok(source.includes(assignment), 'Test instrumentation must find the original model assignment');
    await route.fulfill({ response, body: source.replace(assignment,
      `${assignment} window.__testModel = this; window.__testPoint = openfl_geom_Point;
      window.__testFootprint = typeof com_watabou_towngenerator_building_BuildingFootprints === 'undefined'
        ? null : com_watabou_towngenerator_building_BuildingFootprints.create;
      window.__testDistrictTransitions = typeof com_watabou_towngenerator_building_DistrictTransitions === 'undefined'
        ? null : com_watabou_towngenerator_building_DistrictTransitions;
      window.__testFrontageBuilding = typeof com_watabou_towngenerator_building_BuildingFootprints === 'undefined'
        ? null : com_watabou_towngenerator_building_BuildingFootprints.fromFrontagePlot;
      window.__testRoofRenderer = typeof com_watabou_towngenerator_mapping_RoofRenderer === 'undefined'
        ? null : com_watabou_towngenerator_mapping_RoofRenderer;
      window.__testQuality = typeof com_watabou_towngenerator_building_FootprintQuality === 'undefined'
        ? null : com_watabou_towngenerator_building_FootprintQuality;
      window.__testRepair = typeof com_watabou_towngenerator_building_BuildingFootprints === 'undefined'
        ? null : com_watabou_towngenerator_building_BuildingFootprints.repairOutlier;
      window.__testPrototype = typeof com_watabou_towngenerator_building_NeighborhoodPrototype === 'undefined'
        ? null : com_watabou_towngenerator_building_NeighborhoodPrototype;`) });
  });
  if (!process.argv.includes('--identity-only') && !process.argv.includes('--roofs-only') && !process.argv.includes('--quality-only') && !process.argv.includes('--prototype-only')) {
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
      await closeTestServer(baseline.server);
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
  assert.equal(download.suggestedFilename(), `city-40-682063530-walled-${currentBuild.id}.png`);
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
    assert.equal((await mobileDownload).suggestedFilename(), `city-40-682063530-walled-${currentBuild.id}.png`);
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
      await closeTestServer(previous.server);
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
  assert.equal(footprintExport.suggestedFilename(), `city-40-682063530-walled-footprints-${currentBuild.id}.png`);
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
    console.log(`CHECK: Block Rows size ${size}, seed ${seed}, walls ${walls}`);
    const address = `${url}/?size=${size}&seed=${seed}&walls=${walls}`;
    await capture(page, address);
    const original = await geometryHash(page);
    await page.getByLabel('Buildings', { exact: true }).selectOption('frontage');
    assert.equal(await geometryHash(page, true), original, 'Block Rows must preserve base parcels, streets, and walls');
    assert.notEqual(await geometryHash(page), original, 'Block Rows must replace building layout');
    const blockStats = await checkBlockRows(page);
    const topology = await checkNeighborhoodTopology(page);
    const hierarchy = await checkStreetHierarchy(page);
    console.log(`PASS: street hierarchy: ${JSON.stringify(hierarchy)}`);
    if (size >= 15) assert.ok(topology.junctions > 0, 'Larger test cities must include staggered T-junctions');
    assert.ok(blockStats.articulated > 0, 'Test cities must include distinct L-shaped or stepped block buildings');
    console.log(`PASS: size ${size} block rows: ${JSON.stringify(blockStats)}`);
    console.log(`PASS: neighborhood topology: ${JSON.stringify(topology)}`);
    const after = await districtCoverage(page);
    const grouping = await checkBuildingGroups(page);
    if (size >= 15) assert.ok(grouping.groups > 0, 'Larger test cities must include real attached frontage groups');
    console.log(`PASS: building grouping: ${JSON.stringify(grouping)}`);
    const transitions = await checkDistrictTransitions(page);
    const lanesBeforeReference = await neighborhoodLaneHash(page);
    const afterGeometry = await transitionGeometry(page);
    const boundaryPairs = await sharedBoundaryPairs(page);
    const hierarchyReference = await startServer({ root: resolve('.toolchain/hierarchy-reference'), port: 0 });
    try {
      await capture(page, `${hierarchyReference.url}/?size=${size}&seed=${seed}&walls=${walls}&buildings=frontage`,
        `test-results/hierarchy-before-${size}-${seed}.png`);
      assert.equal(await neighborhoodLaneHash(page), lanesBeforeReference,
        'Width hierarchy must preserve route placement and junction connectivity');
      const before = await districtCoverage(page);
      const shared = after.flatMap(district => {
        const previous = before.find(candidate => candidate.index === district.index);
        return previous ? [{ before: previous, after: district }] : [];
      });
      const oldArea = shared.reduce((sum, pair) => sum + pair.before.buildingArea, 0);
      const newArea = shared.reduce((sum, pair) => sum + pair.after.buildingArea, 0);
      assert.ok(shared.length > 0 && newArea >= oldArea * 0.97 && newArea <= oldArea * 1.03,
        'Width hierarchy must keep matching-district building area within 3% of the previous version');
      await writeFile(`test-results/hierarchy-${size}-${seed}.json`, JSON.stringify({ size, seed, walls,
        hierarchy, oldArea, newArea, districts: shared }, null, 2));
      console.log(`PASS: street hierarchy building-area change ${((newArea / oldArea - 1) * 100).toFixed(2)}%`);
      if (size === 40 && walls === 1) {
        const download = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
        await (await download).saveAs('test-results/hierarchy-before-export.png');
        await saveNeighborhood(await readFile('test-results/hierarchy-before-export.png'),
          'test-results/hierarchy-before-neighborhood.png', 500, 450);
      }
    } finally {
      await closeTestServer(hierarchyReference.server);
    }
    const groupingReference = await startServer({ root: resolve('.toolchain/grouping-reference'), port: 0 });
    try {
      await capture(page, `${groupingReference.url}/?size=${size}&seed=${seed}&walls=${walls}&buildings=frontage`,
        `test-results/grouping-before-${size}-${seed}.png`);
      assert.equal(await neighborhoodLaneHash(page), lanesBeforeReference, 'Attached grouping must preserve every neighborhood lane');
      const before = await districtCoverage(page);
      const shared = after.flatMap(district => {
        const previous = before.find(candidate => candidate.index === district.index);
        return previous ? [{ before: previous, after: district }] : [];
      });
      const oldArea = shared.reduce((sum, pair) => sum + pair.before.buildingArea, 0);
      const newArea = shared.reduce((sum, pair) => sum + pair.after.buildingArea, 0);
      assert.ok(shared.length > 0 && newArea >= oldArea * 0.97 && newArea <= oldArea * 1.08,
        'Attached groups must preserve the pre-grouping building-area budget');
      await writeFile(`test-results/grouping-${size}-${seed}.json`, JSON.stringify({ size, seed, walls,
        grouping, oldArea, newArea, districts: shared }, null, 2));
      if (size === 40 && walls === 1) {
        const download = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
        await (await download).saveAs('test-results/grouping-before-export.png');
        await saveNeighborhood(await readFile('test-results/grouping-before-export.png'),
          'test-results/grouping-before-neighborhood.png', 500, 450);
      }
    } finally {
      await closeTestServer(groupingReference.server);
    }
    const transitionReference = await startServer({ root: resolve('.toolchain/transitions-reference'), port: 0 });
    try {
      await capture(page, `${transitionReference.url}/?size=${size}&seed=${seed}&walls=${walls}&buildings=frontage`,
        `test-results/transitions-before-${size}-${seed}.png`);
      assert.equal(await neighborhoodLaneHash(page), lanesBeforeReference, 'District transitions must not alter neighborhood lanes or junctions');
      const beforeContrast = boundaryScaleContrast(await transitionGeometry(page), boundaryPairs);
      const afterContrast = boundaryScaleContrast(afterGeometry, boundaryPairs);
      const pairs = afterContrast.flatMap(pair => {
        const previous = beforeContrast.find(candidate => candidate.first === pair.first && candidate.second === pair.second);
        return previous ? [{ before: previous, after: pair }] : [];
      });
      const oldMean = pairs.reduce((sum, pair) => sum + pair.before.contrast, 0) / pairs.length;
      const newMean = pairs.reduce((sum, pair) => sum + pair.after.contrast, 0) / pairs.length;
      assert.ok(pairs.length > 0 && Number.isFinite(oldMean) && Number.isFinite(newMean),
        'Transition comparison must measure actual paired boundary frontages');
      assert.ok(newMean < oldMean * 0.95, 'District blending must reduce measured boundary building-size contrast');
      await writeFile(`test-results/transitions-${size}-${seed}.json`, JSON.stringify({ size, seed, walls,
        transitions, oldMean, newMean, boundaries: pairs }, null, 2));
      console.log(`PASS: district contexts ${JSON.stringify(transitions)}, measured boundary contrast ${oldMean.toFixed(3)} -> ${newMean.toFixed(3)}`);
      if (size === 40 && walls === 1) {
        const previousDownload = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
        await (await previousDownload).saveAs('test-results/transitions-before-export.png');
        await saveNeighborhood(await readFile('test-results/transitions-before-export.png'),
          'test-results/transitions-before-neighborhood.png', 500, 450);
      }
    } finally {
      await closeTestServer(transitionReference.server);
    }
    const topologyReference = await startServer({ root: resolve('.toolchain/topology-reference'), port: 0 });
    try {
      await capture(page, `${topologyReference.url}/?size=${size}&seed=${seed}&walls=${walls}&buildings=frontage`,
        `test-results/topology-before-${size}-${seed}.png`);
      const before = await districtCoverage(page);
      const shared = after.flatMap(district => {
        const previous = before.find(candidate => candidate.index === district.index);
        return previous ? [{ before: previous, after: district }] : [];
      });
      const totalArea = shared.reduce((sum, pair) => sum + pair.after.area, 0);
      const previousCoverage = shared.reduce((sum, pair) => sum + pair.before.buildingArea, 0) / totalArea;
      const currentCoverage = shared.reduce((sum, pair) => sum + pair.after.buildingArea, 0) / totalArea;
      assert.ok(shared.length > 0 && currentCoverage >= previousCoverage * 0.9,
        'Organic lanes must retain at least 90% of the previous dense version\'s same-district coverage');
      await writeFile(`test-results/topology-${size}-${seed}.json`, JSON.stringify({ size, seed, walls,
        previousCoverage, currentCoverage, topology, districts: shared }, null, 2));
      console.log(`PASS: topology coverage ${(previousCoverage * 100).toFixed(1)}% -> ${(currentCoverage * 100).toFixed(1)}%`);
      if (size === 40 && walls === 1) {
        const previousDownload = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
        await (await previousDownload).saveAs('test-results/topology-before-export.png');
        await saveNeighborhood(await readFile('test-results/topology-before-export.png'),
          'test-results/topology-before-neighborhood.png', 500, 450);
      }
    } finally {
      await closeTestServer(topologyReference.server);
    }
    const reference = await startServer({ root: resolve('.toolchain/coverage-reference'), port: 0 });
    try {
      await capture(page, `${reference.url}/?size=${size}&seed=${seed}&walls=${walls}&buildings=frontage`,
        `test-results/coverage-before-${size}-${seed}.png`);
      const before = await districtCoverage(page);
      const shared = after.flatMap(district => {
        const previous = before.find(candidate => candidate.index === district.index);
        return previous ? [{ before: previous, after: district }] : [];
      });
      assert.ok(shared.length > 0, 'Density comparison must use matching districts');
      const area = shared.reduce((sum, pair) => sum + pair.after.area, 0);
      const oldCoverage = shared.reduce((sum, pair) => sum + pair.before.buildingArea, 0) / area;
      const newCoverage = shared.reduce((sum, pair) => sum + pair.after.buildingArea, 0) / area;
      assert.ok(newCoverage > oldCoverage * 1.2, 'Interior subdivision must improve same-district coverage');
      assert.ok(shared.filter(pair => pair.after.courtyardArea > 0).length
        < shared.filter(pair => pair.before.courtyardArea > 0).length,
      'Interior subdivision must reduce universal courtyard layouts');
      await writeFile(`test-results/coverage-${size}-${seed}.json`, JSON.stringify({ size, seed, walls,
        oldCoverage, newCoverage, districts: shared }, null, 2));
      console.log(`PASS: matching districts coverage ${(oldCoverage * 100).toFixed(1)}% -> ${(newCoverage * 100).toFixed(1)}%`);
      if (size === 40 && walls === 1) {
        const previousDownload = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
        const previousExport = await previousDownload;
        await previousExport.saveAs('test-results/coverage-before-export.png');
        const bytes = await readFile('test-results/coverage-before-export.png');
        await saveNeighborhood(bytes, 'test-results/coverage-before-neighborhood.png', 500, 450);
        await saveNeighborhood(bytes, 'test-results/coverage-before-south.png', 750, 1100);
      }
    } finally {
      await closeTestServer(reference.server);
    }
    await capture(page, `${address}&buildings=frontage`, `test-results/coverage-after-${size}-${seed}.png`);
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
  assert.equal(rowsExport.suggestedFilename(), `city-40-682063530-walled-frontage-${currentBuild.id}.png`);
  await rowsExport.saveAs('test-results/block-rows-export.png');
  const rowsBytes = await readFile('test-results/block-rows-export.png');
  await saveNeighborhood(rowsBytes, 'test-results/coverage-after-neighborhood.png', 500, 450);
  await saveNeighborhood(rowsBytes, 'test-results/topology-after-neighborhood.png', 500, 450);
  await saveNeighborhood(rowsBytes, 'test-results/transitions-after-neighborhood.png', 500, 450);
  await saveNeighborhood(rowsBytes, 'test-results/grouping-after-neighborhood.png', 500, 450);
  await saveNeighborhood(rowsBytes, 'test-results/hierarchy-after-neighborhood.png', 500, 450);
  await saveNeighborhood(rowsBytes, 'test-results/coverage-after-south.png', 750, 1100);
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
    assert.ok((await mobileRowsDownload).suggestedFilename().endsWith(`-frontage-${currentBuild.id}.png`));
  }
  await page.setViewportSize({ width: 1200, height: 900 });
  }
  if (!process.argv.includes('--roofs-only') && !process.argv.includes('--quality-only') && !process.argv.includes('--prototype-only')) {
  const restoreUrl = `${url}/?size=40&seed=682063530&walls=1&buildings=frontage`;
  await capture(page, `${url}/?size=6&seed=2147483647&walls=0`);
  assert.ok(Number(new URL(page.url()).searchParams.get('seed')) >= 1
    && Number(new URL(page.url()).searchParams.get('seed')) <= 2147483646,
  'Invalid URL seeds must be replaced with a valid generator seed');
  await capture(page, restoreUrl, 'test-results/identity-desktop.png');
  const originalCity = await geometryHash(page);
  assert.equal(await page.locator('#build-id').textContent(), currentBuild.id);
  assert.equal(await page.evaluate(() => window.cityGenerator.buildId), currentBuild.id);
  for (const invalidSeed of ['0', '2147483647', '1.5']) {
    await page.getByLabel('Seed', { exact: true }).fill(invalidSeed);
    await page.getByRole('button', { name: 'Apply seed' }).click();
    assert.equal(await geometryHash(page), originalCity, 'Invalid seed input must not change the city');
  }
  await page.getByLabel('Seed', { exact: true }).fill('42');
  await page.getByRole('button', { name: 'Apply seed' }).click();
  assert.equal(new URL(page.url()).searchParams.get('seed'), '42');
  assert.notEqual(await geometryHash(page), originalCity);
  await page.getByLabel('Seed', { exact: true }).fill('682063530');
  await page.getByRole('button', { name: 'Apply seed' }).click();
  assert.equal(await geometryHash(page), originalCity, 'Applying the old seed must restore the exact city');
  await page.getByRole('button', { name: 'Generate a new city' }).click();
  assert.notEqual(new URL(page.url()).searchParams.get('seed'), '682063530');
  await page.getByLabel('Seed', { exact: true }).fill('682063530');
  await page.getByRole('button', { name: 'Apply seed' }).click();
  await page.reload();
  await page.waitForFunction(() => window.cityGenerator);
  assert.equal(await geometryHash(page), originalCity, 'Seed restoration must survive refresh');

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url });
  await page.getByRole('button', { name: 'Copy city link' }).click();
  await page.waitForFunction(() => document.querySelector('#build-status').textContent === 'City link copied.');
  const cityLink = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(new URL(cityLink).pathname.includes(`/builds/${currentBuild.id}/`), 'Copied links must bind to an actual archived build');
  assert.equal(new URL(cityLink).searchParams.get('walls'), '1');
  assert.equal(new URL(cityLink).searchParams.get('buildings'), 'frontage');
  await capture(page, cityLink);
  assert.equal(await geometryHash(page), originalCity, 'Version-bound links must restore geometry and settings');
  assert.equal(await page.evaluate(() => window.cityGenerator.buildId), currentBuild.id);
  await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Clipboard unavailable'); }; });
  await page.getByRole('button', { name: 'Copy city link' }).click();
  assert.equal(await page.locator('#link-dialog').isVisible(), true);
  assert.equal(await page.locator('#city-link').inputValue(), cityLink, 'Clipboard fallback must preserve the same version-bound link');
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByRole('button', { name: 'Compare builds' }).click();
  await page.waitForFunction(() => !document.querySelector('[aria-label="Download after PNG"]')?.disabled,
    { timeout: 60000 });
  assert.equal(new URL(page.url()).searchParams.get('seed'), '682063530');
  assert.equal(new URL(page.url()).searchParams.get('size'), '40');
  assert.equal(new URL(page.url()).searchParams.get('walls'), '1');
  assert.equal(new URL(page.url()).searchParams.get('buildings'), 'frontage');
  assert.equal(await page.locator('[data-side="after"] .comparison-build').textContent(), currentBuild.id);
  assert.ok(pixelVariation(await page.locator('[data-side="after"] canvas').screenshot()) > 1000,
    'Comparison must show a rendered city, not just labels');
  await page.screenshot({ path: 'test-results/comparison-desktop.png' });
  const wholeDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download after PNG' }).click();
  const wholeExport = await wholeDownload;
  assert.ok(wholeExport.suggestedFilename().includes(currentBuild.id));
  await wholeExport.saveAs('test-results/comparison-after.png');
  assert.equal(PNG.sync.read(await readFile('test-results/comparison-after.png')).width, 2048);
  await page.getByLabel('Comparison view', { exact: true }).selectOption('northwest');
  assert.equal(new URL(page.url()).searchParams.get('view'), 'northwest');
  assert.ok(pixelVariation(await page.locator('[data-side="before"] canvas').screenshot()) > 1000,
    'Matching neighborhood crop must contain real map pixels');
  const cropDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download after PNG' }).click();
  const cropExport = await cropDownload;
  assert.ok(cropExport.suggestedFilename().endsWith('-northwest.png'));
  await cropExport.saveAs('test-results/comparison-crop.png');
  assert.equal(PNG.sync.read(await readFile('test-results/comparison-crop.png')).width, 600);
  await page.getByRole('button', { name: 'Copy comparison link' }).click();
  const comparisonLink = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(new URL(comparisonLink).searchParams.get('after'), currentBuild.id);
  assert.equal(new URL(comparisonLink).searchParams.get('view'), 'northwest');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.screenshot({ path: `test-results/comparison-mobile-${width}.png` });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Comparison controls must fit mobile width');
  }
  await page.goto(comparisonLink);
  await page.waitForFunction(() => !document.querySelector('[aria-label="Download after PNG"]')?.disabled,
    { timeout: 60000 });
  assert.equal(await page.getByLabel('Comparison view', { exact: true }).inputValue(), 'northwest');
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.getByLabel('Before build', { exact: true }).selectOption(currentBuild.id);
  await page.getByLabel('Seed', { exact: true }).fill('42');
  await page.getByLabel('City size', { exact: true }).fill('15');
  await page.getByLabel('Walls', { exact: true }).uncheck();
  await page.getByLabel('Comparison buildings', { exact: true }).selectOption('footprints');
  await page.getByRole('button', { name: 'Apply comparison settings' }).click();
  await page.waitForFunction(() => !document.querySelector('[aria-label="Download after PNG"]').disabled);
  await page.waitForFunction(() => document.querySelector('#comparison-status').textContent
    === 'Seed 42 · Size 15 · Open · footprints');
  assert.equal(new URL(page.url()).searchParams.get('seed'), '42');
  assert.equal(new URL(page.url()).searchParams.get('size'), '15');
  assert.equal(new URL(page.url()).searchParams.get('walls'), '0');
  assert.equal(new URL(page.url()).searchParams.get('buildings'), 'footprints');
  const comparisonImages = await page.evaluate(() => ['before', 'after'].map(side =>
    document.querySelector(`[data-side="${side}"] canvas`).toDataURL().split(',')[1]));
  const comparisonBuffers = comparisonImages.map(image => Buffer.from(image, 'base64'));
  await writeFile('test-results/comparison-equal-before.png', comparisonBuffers[0]);
  await writeFile('test-results/comparison-equal-after.png', comparisonBuffers[1]);
  const beforePixels = PNG.sync.read(comparisonBuffers[0]);
  const afterPixels = PNG.sync.read(comparisonBuffers[1]);
  let changedPixels = 0;
  for (let offset = 0; offset < beforePixels.data.length; offset += 4) {
    if (beforePixels.data[offset] !== afterPixels.data[offset]
      || beforePixels.data[offset + 1] !== afterPixels.data[offset + 1]
      || beforePixels.data[offset + 2] !== afterPixels.data[offset + 2]) changedPixels += 1;
  }
  assert.equal(changedPixels, 0, 'The same build and locked settings must render identical matching crops');
  const changedDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download after PNG' }).click();
  assert.ok((await changedDownload).suggestedFilename().startsWith('city-15-42-open-footprints-after-'));
  await page.goto(`${url}/compare.html?before=unavailable-build&after=${currentBuild.id}`);
  await page.waitForFunction(() => document.querySelector('#comparison-status').textContent.includes('unavailable'));
  assert.equal(await page.getByRole('button', { name: 'Download after PNG' }).isDisabled(), true,
    'A missing archived engine must not silently render or export the current engine');
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(cityLink);
  await page.waitForFunction(() => window.cityGenerator);
  await page.screenshot({ path: 'test-results/identity-mobile-320.png' });
  assert.equal(await geometryHash(page), originalCity);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Seed and build controls must fit mobile width');
  console.log('PASS: compiled build identity, editable seed restoration, version-bound sharing, real-build comparison, matching crops and mobile layout');
  }
  if (!process.argv.includes('--identity-only') && !process.argv.includes('--quality-only') && !process.argv.includes('--prototype-only')) {
    await page.setViewportSize({ width: 1200, height: 900 });
    const roofUrl = `${url}/?size=40&seed=1091337103&walls=1&buildings=frontage`;
    await capture(page, roofUrl, 'test-results/roof-flat-desktop.png');
    const initialGeometry = await geometryHash(page);
    await page.evaluate(() => { window.__beforeRoofModel = window.__testModel; });
    const fixturePlans = await page.evaluate(() => {
      const fixtures = [
        [[0, 0], [8, 0], [8, 4], [0, 4]],
        [[0, 0], [8, 0], [8, 3], [3, 3], [3, 8], [0, 8]],
        [[0, 0], [10, 0], [10, 4], [7, 4], [7, 7], [3, 7], [3, 4], [0, 4]],
        [[0, 0], [7, 1], [5, 6], [1, 5]],
        [[0, 0], [9, 1], [3, 7]],
        [[0, 0], [8, 1], [10, 5], [5, 9], [-1, 5]],
        [[0, 0], [9, 1], [8, 7], [5, 4], [2, 8], [-1, 5]],
        [[0, 0], [1, 5], [5, 6], [7, 1]],
        [[0, 0], [4, 0.5], [8, 1], [7, 6], [1, 5]],
      ];
      return fixtures.flatMap((fixture, fixtureIndex) => [0, Math.PI / 5].map(angle => {
        const footprint = fixture.map(point => new window.__testPoint(point[0] * Math.cos(angle) - point[1] * Math.sin(angle),
          point[0] * Math.sin(angle) + point[1] * Math.cos(angle)));
        const plan = window.__testRoofRenderer.plan(footprint);
        const points = polygon => polygon.map(point => [point.x, point.y]);
        return { footprint: points(footprint), fixtureIndex, kind: plan.kind, faces: plan.faces.map(face => ({ polygon: points(face.polygon), light: face.light, color: face.color })),
          sections: plan.sections.map(points), ridges: plan.ridges.map(points) };
      }));
    });
    const areaOf = polygons => polygons.reduce((sum, polygon) => sum + polygonArea(polygon[0]), 0);
    for (const plan of fixturePlans) {
      const area = polygonArea(plan.footprint);
      if (plan.fixtureIndex === 6) {
        assert.equal(plan.kind, 'restrained', 'Difficult irregular concave shapes must use a restrained fallback');
        assert.equal(plan.faces.length, 1);
        assert.equal(plan.ridges.length, 0, 'Concave fallback must not invent a bounding-box ridge');
      } else assert.ok(plan.faces.length >= 2 && plan.faces.some(face => face.light) && plan.faces.some(face => !face.light),
        'Supported roof plans must include contrasting planes');
      if ([3, 4, 5, 7, 8].includes(plan.fixtureIndex)) {
        assert.equal(plan.kind, 'hipped', 'Suitable irregular convex footprints must receive hipped roofs');
        assert.ok(plan.faces.length >= 3, 'A hip roof must have perimeter-driven faces rather than an arbitrary two-way split');
        const boundary = plan.sections[0];
        const distances = point => boundary.map((start, index) => {
          const end = boundary[(index + 1) % boundary.length];
          const direction = [end[0] - start[0], end[1] - start[1]];
          return (direction[0] * (point[1] - start[1]) - direction[1] * (point[0] - start[0])) / Math.hypot(...direction);
        });
        for (const ridge of plan.ridges) {
          for (const fraction of [0, 0.5, 1]) {
            const point = [ridge[0][0] + fraction * (ridge[1][0] - ridge[0][0]),
              ridge[0][1] + fraction * (ridge[1][1] - ridge[0][1])];
            const heights = distances(point).sort((first, second) => first - second);
            assert.ok(heights[0] >= -1e-5 && Math.abs(heights[0] - heights[1]) < 1e-5,
              'Hip/ridge lines must join equal-height edge planes inside the footprint');
          }
        }
      }
      if ([1, 2].includes(plan.fixtureIndex)) assert.ok(plan.sections.length > 1, 'L-shaped and stepped roofs need multiple sections');
      let covered = 0;
      for (let index = 0; index < plan.faces.length; index += 1) {
        const face = plan.faces[index].polygon;
        assert.ok(face.every(point => point.every(Number.isFinite)));
        assert.ok(areaOf(polygonClipping.difference([face], [plan.footprint])) < area * 1e-6,
          'Roof faces must remain inside the original footprint');
        for (let previous = 0; previous < index; previous += 1) {
          assert.ok(areaOf(polygonClipping.intersection([face], [plan.faces[previous].polygon])) < area * 1e-6,
            'Roof planes must not overlap in area');
        }
        covered += polygonArea(face);
      }
      assert.ok(Math.abs(covered - area) < area * 1e-6, 'Roof sections must cover the entire footprint without filling notches');
    }
    const flatDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
    await (await flatDownload).saveAs('test-results/roof-flat-export.png');
    const flatBytes = await readFile('test-results/roof-flat-export.png');
    const catalogBefore = JSON.parse(await readFile('Export/html5/bin/builds.json', 'utf8'));
    const previousRoofBuild = catalogBefore.builds.find(build => build.commit === '9fcb9d3' && !build.dirty);
    if (previousRoofBuild) {
      await capture(page, `${url}/${previousRoofBuild.url}?size=40&seed=1091337103&walls=1&buildings=frontage&style=roofed`);
      const previousExport = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
      await (await previousExport).saveAs('test-results/irregular-roofs-before-export.png');
      await saveNeighborhood(await readFile('test-results/irregular-roofs-before-export.png'),
        'test-results/irregular-roofs-before-neighborhood.png', 420, 420);
      await capture(page, roofUrl);
    }
    await page.evaluate(() => { window.__beforeRoofModel = window.__testModel; });
    await page.getByLabel('Rendering style', { exact: true }).selectOption('roofed');
    await page.waitForFunction(() => window.cityGenerator.roofed === true);
    assert.equal(await geometryHash(page), initialGeometry, 'Roofed must not change buildings, roads, or walls');
    assert.ok(await page.evaluate(() => window.__testModel === window.__beforeRoofModel), 'Style changes must reuse the generated model');
    assert.equal(new URL(page.url()).searchParams.get('style'), 'roofed');
    const roofDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
    const roofExport = await roofDownload;
    assert.ok(roofExport.suggestedFilename().includes(`-roofed-${currentBuild.id}.png`));
    await roofExport.saveAs('test-results/roofed-export.png');
    const roofBytes = await readFile('test-results/roofed-export.png');
    const roofPng = PNG.sync.read(roofBytes);
    assert.equal(roofPng.width, 2048);
    assert.equal(roofPng.height, 2048);
    assert.notEqual(pixelHash(flatBytes), pixelHash(roofBytes), 'Roof shading must visibly change exported pixels');
    const tones = [150, 194].map(tone => {
      let count = 0;
      for (let offset = 0; offset < roofPng.data.length; offset += 4) if (roofPng.data[offset] === tone) count += 1;
      return count;
    });
    assert.ok(tones.every(count => count > 1000), 'Roof PNG must contain substantial light and dark roof planes');
    await saveNeighborhood(roofBytes, 'test-results/roofed-neighborhood.png', 500, 450);
    await saveNeighborhood(roofBytes, 'test-results/irregular-roofs-after-neighborhood.png', 420, 420);
    await saveNeighborhood(flatBytes, 'test-results/roof-flat-neighborhood.png', 500, 450);
    await page.screenshot({ path: 'test-results/roofed-desktop.png' });
    await page.getByLabel('Rendering style', { exact: true }).selectOption('flat');
    assert.equal(await geometryHash(page), initialGeometry);
    const restoredDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
    await (await restoredDownload).saveAs('test-results/roof-restored-flat.png');
    assert.equal(pixelHash(await readFile('test-results/roof-restored-flat.png')), pixelHash(flatBytes), 'Returning to Flat must restore identical pixels');
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await capture(page, `${roofUrl}&style=roofed`, `test-results/roofed-mobile-${width}.png`);
      assert.equal(await page.getByLabel('Rendering style', { exact: true }).inputValue(), 'roofed');
      assert.equal(await geometryHash(page), initialGeometry);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const mobileDownload = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
      await (await mobileDownload).saveAs(`test-results/roofed-mobile-${width}-export.png`);
      assert.equal(pixelHash(await readFile(`test-results/roofed-mobile-${width}-export.png`)), pixelHash(roofBytes),
        'Roof export detail must be independent of screen viewport');
    }
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url });
    await page.getByRole('button', { name: 'Copy city link' }).click();
    await page.waitForFunction(() => document.querySelector('#build-status').textContent === 'City link copied.');
    const shared = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(new URL(shared).searchParams.get('style'), 'roofed');
    await page.goto(shared);
    await page.waitForFunction(() => window.cityGenerator?.roofed === true);
    assert.equal(await geometryHash(page), initialGeometry);
    await page.setViewportSize({ width: 1200, height: 900 });
    for (const mode of ['original', 'footprints']) {
      await page.getByLabel('Buildings', { exact: true }).selectOption(mode);
      await page.getByLabel('Rendering style', { exact: true }).selectOption('flat');
      const geometry = await geometryHash(page);
      await page.getByLabel('Rendering style', { exact: true }).selectOption('roofed');
      assert.equal(await geometryHash(page), geometry, `Roofed must preserve ${mode} geometry`);
      const exportPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
      const exported = await exportPromise;
      assert.ok(exported.suggestedFilename().includes('-roofed-'));
      await exported.saveAs(`test-results/roofed-${mode}.png`);
      assert.ok(pixelVariation(await readFile(`test-results/roofed-${mode}.png`)) > 10000);
      const plans = await page.evaluate(() => {
        const result = { hipped: 0, sectioned: 0, restrained: 0 };
        for (const patch of window.__testModel.patches) {
          for (const polygon of patch.ward.geometry) {
            const area = Math.abs(polygon.reduce((sum, point, index) => {
              const next = polygon[(index + 1) % polygon.length];
              return sum + point.x * next.y - next.x * point.y;
            }, 0) / 2);
            if (area < 12) continue;
            result[window.__testRoofRenderer.plan(polygon).kind] += 1;
          }
        }
        return result;
      });
      assert.ok(plans.hipped > 0, 'The reported seed must exercise real irregular hipped roofs');
      await writeFile(`test-results/irregular-roofs-${mode}.json`, JSON.stringify(plans, null, 2));
      console.log(`PASS: irregular roof plans in ${mode}: ${JSON.stringify(plans)}`);
    }
    await page.getByLabel('Buildings', { exact: true }).selectOption('frontage');
    await page.getByRole('button', { name: 'Generate a new city' }).click();
    assert.equal(new URL(page.url()).searchParams.get('style'), 'roofed');
    await page.getByLabel('Seed', { exact: true }).fill('1091337103');
    await page.getByRole('button', { name: 'Apply seed' }).click();
    assert.equal(await geometryHash(page), initialGeometry);
    assert.equal(new URL(page.url()).searchParams.get('style'), 'roofed');
    await page.getByRole('button', { name: 'Compare builds' }).click();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Download after PNG"]')?.disabled);
    assert.equal(new URL(page.url()).searchParams.get('style'), 'roofed');
    assert.equal(await page.getByLabel('Comparison style', { exact: true }).inputValue(), 'roofed');
    await page.getByLabel('Before build', { exact: true }).selectOption(currentBuild.id);
    await page.getByRole('button', { name: 'Apply comparison settings' }).click();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Download after PNG"]').disabled);
    assert.ok(await page.evaluate(() => document.querySelector('[data-side="before"] canvas').toDataURL()
      === document.querySelector('[data-side="after"] canvas').toDataURL()), 'Equal roofed builds and settings must produce identical comparison pixels');
    const comparisonExport = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download after PNG' }).click();
    assert.ok((await comparisonExport).suggestedFilename().includes('-roofed-'));
    await page.screenshot({ path: 'test-results/roofed-comparison.png' });
    const catalog = JSON.parse(await readFile('Export/html5/bin/builds.json', 'utf8'));
    const oldBuild = catalog.builds.find(build => build.legacy
      || (build.commit === '6784b3e' && !build.dirty));
    if (oldBuild) {
      await page.getByLabel('Before build', { exact: true }).selectOption(oldBuild.id);
      await page.getByRole('button', { name: 'Apply comparison settings' }).click();
      await page.waitForFunction(() => document.querySelector('#comparison-status').textContent.includes('does not support'));
      assert.equal(await page.getByRole('button', { name: 'Download after PNG' }).isDisabled(), true,
        'An unsupported archived rendering style must not silently fall back to Flat');
    }
    console.log('PASS: compound roof plans, clipped planes, unchanged geometry, deterministic styles, viewport-independent PNG detail and sharing');
  }
  if (!process.argv.includes('--identity-only') && !process.argv.includes('--roofs-only') && !process.argv.includes('--prototype-only')) {
    await page.setViewportSize({ width: 1200, height: 900 });
    await capture(page, `${url}/?size=40&seed=1091337103&walls=1&buildings=frontage`);
    const fixtures = await page.evaluate(() => {
      const cases = [
        { expected: null, points: [[0, 0], [8, 0], [8, 4], [0, 4]] },
        { expected: null, points: [[0, 0], [8, 1], [7, 5], [1, 5]] },
        { expected: null, points: [[0, 0], [8, 0], [8, 3], [3, 3], [3, 8], [0, 8]] },
        { expected: 'taper', points: [[0, 0], [8, 0], [2, 6]] },
        { expected: 'needle', points: [[0, 0], [40, 0], [40, 1], [0, 1]] },
        { expected: 'acute-corner', points: [[0, 0], [10, 0], [0.5, 2], [0, 2]] },
        { expected: 'sliver', points: [[0, 0], [5, 0], [5, 0.05], [0, 0.05]] },
      ];
      return cases.flatMap(fixture => [0, Math.PI / 5].map(angle => {
        const polygon = fixture.points.map(point => new window.__testPoint(point[0] * Math.cos(angle) - point[1] * Math.sin(angle),
          point[0] * Math.sin(angle) + point[1] * Math.cos(angle)));
        const reason = window.__testQuality.reason(polygon);
        const repaired = reason ? window.__testRepair(polygon) : [polygon];
        return { expected: fixture.expected, reason, before: polygon.map(point => [point.x, point.y]),
          after: repaired.map(part => ({ points: part.map(point => [point.x, point.y]), reason: window.__testQuality.reason(part) })) };
      }));
    });
    const clippedArea = polygons => polygons.reduce((sum, polygon) => sum + polygonArea(polygon[0]), 0);
    for (const fixture of fixtures) {
      assert.equal(fixture.reason, fixture.expected, 'Quality classification must distinguish normal buildings from severe outliers');
      if (!fixture.reason) assert.deepEqual(fixture.after[0].points, fixture.before, 'Plausible geometry must remain exact');
      if (['taper', 'needle', 'acute-corner'].includes(fixture.reason)) assert.ok(fixture.after.length > 0,
        `A repairable ${fixture.reason} fixture must produce contained buildings: ${JSON.stringify(fixture.before)}`);
      for (const part of fixture.after) {
        assert.equal(part.reason, null, 'Repairs must pass the same quality criteria');
        assert.ok(clippedArea(polygonClipping.difference([part.points], [fixture.before])) < 1e-6,
          'Fixture repairs must remain inside the source footprint');
      }
    }
    for (const [size, seed, walls] of [[6, 42, 0], [15, 682063530, 1], [40, 1091337103, 1], [40, 123456, 0]]) {
      for (const mode of ['footprints', 'frontage']) {
        const address = `${url}/?size=${size}&seed=${seed}&walls=${walls}&buildings=${mode}`;
        await capture(page, address);
        const audit = await page.evaluate(() => {
          const model = window.__testModel;
          const points = polygon => polygon.map(point => [point.x, point.y]);
          return {
            total: model.footprintQualityOriginals.reduce((sum, polygons) => sum + polygons.length, 0),
            changes: model.footprintQualityChanges.map(change => ({ ...change, before: points(change.before), after: change.after.map(points) })),
            original: model.footprintQualityOriginals.map(polygons => polygons.map(points)),
            current: model.patches.map(patch => patch.ward.geometry.map(points)),
            sources: model.footprintQualitySources,
            invalid: model.patches.flatMap((patch, patchIndex) => patch.ward.geometry.flatMap((polygon, index) =>
              model.footprintQualityChanges.some(change => change.patchIndex === patchIndex
                && change.sourceIndex === model.footprintQualitySources[patchIndex][index]) && window.__testQuality.reason(polygon)
                ? [{ patchIndex, index }] : [])),
            groupedBlocksChanged: model.footprintQualityChanges.some(change => model.frontageBlocks[change.patchIndex]?.length > 0),
            protectedChanged: model.footprintQualityChanges.some(change => {
              const label = model.patches[change.patchIndex].ward.getLabel();
              return ['Castle', 'Cathedral', 'Park', 'Market', 'Farm'].includes(label);
            }),
          };
        });
        assert.equal(audit.invalid.length, 0);
        assert.equal(audit.groupedBlocksChanged, false, 'Established block rows and group membership must remain untouched');
        assert.equal(audit.protectedChanged, false, 'Landmarks and nonbuilding features must not be repaired');
        assert.ok(audit.changes.length <= audit.total * 0.05, 'Cleanup must stay bounded to at most 5% of existing footprints in test cities');
        for (const change of audit.changes) {
          for (const replacement of change.after) {
            assert.ok(clippedArea(polygonClipping.difference([replacement], [change.before])) < 1e-6,
              'Actual city repairs must stay within the original footprint');
          }
        }
        for (let patchIndex = 0; patchIndex < audit.current.length; patchIndex += 1) {
          for (let index = 0; index < audit.current[patchIndex].length; index += 1) {
            const sourceIndex = audit.sources[patchIndex][index];
            const changed = audit.changes.some(change => change.patchIndex === patchIndex && change.sourceIndex === sourceIndex);
            if (!changed) assert.deepEqual(audit.current[patchIndex][index], audit.original[patchIndex][sourceIndex],
              'Every unflagged building must preserve exact vertex coordinates');
          }
        }
        const oldArea = audit.original.flat().reduce((sum, polygon) => sum + polygonArea(polygon), 0);
        const newArea = audit.current.flat().reduce((sum, polygon) => sum + polygonArea(polygon), 0);
        assert.ok(newArea <= oldArea + 1e-5 && newArea >= oldArea * 0.95,
          'The bounded cleanup must not expand source buildings or remove more than 5% of total footprint area in test cities');
        await writeFile(`test-results/quality-${size}-${seed}-${mode}.json`, JSON.stringify({ ...audit, oldArea, newArea }, null, 2));
        console.log(`PASS: quality ${mode} size ${size} seed ${seed}: ${audit.changes.length}/${audit.total} source footprints affected`);
        const snapshot = await geometryHash(page);
        await page.reload();
        await page.waitForFunction(() => window.cityGenerator);
        assert.equal(await geometryHash(page), snapshot, 'Footprint cleanup must reproduce after refresh');
        await page.getByLabel('Rendering style', { exact: true }).selectOption('roofed');
        assert.equal(await geometryHash(page), snapshot, 'Cleanup must not depend on rendering style');
        const downloadPromise = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
        const exported = await downloadPromise;
        await exported.saveAs(`test-results/quality-${size}-${seed}-${mode}.png`);
        assert.ok(pixelVariation(await readFile(`test-results/quality-${size}-${seed}-${mode}.png`)) > 10000);
        if (size === 40 && seed === 1091337103) {
          const beforeQuality = await geometryHash(page, false, true);
          const catalog = JSON.parse(await readFile('Export/html5/bin/builds.json', 'utf8'));
          const previous = catalog.builds.find(build => build.commit === 'a5d4581' && !build.dirty);
          if (previous) {
            await capture(page, `${url}/${previous.url}?size=${size}&seed=${seed}&walls=${walls}&buildings=${mode}&style=roofed`);
            assert.equal(await geometryHash(page), beforeQuality,
              'Pre-cleanup geometry, streets, walls and original features must match the preceding engine exactly');
            const oldDownload = page.waitForEvent('download');
            await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
            await (await oldDownload).saveAs(`test-results/quality-before-${mode}.png`);
            await saveNeighborhood(await readFile(`test-results/quality-before-${mode}.png`),
              `test-results/quality-before-${mode}-neighborhood.png`, 420, 420);
          }
          await saveNeighborhood(await readFile(`test-results/quality-${size}-${seed}-${mode}.png`),
            `test-results/quality-after-${mode}-neighborhood.png`, 420, 420);
        }
      }
    }
    console.log('PASS: bounded outlier-only cleanup, exact plausible/protected geometry, source containment, deterministic modes and roofed PNG export');
  }
  if (process.argv.includes('--prototype-only') || !process.argv.some(argument => /--(identity|roofs|quality)-only/.test(argument))) {
    await page.setViewportSize({ width: 1200, height: 900 });
    const prototypeUrl = `${url}/?size=40&seed=1091337103&walls=1&buildings=frontage&style=roofed`;
    const snapshot = () => page.evaluate(() => {
      const model = window.__testModel;
      const points = polygon => polygon.map(point => [point.x, point.y]);
      return { buildings: model.patches.map(patch => patch.ward.geometry.map(points)),
        shapes: model.patches.map(patch => points(patch.shape)), streets: model.streets.map(points), roads: model.roads.map(points),
        wall: model.wall ? points(model.wall.shape) : null, lanes: model.frontageLanes.map(lanes => lanes.map(points)),
        lanePaths: model.frontageLanePaths.map(paths => paths.map(points)),
        laneKinds: model.frontageLaneKinds,
        target: model.prototypePatchIndex, regions: model.prototypeRegions.map(points), attempt: model.prototypeAttempt,
        junctionBuildings: model.prototypeJunctionBuildings,
        block: model.prototypePatchIndex >= 0 ? points(model.frontageBlocks[model.prototypePatchIndex]) : [],
      };
    });
    await capture(page, prototypeUrl, 'test-results/prototype-standard-desktop.png');
    const standard = await snapshot();
    const standardHash = await geometryHash(page);
    const beforeDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
    await (await beforeDownload).saveAs('test-results/prototype-before-export.png');
    await page.getByLabel('Neighborhood layout', { exact: true }).selectOption('prototype');
    await page.waitForFunction(() => window.cityGenerator.prototype);
    const prototype = await snapshot();
    assert.ok(prototype.target >= 0, `Reported seed must produce an accepted prototype: ${JSON.stringify(prototype.attempt)}`);
    assert.ok(prototype.junctionBuildings > 0, 'The refined prototype must add real safe frontage near the junction');
    const changed = prototype.buildings.flatMap((buildings, index) => JSON.stringify(buildings) !== JSON.stringify(standard.buildings[index]) ? [index] : []);
    assert.deepEqual(changed, [prototype.target], 'Exactly one neighborhood may change');
    assert.deepEqual(prototype.streets, standard.streets, 'Main streets must remain exact');
    assert.deepEqual(prototype.roads, standard.roads, 'Approach roads must remain exact');
    assert.deepEqual(prototype.wall, standard.wall, 'Perimeter walls must remain exact');
    assert.deepEqual(prototype.shapes, standard.shapes, 'District shapes must remain exact');
    prototype.lanes.forEach((lanes, index) => {
      if (index !== prototype.target) assert.deepEqual(lanes, standard.lanes[index], 'All other neighborhood lanes must remain exact');
    });
    const buildings = prototype.buildings[prototype.target];
    const lanes = prototype.lanes[prototype.target];
    const areaOf = polygons => polygons.reduce((sum, polygon) => sum + polygonArea(polygon[0]), 0);
    const tolerance = polygonArea(prototype.block) * 1e-7;
    const active = lanes.flatMap((lane, index) => areaOf(polygonClipping.intersection([lane], [prototype.block])) > tolerance ? [index] : []);
    const adjacency = new Map(active.map(index => [index, []]));
    const reached = new Set(active.filter(index => areaOf(polygonClipping.difference([lanes[index]], [prototype.block])) > tolerance));
    for (let first = 0; first < active.length; first += 1) for (let second = 0; second < first; second += 1) {
      if (areaOf(polygonClipping.intersection([lanes[active[first]]], [lanes[active[second]]], [prototype.block])) <= tolerance) continue;
      adjacency.get(active[first]).push(active[second]);
      adjacency.get(active[second]).push(active[first]);
    }
    const pending = [...reached];
    while (pending.length) for (const next of adjacency.get(pending.pop())) if (!reached.has(next)) { reached.add(next); pending.push(next); }
    assert.equal(reached.size, active.length, 'Every prototype lane must connect to a block-boundary route');
    let localTJunctions = 0;
    const laneKinds = prototype.laneKinds[prototype.target];
    for (const connector of active.filter(index => laneKinds[index] === 'local-connector')) {
      for (const cross of active.filter(index => laneKinds[index] === 'local-cross')) {
        const joint = polygonClipping.intersection([lanes[connector]], [lanes[cross]], [prototype.block]);
        if (areaOf(joint) <= tolerance) continue;
        for (const other of active.filter(index => index !== connector && laneKinds[index] === 'local-connector')) {
          assert.ok(areaOf(polygonClipping.intersection(joint, [lanes[other]])) < tolerance,
            'Staggered local connectors must terminate at separate T-junctions, not form four-way crossings');
        }
        localTJunctions += 1;
      }
    }
    assert.ok(localTJunctions > 0, 'Refined prototype must contain real local T-junctions');
    for (let index = 0; index < buildings.length; index += 1) {
      const building = buildings[index];
      assert.ok(areaOf(polygonClipping.difference([building], [prototype.block])) < tolerance);
      for (const lane of lanes) assert.ok(areaOf(polygonClipping.intersection([building], [lane])) < tolerance, 'Prototype lanes must remain clear');
      for (let other = 0; other < index; other += 1) assert.ok(areaOf(polygonClipping.intersection([building], [buildings[other]])) < tolerance,
        'Prototype buildings must not overlap');
    }
    const oldArea = standard.buildings[prototype.target].reduce((sum, building) => sum + polygonArea(building), 0);
    const newArea = buildings.reduce((sum, building) => sum + polygonArea(building), 0);
    assert.ok(newArea >= oldArea * 0.85 && newArea <= oldArea * 1.15, 'Prototype coverage must remain comparable');
    const orientation = polygons => {
      const bins = Array(12).fill(0);
      for (const building of polygons) {
        const edge = [building[1][0] - building[0][0], building[1][1] - building[0][1]];
        const angle = (Math.atan2(edge[1], edge[0]) + Math.PI * 2) % Math.PI;
        bins[Math.min(11, Math.floor(angle / Math.PI * 12))] += polygonArea(building);
      }
      return { dominant: Math.max(...bins) / bins.reduce((sum, value) => sum + value, 0), bins };
    };
    const beforeOrientation = orientation(standard.buildings[prototype.target]);
    const afterOrientation = orientation(buildings);
    assert.ok(afterOrientation.dominant < beforeOrientation.dominant - 0.1,
      `Prototype must reduce dominant parallel frontage: ${beforeOrientation.dominant} -> ${afterOrientation.dominant}`);
    await writeFile('test-results/prototype-audit.json', JSON.stringify({ target: prototype.target, oldArea, newArea,
      beforeOrientation, afterOrientation, connectedLanes: active.length, districtsChanged: changed,
      localTJunctions, junctionBuildings: prototype.junctionBuildings }, null, 2));
    await page.screenshot({ path: 'test-results/prototype-after-desktop.png' });
    const exportPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
    const exported = await exportPromise;
    assert.ok(exported.suggestedFilename().includes('-prototype-'));
    await exported.saveAs('test-results/prototype-after-export.png');
    const crop = await page.evaluate(() => window.cityGenerator.prototypeCrop);
    assert.ok(crop && crop.left >= 0 && crop.top >= 0, 'Accepted prototype must identify its matching export crop');
    await saveNeighborhood(await readFile('test-results/prototype-before-export.png'), 'test-results/prototype-before-neighborhood.png', crop.left, crop.top);
    await saveNeighborhood(await readFile('test-results/prototype-after-export.png'), 'test-results/prototype-after-neighborhood.png', crop.left, crop.top);
    const catalog = JSON.parse(await readFile('Export/html5/bin/builds.json', 'utf8'));
    const firstPrototype = catalog.builds.find(build => build.commit === '6332b72' && !build.dirty);
    if (firstPrototype) {
      await capture(page, `${url}/${firstPrototype.url}?size=40&seed=1091337103&walls=1&buildings=frontage&style=roofed&layout=prototype`);
      const first = await snapshot();
      assert.equal(first.target, prototype.target, 'Refinement must use the same district as the first prototype');
      first.buildings.forEach((buildings, index) => {
        if (index !== prototype.target) assert.deepEqual(buildings, prototype.buildings[index], 'Refinement must leave every other district exact');
      });
      const oldExport = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Export PNG', exact: true }).click();
      await (await oldExport).saveAs('test-results/prototype-refinement-before-export.png');
      await saveNeighborhood(await readFile('test-results/prototype-refinement-before-export.png'),
        'test-results/prototype-refinement-before-neighborhood.png', crop.left, crop.top);
      await saveNeighborhood(await readFile('test-results/prototype-after-export.png'),
        'test-results/prototype-refinement-after-neighborhood.png', crop.left, crop.top);
      await page.goto(`${prototypeUrl}&layout=prototype`);
      await page.waitForFunction(() => window.cityGenerator?.prototype);
    }
    const bounds = prototype.block.reduce((result, point) => ({ minX: Math.min(result.minX, point[0]), maxX: Math.max(result.maxX, point[0]),
      minY: Math.min(result.minY, point[1]), maxY: Math.max(result.maxY, point[1]) }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    const city = prototype.shapes.flat().reduce((result, point) => ({ minX: Math.min(result.minX, point[0]), maxX: Math.max(result.maxX, point[0]),
      minY: Math.min(result.minY, point[1]), maxY: Math.max(result.maxY, point[1]) }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    await writeFile('test-results/prototype-region.json', JSON.stringify({ bounds, city }, null, 2));
    await page.getByLabel('Neighborhood layout', { exact: true }).selectOption('standard');
    assert.equal(await geometryHash(page), standardHash, 'Returning to Standard must restore exact model geometry');
    assert.deepEqual((await snapshot()).buildings, standard.buildings, 'Returning to Standard must restore all original buildings');
    await page.getByLabel('Neighborhood layout', { exact: true }).selectOption('prototype');
    await page.reload();
    await page.waitForFunction(() => window.cityGenerator?.prototype);
    assert.deepEqual((await snapshot()).buildings, prototype.buildings, 'Prototype must reproduce after refresh');
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.screenshot({ path: `test-results/prototype-mobile-${width}.png` });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url });
    await page.getByRole('button', { name: 'Copy city link' }).click();
    await page.waitForFunction(() => document.querySelector('#build-status').textContent === 'City link copied.');
    const prototypeLink = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(new URL(prototypeLink).searchParams.get('layout'), 'prototype');
    await page.goto(prototypeLink);
    await page.waitForFunction(() => window.cityGenerator?.prototype);
    assert.deepEqual((await snapshot()).buildings, prototype.buildings, 'Shared links must preserve the accepted prototype');
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.getByRole('button', { name: 'Compare builds' }).click();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Download after PNG"]')?.disabled);
    assert.equal(await page.getByLabel('Before layout', { exact: true }).inputValue(), 'standard');
    assert.equal(await page.getByLabel('After layout', { exact: true }).inputValue(), 'prototype');
    assert.equal(await page.getByLabel('Comparison view', { exact: true }).inputValue(), 'prototype');
    const beforeImage = await page.locator('[data-side="before"] canvas').screenshot();
    const afterImage = await page.locator('[data-side="after"] canvas').screenshot();
    assert.notEqual(pixelHash(beforeImage), pixelHash(afterImage), 'Changed District comparison must show the actual layout difference');
    await page.screenshot({ path: 'test-results/prototype-comparison-desktop.png' });
    const cropExportPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download after PNG' }).click();
    const cropExport = await cropExportPromise;
    assert.ok(cropExport.suggestedFilename().includes('-prototype-prototype.png'));
    await cropExport.saveAs('test-results/prototype-comparison-crop.png');
    assert.equal(PNG.sync.read(await readFile('test-results/prototype-comparison-crop.png')).width, 600);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await page.screenshot({ path: `test-results/prototype-comparison-mobile-${width}.png` });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.goto(prototypeUrl);
    await page.waitForFunction(() => window.cityGenerator);
    assert.equal(await geometryHash(page), standardHash);
    await page.evaluate(() => {
      window.__originalPrototypeApply = window.__testPrototype.apply;
      window.__testPrototype.apply = () => { throw new Error('Injected clipping failure'); };
    });
    await page.getByLabel('Neighborhood layout', { exact: true }).selectOption('prototype');
    assert.equal(await geometryHash(page), standardHash, 'A failed prototype must retain exact Standard geometry');
    assert.equal(await page.evaluate(() => window.cityGenerator.prototypePatch), -1);
    assert.ok(await page.locator('#build-status').textContent().then(text => text.includes('Standard layout retained')));
    await page.evaluate(() => { window.__testPrototype.apply = window.__originalPrototypeApply; });
    await page.getByLabel('Neighborhood layout', { exact: true }).selectOption('standard');
    await page.getByLabel('Neighborhood layout', { exact: true }).selectOption('prototype');
    assert.deepEqual((await snapshot()).buildings, prototype.buildings, 'Prototype must recover after a safely rejected attempt');
    console.log(`PASS: one-district prototype ${prototype.target}; connected lanes ${active.length}; T-junctions ${localTJunctions}; junction infill ${prototype.junctionBuildings}; coverage ${oldArea.toFixed(1)} -> ${newArea.toFixed(1)}; dominant orientation ${beforeOrientation.dominant.toFixed(3)} -> ${afterOrientation.dominant.toFixed(3)}`);
  }
  assert.deepEqual(errors, [], 'Browser must not report runtime errors');
  console.log('PASS: seeded walls on/off, size and regeneration controls, desktop/mobile layout, monochrome 2048px PNG export');
} finally {
  await browser.close();
  await closeTestServer(server);
}