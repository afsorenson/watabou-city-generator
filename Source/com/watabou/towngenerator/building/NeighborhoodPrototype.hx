package com.watabou.towngenerator.building;

import openfl.geom.Point;
import com.watabou.geom.Polygon;
import com.watabou.towngenerator.wards.CommonWard;

class NeighborhoodPrototype {

	public static function apply( model:Model, seed:Int ):Void {
		#if html5
		var chosen = -1;
		var largest = 0.0;
		for (index in 0...model.frontageBlocks.length) {
			var block = model.frontageBlocks[index];
			if (block.length < 3 || !block.isConvex() || block.compactness < 0.45) continue;
			if (block.square > largest) { chosen = index; largest = block.square; }
		}
		if (chosen < 0) return;
		var block = model.frontageBlocks[chosen];
		var ward:CommonWard = cast model.patches[chosen].ward;
		var lotArea = ward.getFrontageLotArea();
		if (block.square < lotArea * 18) return;
		var junction = block.centroid;
		var perimeter = block.perimeter;
		var anchors:Array<{edge:Int, distance:Float, point:Point}> = [];
		for (branch in 0...3) {
			var distance = perimeter * (0.13 + branch / 3);
			var remaining = distance;
			for (edge in 0...block.length) {
				var start = block[edge];
				var end = block[(edge + 1) % block.length];
				var length = Point.distance( start, end );
				if (remaining <= length || edge == block.length - 1) {
					anchors.push( {edge: edge, distance: distance, point: Point.interpolate( end, start, remaining / length )} );
					break;
				}
				remaining -= length;
			}
		}
		var lanes:Array<Polygon> = [];
		var paths:Array<Polygon> = [];
		var kinds:Array<String> = [];
		var widths:Array<Float> = [];
		var regions:Array<Polygon> = [];
		var lotWidth = Math.max( 1.2, Math.sqrt( lotArea ) * 0.9 );
		for (index in 0...anchors.length) {
			var anchor = anchors[index];
			var direction = anchor.point.subtract( junction );
			direction.normalize( 1 );
			var width = index < 2 ? StreetHierarchy.spine( lotWidth ) : StreetHierarchy.connector( lotWidth );
			var normal = new Point( -direction.y * width / 2, direction.x * width / 2 );
			var start = junction.subtract( new Point( direction.x * width, direction.y * width ) );
			var end = anchor.point.add( new Point( direction.x * width, direction.y * width ) );
			lanes.push( new Polygon( [start.subtract( normal ), end.subtract( normal ), end.add( normal ), start.add( normal )] ) );
			paths.push( new Polygon( [start, end] ) );
			kinds.push( index < 2 ? "spine" : "connector" );
			widths.push( width );
			var next = anchors[(index + 1) % anchors.length];
			var vertices = [anchor.point];
			var edge = anchor.edge;
			var steps = 0;
			while (edge != next.edge || (steps == 0 && next.distance < anchor.distance)) {
				vertices.push( block[(edge + 1) % block.length] );
				edge = (edge + 1) % block.length;
				steps++;
				if (steps > block.length) return;
			}
			vertices.push( next.point );
			vertices.push( junction );
			regions.push( new Polygon( vertices ) );
		}
		var buildings:Array<Polygon> = [];
		var plots:Array<Polygon> = [];
		var groupIds:Array<Int> = [];
		var groupPassages:Array<Polygon> = [];
		for (regionIndex in 0...regions.length) {
			var region = regions[regionIndex];
			var axis = anchors[regionIndex].point.subtract( junction );
			axis.normalize( 1 );
			var minSide = Math.POSITIVE_INFINITY;
			var maxSide = Math.NEGATIVE_INFINITY;
			var minDepth = Math.POSITIVE_INFINITY;
			var maxDepth = Math.NEGATIVE_INFINITY;
			for (point in region) {
				var offset = point.subtract( junction );
				var side = offset.x * axis.x + offset.y * axis.y;
				var depth = -offset.x * axis.y + offset.y * axis.x;
				minSide = Math.min( minSide, side ); maxSide = Math.max( maxSide, side );
				minDepth = Math.min( minDepth, depth ); maxDepth = Math.max( maxDepth, depth );
			}
			var laneWidth = StreetHierarchy.connector( lotWidth );
			var columns = Std.int( Math.max( 1, Math.ceil( (maxSide - minSide) / (lotWidth * 4 + laneWidth) ) ) );
			var rows = Std.int( Math.max( 1, Math.ceil( (maxDepth - minDepth) / (Math.sqrt( lotArea ) * 2.1 + laneWidth) ) ) );
			var cellWidth = (maxSide - minSide) / columns;
			var cellDepth = (maxDepth - minDepth) / rows;
			var depthCuts = [for (index in 0...rows + 1) minDepth + cellDepth * (index +
				(index == 0 || index == rows ? 0 : (((seed ^ (regionIndex * 73856093) ^ (index * 19349663)) & 0x7fffffff) % 21 - 10) / 100))];
			var sideCuts = [for (row in 0...rows) [for (index in 0...columns + 1)
				index == 0 ? minSide : (index == columns ? maxSide : minSide + cellWidth * (index +
				(row % 2 == 0 ? -0.15 : 0.15) + (((seed ^ (regionIndex * 19349663) ^ (index * 73856093)) & 0x7fffffff) % 9 - 4) / 100))]];
			for (row in 1...rows) {
				var depth = depthCuts[row];
				var lane = quad( junction, axis, minSide - 1, maxSide + 1, depth - laneWidth / 2, depth + laneWidth / 2 );
				for (part in intersection( lane, region )) {
					lanes.push( part ); kinds.push( "local-cross" ); widths.push( laneWidth );
					paths.push( new Polygon( [worldPoint( minSide - 1, depth, junction, axis ), worldPoint( maxSide + 1, depth, junction, axis )] ) );
				}
			}
			for (row in 0...rows) for (column in 1...columns) {
				var side = sideCuts[row][column];
				var front = row == 0 ? minDepth - 1 : depthCuts[row] - laneWidth / 2;
				var back = row == rows - 1 ? maxDepth + 1 : depthCuts[row + 1] + laneWidth / 2;
				var lane = quad( junction, axis, side - laneWidth / 2, side + laneWidth / 2, front, back );
				for (part in intersection( lane, region )) {
					lanes.push( part ); kinds.push( "local-connector" ); widths.push( laneWidth );
					paths.push( new Polygon( [worldPoint( side, front, junction, axis ), worldPoint( side, back, junction, axis )] ) );
				}
			}
			for (row in 0...rows) for (column in 0...columns) {
				var left = sideCuts[row][column] + 0.06 + (column == 0 ? 0 : laneWidth / 2);
				var right = sideCuts[row][column + 1] - 0.06 - (column == columns - 1 ? 0 : laneWidth / 2);
				var front = depthCuts[row] + 0.06 + (row == 0 ? 0 : laneWidth / 2);
				var back = depthCuts[row + 1] - 0.06 - (row == rows - 1 ? 0 : laneWidth / 2);
				var count = Std.int( Math.max( 1, Math.round( (right - left) / lotWidth ) ) );
				var split = 0.4 + (((seed ^ (row * 73856093) ^ (column * 19349663) ^ regionIndex) & 0x7fffffff) % 21) / 100;
				var fractions = [0.0, split, 1.0];
				for (lotRow in 0...2) {
				var weights = [for (index in 0...count) 0.75 + (((seed ^ (regionIndex * 73856093) ^ (row * 19349663)
					^ (column * 15485863) ^ (lotRow * 49979687) ^ (index * 83492791)) & 0x7fffffff) % 51) / 100];
				var total = 0.0;
				for (weight in weights) total += weight;
				var cursor = left;
				for (lotIndex in 0...count) {
					var width = (right - left) * weights[lotIndex] / total;
					var plot = quad( junction, axis, cursor + 0.035, cursor + width - 0.035,
						front + fractions[lotRow] * (back - front) + 0.035, front + fractions[lotRow + 1] * (back - front) - 0.035 );
					cursor += width;
					var parts = intersection( plot, region );
					for (lane in lanes) parts = subtract( parts, lane );
					for (part in parts) {
						var variation = (seed ^ (regionIndex * 73856093) ^ (row * 19349663) ^ (column * 83492791) ^ (lotIndex * 15485863)) & 0x7fffffff;
						for (building in BuildingFootprints.fromFrontagePlot( part, plot, variation, true )) {
							buildings.push( building ); plots.push( part ); groupIds.push( -1 );
						}
					}
				}
				}
			}
		}
		var junctionBuildings = 0;
		for (regionIndex in 0...regions.length) {
			var axis = anchors[regionIndex].point.subtract( junction );
			axis.normalize( 1 );
			var next = anchors[(regionIndex + 1) % anchors.length].point.subtract( junction );
			next.normalize( 1 );
			var inward = axis.add( next );
			if (inward.length < 0.01) continue;
			inward.normalize( 1 );
			for (step in 0...3) {
				var distance = lotWidth * (0.7 + step * 0.6);
				var origin = junction.add( new Point( inward.x * distance, inward.y * distance ) );
				var plot = quad( origin, axis, -lotWidth * 0.45, lotWidth * 0.45, -lotWidth * 0.55, lotWidth * 0.55 );
				var parts = intersection( plot, regions[regionIndex] );
				for (lane in lanes) parts = subtract( parts, lane );
				for (building in buildings) parts = subtract( parts, building );
				for (part in parts) {
					var variation = (seed ^ (regionIndex * 73856093) ^ (step * 19349663)) & 0x7fffffff;
					var candidates = BuildingFootprints.fromFrontagePlot( part, plot, variation, true );
					if (candidates.length == 0) candidates = BuildingFootprints.repairOutlier( part );
					if (candidates.length == 0) candidates = fitPocket( part, axis, lotWidth );
					for (building in candidates) {
						buildings.push( building ); plots.push( part ); groupIds.push( -1 ); junctionBuildings++;
					}
				}
			}
		}
		var previousArea = 0.0;
		for (building in model.patches[chosen].ward.geometry) previousArea += Math.abs( building.square );
		var area = 0.0;
		for (building in buildings) area += Math.abs( building.square );
		model.prototypeAttempt = {patchIndex: chosen, previousArea: previousArea, candidateArea: area};
		if (buildings.length < 8 || area < previousArea * 0.85 || area > previousArea * 1.15) return;
		model.patches[chosen].ward.geometry = buildings;
		model.frontagePlots[chosen] = plots;
		model.frontageCourtyards[chosen] = new Polygon();
		model.frontageLanes[chosen] = lanes;
		model.frontageAccess[chosen] = lanes[0];
		model.frontageLanePaths[chosen] = paths;
		model.frontageLaneKinds[chosen] = kinds;
		model.frontageLaneWidths[chosen] = widths;
		model.frontageGroupIds[chosen] = groupIds;
		model.frontageGroupPassages[chosen] = groupPassages;
		model.prototypePatchIndex = chosen;
		model.prototypeRegions = regions;
		model.prototypeJunctionBuildings = junctionBuildings;
		#end
	}

