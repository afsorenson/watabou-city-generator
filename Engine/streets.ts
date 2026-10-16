import PathFinding from 'pathfinding';
import { Delaunay } from 'd3-delaunay';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { contractResult, validateSite, type EngineResult, type Issue, type Land, type Position, type SiteContract, type StreetGraph } from './contracts';

type Cell = { x: number; y: number };
type RoadKind = 'primary' | 'secondary' | 'access';
type RawNode = { position: Position; preserve?: boolean };
type RawEdge = { start: string; end: string; kind: RoadKind };
const widthByKind: Record<RoadKind, number> = { primary: 14, secondary: 9, access: 7 };
const interpolateGridLine = (PathFinding.Util as unknown as { interpolate: (x0: number, y0: number, x1: number, y1: number) => number[][] }).interpolate;
const nodeId = (key: string) => `street-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
const cellKey = (cell: Cell) => `c-${cell.x}-${cell.y}`;
const edgeKey = (first: string, second: string) => first < second ? `${first}|${second}` : `${second}|${first}`;

function randomFor(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pointIn(land: Land, point: Position) {
  const candidate = { type: 'Point' as const, coordinates: point };
  return land.some(part => booleanPointInPolygon(candidate, { type: 'Polygon', coordinates: part as Position[][] }));
}

function simplify(points: Position[]): Position[] {
  if (points.length < 3) return points;
  const result = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const first = result[result.length - 1]; const middle = points[index]; const last = points[index + 1];
    const cross = (middle[0] - first[0]) * (last[1] - middle[1]) - (middle[1] - first[1]) * (last[0] - middle[0]);
    if (Math.abs(cross) > 1e-6) result.push(middle);
  }
  result.push(points[points.length - 1]);
  return result;
}

function rounded(points: Position[]): Position[] {
  if (points.length < 3) return points;
  let result = points;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const next: Position[] = [result[0]];
    for (let index = 1; index < result.length; index += 1) {
      const first = result[index - 1]; const second = result[index];
      next.push([first[0] * .75 + second[0] * .25, first[1] * .75 + second[1] * .25]);
      next.push([first[0] * .25 + second[0] * .75, first[1] * .25 + second[1] * .75]);
    }
    next.push(result[result.length - 1]); result = next;
  }
  return result;
}

function bowed(points: Position[], seed: number, strength: number): Position[] {
  if (points.length !== 2) return rounded(points);
  const [start, end] = points;
  const dx = end[0] - start[0]; const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (length < 35) return points;
  const normal: Position = [-dy / length, dx / length];
  const offset = (randomFor(seed)() * 2 - 1) * Math.min(length * strength, 48);
  const firstControl: Position = [start[0] + dx / 3 + normal[0] * offset, start[1] + dy / 3 + normal[1] * offset];
  const secondControl: Position = [start[0] + dx * 2 / 3 + normal[0] * offset, start[1] + dy * 2 / 3 + normal[1] * offset];
  return Array.from({ length: 17 }, (_value, index) => {
    const t = index / 16; const inverse = 1 - t;
    return [inverse ** 3 * start[0] + 3 * inverse ** 2 * t * firstControl[0] + 3 * inverse * t ** 2 * secondControl[0] + t ** 3 * end[0],
      inverse ** 3 * start[1] + 3 * inverse ** 2 * t * firstControl[1] + 3 * inverse * t ** 2 * secondControl[1] + t ** 3 * end[1]];
  });
}

function roadFits(points: Position[], width: number, land: Land, cellSize: number, entrances: Position[], allowGate = false) {
  const directions = Array.from({ length: 16 }, (_value, index) => index * Math.PI / 8);
  for (let index = 1; index < points.length; index += 1) {
    const first = points[index - 1]; const second = points[index];
    const length = Math.hypot(second[0] - first[0], second[1] - first[1]);
    const samples = Math.max(1, Math.ceil(length / (cellSize * .5)));
    for (let sample = 0; sample <= samples; sample += 1) {
      const fraction = sample / samples;
      const center: Position = [first[0] + (second[0] - first[0]) * fraction, first[1] + (second[1] - first[1]) * fraction];
      if (allowGate && entrances.some(entrance => Math.hypot(center[0] - entrance[0], center[1] - entrance[1]) < width)) continue;
      for (const angle of directions) if (!pointIn(land, [center[0] + Math.cos(angle) * width / 2, center[1] + Math.sin(angle) * width / 2])) return false;
    }
  }
  return true;
}

export function generateStreetNetwork(site: SiteContract): EngineResult {
  const validation = validateSite(site);
  if (!validation.valid) throw new Error('Cannot generate streets for an invalid site contract.');
  const base = contractResult(site);
  const land = validation.buildable;
  const outerRings = land.flatMap(part => part.slice(0, 1));
  const points = outerRings.flat();
  const minX = Math.min(...points.map(point => point[0]));
  const maxX = Math.max(...points.map(point => point[0]));
  const minY = Math.min(...points.map(point => point[1]));
  const maxY = Math.max(...points.map(point => point[1]));
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const extent = Math.max(spanX, spanY);
  const cellSize = Math.max(2, extent / 180);
  const gridWidth = Math.max(1, Math.ceil(spanX / cellSize));
  const gridHeight = Math.max(1, Math.ceil(spanY / cellSize));
  const origin: Position = [minX, minY];
  const positionOf = (cell: Cell): Position => [origin[0] + (cell.x + .5) * cellSize, origin[1] + (cell.y + .5) * cellSize];
  const clearance = Math.max(...Object.values(widthByKind)) / 2 + cellSize * .55;
  const probes = Array.from({ length: 12 }, (_value, index) => index * Math.PI / 6);
  const matrix = Array.from({ length: gridHeight }, (_row, y) => Array.from({ length: gridWidth }, (_cell, x) => {
    const center = positionOf({ x, y });
    if (!pointIn(land, center)) return 1;
    return probes.every(angle => pointIn(land, [center[0] + Math.cos(angle) * clearance, center[1] + Math.sin(angle) * clearance])) ? 0 : 1;
  }));
  const grid = new PathFinding.Grid(matrix);
  const regionIds = Array.from({ length: gridWidth * gridHeight }, () => -1);
  const regionAt = (cell: Cell) => regionIds[cell.y * gridWidth + cell.x];
  let regionCount = 0;
  for (let y = 0; y < gridHeight; y += 1) for (let x = 0; x < gridWidth; x += 1) {
    const index = y * gridWidth + x;
    if (!grid.isWalkableAt(x, y) || regionIds[index] >= 0) continue;
    const pending = [grid.getNodeAt(x, y)]; regionIds[index] = regionCount;
    for (let cursor = 0; cursor < pending.length; cursor += 1) {
      const current = pending[cursor];
      for (const neighbor of grid.getNeighbors(current, PathFinding.DiagonalMovement.OnlyWhenNoObstacles)) {
        const neighborIndex = neighbor.y * gridWidth + neighbor.x;
        if (regionIds[neighborIndex] >= 0) continue;
        regionIds[neighborIndex] = regionCount; pending.push(neighbor);
      }
    }
    regionCount += 1;
  }
  const random = randomFor(site.seed);
  const nodes = new Map<string, RawNode>();
  const edges = new Map<string, RawEdge>();
  const roadCells = new Set<string>();
  const addNode = (key: string, position: Position, preserve = false) => {
    const existing = nodes.get(key);
    if (existing) existing.preserve ||= preserve;
    else nodes.set(key, { position, preserve });
  };
  const addEdge = (first: string, second: string, kind: RoadKind) => {
    if (first === second) return;
    const id = edgeKey(first, second);
    const previous = edges.get(id);
    if (!previous || widthByKind[kind] > widthByKind[previous.kind]) edges.set(id, { start: first, end: second, kind });
  };
  const nearestWalkable = (target: Position, maxDistance: number): Cell | null => {
    const approxX = Math.floor((target[0] - origin[0]) / cellSize);
    const approxY = Math.floor((target[1] - origin[1]) / cellSize);
    const radius = Math.ceil(maxDistance / cellSize);
    let closest: Cell | null = null; let distance = maxDistance * maxDistance;
    for (let y = Math.max(0, approxY - radius); y <= Math.min(gridHeight - 1, approxY + radius); y += 1) {
      for (let x = Math.max(0, approxX - radius); x <= Math.min(gridWidth - 1, approxX + radius); x += 1) {
        if (!grid.isWalkableAt(x, y)) continue;
        const position = positionOf({ x, y });
        const nextDistance = (position[0] - target[0]) ** 2 + (position[1] - target[1]) ** 2;
        if (nextDistance < distance) { closest = { x, y }; distance = nextDistance; }
      }
    }
    return closest;
  };
  const route = (start: Cell, end: Cell): Cell[] => {
    if (regionAt(start) !== regionAt(end)) return [];
    const path = new PathFinding.AStarFinder({ diagonalMovement: PathFinding.DiagonalMovement.OnlyWhenNoObstacles,
      heuristic: PathFinding.Heuristic.octile }).findPath(start.x, start.y, end.x, end.y, grid.clone());
    if (path.length < 3) return path.map(([x, y]) => ({ x, y }));
    const visible = [path[0]];
    let startIndex = 0;
    while (startIndex < path.length - 1) {
      let furthest = startIndex + 1;
      for (let endIndex = path.length - 1; endIndex > startIndex + 1; endIndex -= 1) {
        const line = interpolateGridLine(path[startIndex][0], path[startIndex][1], path[endIndex][0], path[endIndex][1]);
        if (line.every(([x, y]) => grid.isWalkableAt(x, y))) { furthest = endIndex; break; }
      }
      visible.push(path[furthest]); startIndex = furthest;
    }
    return PathFinding.Util.expandPath(visible).map(([x, y]) => ({ x, y }));
  };
  const addRoute = (path: Cell[], kind: RoadKind) => {
    for (let index = 1; index < path.length; index += 1) {
      const first = cellKey(path[index - 1]); const second = cellKey(path[index]);
      addNode(first, positionOf(path[index - 1])); addNode(second, positionOf(path[index])); addEdge(first, second, kind);
      roadCells.add(first); roadCells.add(second);
    }
  };
  const overlapRatio = (path: Cell[]) => {
    const interior = path.slice(3, -3);
    if (interior.length < 4 || !roadCells.size) return 0;
    let nearby = 0;
    for (const cell of interior) {
      let found = false;
      for (let y = -2; y <= 2 && !found; y += 1) for (let x = -2; x <= 2; x += 1) {
        if (roadCells.has(cellKey({ x: cell.x + x, y: cell.y + y }))) { found = true; break; }
      }
      if (found) nearby += 1;
    }
    return nearby / interior.length;
  };
  const renderedRoadCells = new Set<string>();
  const curveClear = (path: Position[]) => {
    for (let index = 1; index < path.length; index += 1) {
      const first = path[index - 1]; const second = path[index];
      const length = Math.hypot(second[0] - first[0], second[1] - first[1]);
      const samples = Math.max(1, Math.ceil(length / (cellSize * .5)));
      for (let sample = 0; sample <= samples; sample += 1) {
        const fraction = sample / samples;
        const x = first[0] + (second[0] - first[0]) * fraction;
        const y = first[1] + (second[1] - first[1]) * fraction;
        if (Math.hypot(x - path[0][0], y - path[0][1]) < cellSize * 2
          || Math.hypot(x - path[path.length - 1][0], y - path[path.length - 1][1]) < cellSize * 2) continue;
        const cellX = Math.round((x - origin[0]) / cellSize - .5);
        const cellY = Math.round((y - origin[1]) / cellSize - .5);
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) for (let offsetX = -1; offsetX <= 1; offsetX += 1)
          if (renderedRoadCells.has(cellKey({ x: cellX + offsetX, y: cellY + offsetY }))) return false;
      }
    }
    return true;
  };
  const rememberRoad = (path: Position[]) => {
    for (let index = 1; index < path.length; index += 1) {
      const first = path[index - 1]; const second = path[index];
      const length = Math.hypot(second[0] - first[0], second[1] - first[1]);
      const samples = Math.max(1, Math.ceil(length / (cellSize * .5)));
      for (let sample = 0; sample <= samples; sample += 1) {
        const fraction = sample / samples;
        const x = first[0] + (second[0] - first[0]) * fraction;
        const y = first[1] + (second[1] - first[1]) * fraction;
        renderedRoadCells.add(cellKey({ x: Math.round((x - origin[0]) / cellSize - .5), y: Math.round((y - origin[1]) / cellSize - .5) }));
      }
    }
  };

  const candidates: Cell[] = [];
  for (let y = 0; y < gridHeight; y += 1) for (let x = 0; x < gridWidth; x += 1) if (grid.isWalkableAt(x, y)) candidates.push({ x, y });
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1)); [candidates[index], candidates[swap]] = [candidates[swap], candidates[index]];
  }
  const anchors: Cell[] = [];
  const spacing = Math.max(cellSize * 12, extent * .12);
  for (const candidate of candidates) {
    const position = positionOf(candidate);
    if (anchors.every(anchor => Math.hypot(positionOf(anchor)[0] - position[0], positionOf(anchor)[1] - position[1]) >= spacing)) anchors.push(candidate);
    if (anchors.length >= 72) break;
  }
  const connect = (first: Cell, second: Cell, kind: RoadKind, overlapLimit = 1) => {
    if (regionAt(first) !== regionAt(second)) return false;
    const path = route(first, second);
    if (!path.length) return false;
    if (overlapRatio(path) > overlapLimit) return false;
    addRoute(path, kind); return true;
  };
  const anchorIndex = new Map(anchors.map((anchor, index) => [cellKey(anchor), index]));
  const parent = anchors.map((_anchor, index) => index);
  const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]));
  const join = (first: Cell, second: Cell) => {
    const firstIndex = anchorIndex.get(cellKey(first)); const secondIndex = anchorIndex.get(cellKey(second));
    if (firstIndex === undefined || secondIndex === undefined) return;
    const firstRoot = find(firstIndex); const secondRoot = find(secondIndex);
    if (firstRoot !== secondRoot) parent[firstRoot] = secondRoot;
  };
  const center: Position = [(minX + maxX) / 2, (minY + maxY) / 2];
  const hubs: Cell[] = [];
  const firstHub = anchors.slice().sort((first, second) => Math.hypot(positionOf(first)[0] - center[0], positionOf(first)[1] - center[1])
    - Math.hypot(positionOf(second)[0] - center[0], positionOf(second)[1] - center[1]))[0];
  if (firstHub) hubs.push(firstHub);
  const hubCount = Math.min(5, Math.max(2, Math.round(Math.sqrt(anchors.length) * .55)), anchors.length);
  while (hubs.length < hubCount) {
    const next = anchors.filter(candidate => regionAt(candidate) === regionAt(hubs[0])
      && !hubs.some(hub => hub.x === candidate.x && hub.y === candidate.y))
      .sort((first, second) => Math.min(...hubs.map(hub => Math.hypot(positionOf(first)[0] - positionOf(hub)[0], positionOf(first)[1] - positionOf(hub)[1])))
        - Math.min(...hubs.map(hub => Math.hypot(positionOf(second)[0] - positionOf(hub)[0], positionOf(second)[1] - positionOf(hub)[1])))).pop();
    if (!next) break;
    const nearest = hubs.slice().sort((first, second) => Math.hypot(positionOf(first)[0] - positionOf(next)[0], positionOf(first)[1] - positionOf(next)[1])
      - Math.hypot(positionOf(second)[0] - positionOf(next)[0], positionOf(second)[1] - positionOf(next)[1]))[0];
    if (connect(nearest, next, 'primary')) { join(nearest, next); hubs.push(next); }
  }

  if (anchors.length > 1) {
    const coordinates = anchors.map(positionOf);
    const delaunay = Delaunay.from(coordinates, point => point[0], point => point[1]);
    const candidateEdges = new Map<string, { first: number; second: number; distance: number }>();
    const addCandidate = (first: number, second: number) => {
      if (first === second || regionAt(anchors[first]) !== regionAt(anchors[second])) return;
      const key = first < second ? `${first}:${second}` : `${second}:${first}`;
      if (candidateEdges.has(key)) return;
      const a = coordinates[first]; const b = coordinates[second];
      candidateEdges.set(key, { first, second, distance: Math.hypot(a[0] - b[0], a[1] - b[1]) });
    };
    for (let index = 0; index < delaunay.triangles.length; index += 3) {
      const first = delaunay.triangles[index]; const second = delaunay.triangles[index + 1]; const third = delaunay.triangles[index + 2];
      addCandidate(first, second); addCandidate(second, third); addCandidate(third, first);
    }
    if (!candidateEdges.size) for (let first = 0; first < anchors.length; first += 1)
      for (let second = first + 1; second < anchors.length; second += 1) addCandidate(first, second);
    const candidatesByDistance = Array.from(candidateEdges.values()).sort((first, second) => first.distance - second.distance);
    const tree = new Set<string>();
    for (const edge of candidatesByDistance) if (find(edge.first) !== find(edge.second)) {
      if (!connect(anchors[edge.first], anchors[edge.second], 'secondary', .58)) continue;
      join(anchors[edge.first], anchors[edge.second]);
      const key = edgeKey(cellKey(anchors[edge.first]), cellKey(anchors[edge.second])); tree.add(key);
    }
    for (const edge of candidatesByDistance) {
      const key = edgeKey(cellKey(anchors[edge.first]), cellKey(anchors[edge.second]));
      if (tree.has(key) || edge.distance > spacing * 1.9 || random() > .18) continue;
      connect(anchors[edge.first], anchors[edge.second], 'secondary', .2);
    }
  }

  for (const entrance of site.entrances) {
    const angle = entrance.headingDegrees * Math.PI / 180;
    const target: Position = [entrance.position[0] + Math.cos(angle) * Math.max(entrance.clearanceMeters, cellSize * 1.5),
      entrance.position[1] + Math.sin(angle) * Math.max(entrance.clearanceMeters, cellSize * 1.5)];
    const start = nearestWalkable(target, Math.max(cellSize * 5, extent * .08));
    if (!start || !anchors.length) continue;
    const reachableAnchors = anchors.filter(anchor => regionAt(anchor) === regionAt(start));
    const nearest = reachableAnchors.slice().sort((first, second) => {
      const firstPosition = positionOf(first); const secondPosition = positionOf(second);
      return Math.hypot(firstPosition[0] - target[0], firstPosition[1] - target[1])
        - Math.hypot(secondPosition[0] - target[0], secondPosition[1] - target[1]);
    })[0];
    if (!nearest) continue;
    const path = route(start, nearest);
    if (!path.length) continue;
    const gate = `g-${entrance.id}`; const first = cellKey(path[0]);
    addNode(gate, entrance.position, true); addNode(first, positionOf(path[0])); addEdge(gate, first, 'access');
    addRoute(path, 'access');
  }

  const adjacency = new Map<string, Map<string, RoadKind>>();
  for (const edge of edges.values()) {
    if (!adjacency.has(edge.start)) adjacency.set(edge.start, new Map());
    if (!adjacency.has(edge.end)) adjacency.set(edge.end, new Map());
    adjacency.get(edge.start)!.set(edge.end, edge.kind); adjacency.get(edge.end)!.set(edge.start, edge.kind);
  }
  const important = new Set<string>();
    for (const [key, neighbors] of adjacency) {
      if (nodes.get(key)?.preserve || neighbors.size !== 2) { important.add(key); continue; }
      const [[, firstKind], [, secondKind]] = Array.from(neighbors.entries());
      if (firstKind !== secondKind) important.add(key);
  }
  const visited = new Set<string>(); const graphNodes = new Map<string, { id: string; position: Position }>();
  const graphEdges: StreetGraph['edges'] = [];
  const emit = (path: string[], kind: RoadKind) => {
    if (path.length < 2) return;
    const start = path[0]; const end = path[path.length - 1];
    graphNodes.set(start, { id: nodeId(start), position: nodes.get(start)!.position });
    graphNodes.set(end, { id: nodeId(end), position: nodes.get(end)!.position });
    const edgeId = `street-edge-${graphEdges.length + 1}`;
    const line = simplify(path.map(key => nodes.get(key)!.position));
    const curve = bowed(line, site.seed + graphEdges.length * 0x9e3779b9, kind === 'primary' ? .22 : .12);
    const entrances = kind === 'access' ? site.entrances.map(entrance => entrance.position) : [];
    const centerline = roadFits(curve, widthByKind[kind], land, cellSize, entrances, kind === 'access') && curveClear(curve) ? curve : line;
    rememberRoad(centerline);
    graphEdges.push({ id: edgeId, start: nodeId(start), end: nodeId(end), centerline,
      widthMeters: widthByKind[kind], kind });
  };
  const walk = (start: string, next: string, initialKind: RoadKind) => {
    const path = [start, next]; let previous = start; let current = next; let kind = initialKind;
    visited.add(edgeKey(previous, current));
    while (!important.has(current)) {
      const options = Array.from(adjacency.get(current)!.entries()).filter(([key]) => key !== previous);
      if (options.length !== 1 || options[0][1] !== kind) break;
      const following = options[0][0];
      visited.add(edgeKey(current, following)); path.push(following); previous = current; current = following;
    }
    if (!important.has(current)) important.add(current);
    emit(path, kind);
  };
  for (const start of important) {
    for (const [neighbor, kind] of adjacency.get(start) ?? []) if (!visited.has(edgeKey(start, neighbor))) walk(start, neighbor, kind);
  }
  for (const [start, neighbors] of adjacency) for (const [neighbor, kind] of neighbors)
    if (!visited.has(edgeKey(start, neighbor))) walk(start, neighbor, kind);

  const graph = new Set(Array.from(graphNodes.values(), node => node.id));
  const graphAdjacency = new Map<string, string[]>();
  for (const edge of graphEdges) {
    graphAdjacency.set(edge.start, [...(graphAdjacency.get(edge.start) ?? []), edge.end]);
    graphAdjacency.set(edge.end, [...(graphAdjacency.get(edge.end) ?? []), edge.start]);
  }
  let components = 0;
  while (graph.size) {
    components += 1; const pending = [graph.values().next().value as string]; graph.delete(pending[0]);
    while (pending.length) for (const neighbor of graphAdjacency.get(pending.pop()!) ?? []) if (graph.delete(neighbor)) pending.push(neighbor);
  }
  const issues: Issue[] = components > 1 || graphEdges.length === 0
    ? [{ severity: 'error', code: 'STREET_NETWORK_DISCONNECTED', entityId: 'streets', message: graphEdges.length
      ? `Street network contains ${components} disconnected components.` : 'No street centerlines fit inside the buildable area.' }]
    : [];
  return { ...base, phase: 'streets', streets: { connected: graphEdges.length > 0 && components === 1, components,
    nodes: Array.from(graphNodes.values()), edges: graphEdges }, issues };
}