package com.watabou.towngenerator.building;

import openfl.geom.Point;
import com.watabou.geom.Polygon;
import com.watabou.towngenerator.wards.CommonWard;

class BlockFrontage {

	public static function apply( model:Model, seed:Int ):Void {
		#if html5
		model.footprintParcels = [for (patch in model.patches) patch.ward.geometry];
		model.frontageBlocks = [for (patch in model.patches) new Polygon()];
		model.frontageCourtyards = [for (patch in model.patches) new Polygon()];
		model.frontageAccess = [for (patch in model.patches) new Polygon()];
		model.frontagePlots = [for (patch in model.patches) new Array<Polygon>()];
		model.frontageLanes = [for (patch in model.patches) new Array<Polygon>()];
		for (patchIndex in 0...model.patches.length) {
			var patch = model.patches[patchIndex];
			if (!patch.withinCity || !Std.is( patch.ward, CommonWard ) || patch.ward.geometry.length == 0) continue;
			if (model.wall != null && !patch.withinWalls) continue;
			var ward:CommonWard = cast patch.ward;
			var block = snap( ward.getCityBlock() );
			if (block.length < 3 || block.square < 12) continue;
			var center = block.centroid;
			var axis = new Point( 1, 0 );
			var longest = 0.0;
			for (edgeIndex in 0...block.length) {
				var start = block[edgeIndex];
				var direction = block[(edgeIndex + 1) % block.length].subtract( start );
				if (direction.length > longest) {
					longest = direction.length;
					axis = direction;
				}
			}
			if (longest < 1) continue;
			axis.normalize( 1 );
			var normal = new Point( -axis.y, axis.x );
			var minSide = Math.POSITIVE_INFINITY;
			var maxSide = Math.NEGATIVE_INFINITY;
			var minDepth = Math.POSITIVE_INFINITY;
			var maxDepth = Math.NEGATIVE_INFINITY;
			for (point in block) {
				var offset = point.subtract( center );
				var side = offset.x * axis.x + offset.y * axis.y;
				var depth = offset.x * normal.x + offset.y * normal.y;
				minSide = Math.min( minSide, side );
				maxSide = Math.max( maxSide, side );
				minDepth = Math.min( minDepth, depth );
				maxDepth = Math.max( maxDepth, depth );
			}
			var lotArea = ward.getFrontageLotArea();
			var lotWidth = Math.max( 1.2, Math.sqrt( lotArea ) * 0.9 );
			var lotDepth = Math.max( 1.4, Math.sqrt( lotArea ) * 1.05 );
			var laneWidth = Math.min( 0.8, Math.max( 0.35, lotWidth * 0.12 ) );
			var columns = Std.int( Math.max( 1, Math.ceil( (maxSide - minSide) / (lotWidth * 4 + laneWidth) ) ) );
			var rows = Std.int( Math.max( 2, Math.ceil( (maxDepth - minDepth) / (lotDepth * 2 + laneWidth) ) ) );
			var cellWidth = (maxSide - minSide) / columns;
			var cellDepth = (maxDepth - minDepth) / rows;
			var sideCuts = [for (index in 0...columns + 1) minSide + cellWidth * (index +
				(index == 0 || index == columns ? 0 : (((seed ^ (patchIndex * 73856093) ^ (index * 19349663)) & 0x7fffffff) % 21 - 10) / 100))];
			var depthCuts = [for (index in 0...rows + 1) minDepth + cellDepth * (index +
				(index == 0 || index == rows ? 0 : (((seed ^ (patchIndex * 19349663) ^ (index * 73856093)) & 0x7fffffff) % 21 - 10) / 100))];
			var lanes:Array<Polygon> = [];
			for (laneIndex in 1...rows) {
				var laneDepth = depthCuts[laneIndex];
				lanes.push( quad( center, axis, minSide - 1, maxSide + 1, laneDepth - laneWidth / 2, laneDepth + laneWidth / 2 ) );
			}
			for (laneIndex in 1...columns) {
				var laneSide = sideCuts[laneIndex];
				lanes.push( quad( center, axis, laneSide - laneWidth / 2, laneSide + laneWidth / 2, minDepth - 1, maxDepth + 1 ) );
			}
			var access = lanes[0];
			var courtyard = new Polygon();
			var courtyardChosen = false;
			var reserveCourtyard = (((patchIndex * 73856093) ^ seed) & 0x7fffffff) % 3 == 0 && block.square > lotArea * 12;
			var buildings:Array<Polygon> = [];
			var plots:Array<Polygon> = [];
			for (row in 0...rows) {
				for (column in 0...columns) {
					var left = sideCuts[column] + (column == 0 ? 0.08 : laneWidth / 2);
					var right = sideCuts[column + 1] - (column == columns - 1 ? 0.08 : laneWidth / 2);
					var front = depthCuts[row] + (row == 0 ? 0.08 : laneWidth / 2);
					var back = depthCuts[row + 1] - (row == rows - 1 ? 0.08 : laneWidth / 2);
					if (right - left < 0.8 || back - front < 0.8) continue;
					var count = Std.int( Math.max( 1, Math.round( (right - left) / lotWidth ) ) );
					var split = 0.42 + (((seed ^ (row * 19349663) ^ (column * 73856093)) & 0x7fffffff) % 17) / 100;
					var seam = front + (back - front) * split;
					for (lotRow in 0...2) {
						var weights = [for (index in 0...count) 0.72 +
							(((seed ^ (patchIndex * 73856093) ^ (row * 15485863) ^ (column * 19349663) ^ (lotRow * 49979687) ^ (index * 83492791)) & 0x7fffffff) % 57) / 100];
						var totalWeight = 0.0;
						for (weight in weights) totalWeight += weight;
						var cursor = left;
						for (lotIndex in 0...count) {
							var variation = ((patchIndex * 73856093) ^ (row * 19349663) ^ (column * 83492791)
								^ (lotIndex * 15485863) ^ (lotRow * 49979687) ^ seed) & 0x7fffffff;
							var width = (right - left) * weights[lotIndex] / totalWeight;
							var plotLeft = cursor + 0.035;
							var plotRight = cursor + width - 0.035;
							cursor += width;
							var plotFront = (lotRow == 0 ? front : seam) + 0.035;
							var plotBack = (lotRow == 0 ? seam : back) - 0.035;
							var lot = quad( center, axis, plotLeft, plotRight, plotFront, plotBack );
							var clipped = clip( lot, block );
							if (reserveCourtyard && !courtyardChosen && row == 1 && lotRow == 0 && lotIndex == 0 && clipped.length == 1) {
								var court = clip( quad( center, axis, plotLeft, plotRight, front - laneWidth, plotBack ), block );
								if (court.length == 1 && court[0].square > lotArea * 0.3) {
									courtyard = court[0];
									courtyardChosen = true;
									continue;
								}
							}
							for (polygon in clipped) {
								if (polygon.square < Math.max( 0.25, lotArea * 0.025 )) continue;
								for (building in BuildingFootprints.fromFrontagePlot( polygon, lot, variation, true )) {
									buildings.push( building );
									plots.push( polygon );
								}
							}
						}
					}
				}
			}
			if (buildings.length < 3) continue;
			patch.ward.geometry = buildings;
			model.frontageBlocks[patchIndex] = block;
			model.frontageCourtyards[patchIndex] = courtyard;
			model.frontageAccess[patchIndex] = access;
			model.frontagePlots[patchIndex] = plots;
			model.frontageLanes[patchIndex] = lanes;
		}
		#end
	}