	private static function fitPocket( pocket:Polygon, axis:Point, lotWidth:Float ):Array<Polygon> {
		#if html5
		var origin = pocket.centroid;
		var minSide = Math.POSITIVE_INFINITY;
		var maxSide = Math.NEGATIVE_INFINITY;
		var minDepth = Math.POSITIVE_INFINITY;
		var maxDepth = Math.NEGATIVE_INFINITY;
		for (point in pocket) {
			var offset = point.subtract( origin );
			var side = offset.x * axis.x + offset.y * axis.y;
			var depth = -offset.x * axis.y + offset.y * axis.x;
			minSide = Math.min( minSide, side ); maxSide = Math.max( maxSide, side );
			minDepth = Math.min( minDepth, depth ); maxDepth = Math.max( maxDepth, depth );
		}
		for (fraction in [0.55, 0.4, 0.3]) {
			var width = lotWidth * fraction;
			var depth = width * 1.25;
			if (width < 0.8 || width + 0.08 > maxSide - minSide || depth + 0.08 > maxDepth - minDepth) continue;
			for (sideIndex in 0...7) for (depthIndex in 0...7) {
				var left = minSide + 0.04 + (maxSide - minSide - width - 0.08) * sideIndex / 6;
				var front = minDepth + 0.04 + (maxDepth - minDepth - depth - 0.08) * depthIndex / 6;
				var building = quad( origin, axis, left, left + width, front, front + depth );
				var outside:Array<Array<Array<Array<Float>>>>;
				try outside = untyped js.Browser.window.polygonClipping.difference( [ring( building )], [ring( pocket )] )
				catch (error:Dynamic) continue;
				var area = 0.0;
				for (polygon in outside) {
					var outline = polygon[0];
					area += Math.abs( new Polygon( [for (point in outline.slice( 0, outline.length - 1 )) new Point( point[0], point[1] )] ).square );
				}
				if (area < 0.0000001) return [building];
			}
		}
		#end
		return [];
	}

