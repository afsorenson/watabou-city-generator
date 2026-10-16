import PathFinding from 'pathfinding';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { contractResult, validateSite, type EngineResult, type Issue, type Land, type Position, type SiteContract, type StreetGraph } from './contracts';

type Cell = { x: number; y: number };
type RoadKind = 'primary' | 'secondary' | 'access';
type RawNode = { position: Position; preserve?: boolean };
type RawEdge = { start: string; end: string; kind: RoadKind };
const widthByKind: Record<RoadKind, number> = { primary: 14, secondary: 9, access: 7 };
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
  const clearance = Math.max(...Object.values(widthByKind)) / 2;
  const probes = Array.from({ length: 12 }, (_value, index) => index * Math.PI / 6);
  const matrix = Array.from({ length: gridHeight }, (_row, y) => Array.from({ length: gridWidth }, (_cell, x) => {
    const center = positionOf({ x, y });
    if (!pointIn(land, center)) return 1;
    return probes.every(angle => pointIn(land, [center[0] + Math.cos(angle) * clearance, center[1] + Math.sin(angle) * clearance])) ? 0 : 1;
  }));
  const grid = new PathFinding.Grid(matrix);
  const random = randomFor(site.seed);
  const nodes = new Map<string, RawNode>();
  const edges = new Map<string, RawEdge>();
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
  const route = (start: Cell, end: Cell): Cell[] => new PathFinding.AStarFinder({
    diagonalMovement: PathFinding.DiagonalMovement.Never,
  }).findPath(start.x, start.y, end.x, end.y, grid.clone()).map(([x, y]) => ({ x, y }));
  const addRoute = (path: Cell[], kind: RoadKind) => {
    for (let index = 1; index < path.length; index += 1) {
      const first = cellKey(path[index - 1]); const second = cellKey(path[index]);
      addNode(first, positionOf(path[index - 1])); addNode(second, positionOf(path[index])); addEdge(first, second, kind);
    }
  };

  const columnCount = Math.max(2, Math.min(14, Math.round(spanX / 115) + 1));
  const rowCount = Math.max(2, Math.min(14, Math.round(spanY / 115) + 1));
  const anchors: { row: number; column: number; cell: Cell }[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < columnCount; column += 1) {
      const spacingX = spanX * .78 / (columnCount - 1); const spacingY = spanY * .78 / (rowCount - 1);
      const target: Position = [minX + spanX * .11 + column * spacingX + (random() - .5) * spacingX * .14,
        minY + spanY * .11 + row * spacingY + (random() - .5) * spacingY * .14];
      const cell = nearestWalkable(target, Math.max(cellSize * 2, Math.min(spacingX, spacingY) * .35));
      if (cell && !anchors.some(anchor => anchor.cell.x === cell.x && anchor.cell.y === cell.y)) anchors.push({ row, column, cell });
    }
  }
  const connect = (first: typeof anchors[number], second: typeof anchors[number], kind: RoadKind) => {
    const path = route(first.cell, second.cell);
    if (!path.length) return false;
    addRoute(path, kind); return true;
  };
  for (let row = 0; row < rowCount; row += 1) {
    const line = anchors.filter(anchor => anchor.row === row).sort((first, second) => first.column - second.column);
    for (let index = 1; index < line.length; index += 1)
      connect(line[index - 1], line[index], row % 3 === 0 ? 'primary' : 'secondary');
  }
  for (let column = 0; column < columnCount; column += 1) {
    const line = anchors.filter(anchor => anchor.column === column).sort((first, second) => first.row - second.row);
    for (let index = 1; index < line.length; index += 1)
      connect(line[index - 1], line[index], column % 3 === 0 ? 'primary' : 'secondary');
  }

  for (const entrance of site.entrances) {
    const angle = entrance.headingDegrees * Math.PI / 180;
    const target: Position = [entrance.position[0] + Math.cos(angle) * Math.max(entrance.clearanceMeters, cellSize * 1.5),
      entrance.position[1] + Math.sin(angle) * Math.max(entrance.clearanceMeters, cellSize * 1.5)];
    const start = nearestWalkable(target, Math.max(cellSize * 5, extent * .08));
    if (!start || !anchors.length) continue;
    const nearest = anchors.slice().sort((first, second) => {
      const firstPosition = positionOf(first.cell); const secondPosition = positionOf(second.cell);
      return Math.hypot(firstPosition[0] - target[0], firstPosition[1] - target[1])
        - Math.hypot(secondPosition[0] - target[0], secondPosition[1] - target[1]);
    })[0];
    const path = route(start, nearest.cell);
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
    const [[first, firstKind], [second, secondKind]] = Array.from(neighbors.entries());
    const position = nodes.get(key)!.position; const firstPoint = nodes.get(first)!.position; const secondPoint = nodes.get(second)!.position;
    const cross = (position[0] - firstPoint[0]) * (secondPoint[1] - position[1]) - (position[1] - firstPoint[1]) * (secondPoint[0] - position[0]);
    if (firstKind !== secondKind || Math.abs(cross) > .001) important.add(key);
  }
  const visited = new Set<string>(); const graphNodes = new Map<string, { id: string; position: Position }>();
  const graphEdges: StreetGraph['edges'] = [];
  const emit = (path: string[], kind: RoadKind) => {
    if (path.length < 2) return;
    const start = path[0]; const end = path[path.length - 1];
    graphNodes.set(start, { id: nodeId(start), position: nodes.get(start)!.position });
    graphNodes.set(end, { id: nodeId(end), position: nodes.get(end)!.position });
    const edgeId = `street-edge-${graphEdges.length + 1}`;
    graphEdges.push({ id: edgeId, start: nodeId(start), end: nodeId(end), centerline: path.map(key => nodes.get(key)!.position),
      widthMeters: widthByKind[kind], kind });
  };
  const walk = (start: string, next: string, initialKind: RoadKind) => {
    const path = [start, next]; let previous = start; let current = next; let kind = initialKind;
    visited.add(edgeKey(previous, current));
    while (!important.has(current)) {
      const options = Array.from(adjacency.get(current)!.entries()).filter(([key]) => key !== previous);
      if (options.length !== 1 || options[0][1] !== kind) break;
      const following = options[0][0];
      const before = nodes.get(previous)!.position; const middle = nodes.get(current)!.position; const after = nodes.get(following)!.position;
      const cross = (middle[0] - before[0]) * (after[1] - middle[1]) - (middle[1] - before[1]) * (after[0] - middle[0]);
      if (Math.abs(cross) > .001) break;
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