	private static function clip( subject:Polygon, boundary:Polygon ):Array<Polygon> {
		#if html5
		var result:Array<Array<Array<Array<Float>>>> = untyped js.Browser.window.polygonClipping.intersection(
			[ring( subject )], [ring( boundary )] );
		var polygons:Array<Polygon> = [];
		for (part in result) {
			if (part.length != 1) continue;
			var outline = part[0];
			var polygon = snap( new Polygon( [for (point in outline.slice( 0, outline.length - 1 )) new Point( point[0], point[1] )] ) );
			if (polygon.length < 3 || Math.abs( polygon.square ) < 0.000001) continue;
			if (polygon.square < 0) polygon.reverse();
			polygons.push( polygon );
		}
		return polygons;
		#else
		return [];
		#end
	}

	private static function ring( polygon:Polygon ):Array<Array<Float>> {
		return [for (point in polygon) [point.x, point.y]];
	}

	private static function snap( polygon:Polygon ):Polygon {
		return new Polygon( [for (point in polygon) new Point(
			Math.round( point.x * 1000000 ) / 1000000,
			Math.round( point.y * 1000000 ) / 1000000 )] );
	}

	private static function quad( start:Point, axis:Point, left:Float, right:Float, front:Float, back:Float ):Polygon {
		var normal = new Point( -axis.y, axis.x );
		return snap( new Polygon( [for (corner in [new Point( left, front ), new Point( right, front ), new Point( right, back ), new Point( left, back )])
			new Point( start.x + corner.x * axis.x + corner.y * normal.x,
				start.y + corner.x * axis.y + corner.y * normal.y )] ) );
	}
}