	private static function intersection( first:Polygon, second:Polygon ):Array<Polygon> {
		#if html5
		return polygons( untyped js.Browser.window.polygonClipping.intersection( [ring( first )], [ring( second )] ) );
		#else
		return [];
		#end
	}

	private static function subtract( subjects:Array<Polygon>, clip:Polygon ):Array<Polygon> {
		#if html5
		return subjects.length == 0 ? [] : polygons( untyped js.Browser.window.polygonClipping.difference(
			[for (subject in subjects) [ring( subject )]], [ring( clip )] ) );
		#else
		return [];
		#end
	}

	private static function polygons( parts:Array<Array<Array<Array<Float>>>> ):Array<Polygon> {
		var result:Array<Polygon> = [];
		for (part in parts) {
			if (part.length != 1) continue;
			var polygon = new Polygon( [for (point in part[0].slice( 0, part[0].length - 1 )) new Point( point[0], point[1] )] );
			if (polygon.length < 3 || Math.abs( polygon.square ) < 0.05) continue;
			if (polygon.square < 0) polygon.reverse();
			result.push( polygon );
		}
		return result;
	}

	private static function ring( polygon:Polygon ):Array<Array<Float>> return [for (point in polygon) [point.x, point.y]];
	private static function worldPoint( side:Float, depth:Float, origin:Point, axis:Point ):Point
		return new Point( origin.x + side * axis.x - depth * axis.y, origin.y + side * axis.y + depth * axis.x );
	private static function quad( origin:Point, axis:Point, left:Float, right:Float, front:Float, back:Float ):Polygon
		return new Polygon( [worldPoint( left, front, origin, axis ), worldPoint( right, front, origin, axis ),
			worldPoint( right, back, origin, axis ), worldPoint( left, back, origin, axis )] );
}