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
		model.frontageLanePaths = [for (patch in model.patches) new Array<Polygon>()];
		model.frontageLaneKinds = [for (patch in model.patches) new Array<String>()];
		model.frontageTransitions = [for (patch in model.patches) null];
		model.frontageGroupIds = [for (patch in model.patches) new Array<Int>()];
		model.frontageGroupPassages = [for (patch in model.patches) new Array<Polygon>()];
		for (patchIndex in 0...model.patches.length) {
			var patch = model.patches[patchIndex];
			if (!patch.withinCity || !Std.is( patch.ward, CommonWard ) || patch.ward.geometry.length == 0) continue;
			if (model.wall != null && !patch.withinWalls) continue;
			var ward:CommonWard = cast patch.ward;
			var transitions = new DistrictTransitions( model, patch );
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
			var depthCuts = [for (index in 0...rows + 1) minDepth + cellDepth * (index +
				(index == 0 || index == rows ? 0 : (((seed ^ (patchIndex * 19349663) ^ (index * 73856093)) & 0x7fffffff) % 21 - 10) / 100))];
			var bandCuts = [for (row in 0...rows) [for (index in 0...columns + 1)
				index == 0 ? minSide : (index == columns ? maxSide :
				minSide + cellWidth * (index + (row % 2 == 0 ? -0.16 : 0.16) +
				(((seed ^ (patchIndex * 19349663) ^ (index * 73856093)) & 0x7fffffff) % 11 - 5) / 100))]];
			var projected = new Polygon( [for (point in block) new Point(
				(point.x - center.x) * axis.x + (point.y - center.y) * axis.y,
				(point.x - center.x) * normal.x + (point.y - center.y) * normal.y )] );
			var knots = [minSide - 1];
			for (index in 0...columns * 2 + 1) knots.push( minSide + (maxSide - minSide) * index / (columns * 2) );
			knots.push( maxSide + 1 );
			var profile = [for (cut in 0...rows + 1) [for (side in knots)
				cut == 0 ? minDepth : (cut == rows ? maxDepth : boundaryDepth( projected, side, depthCuts[cut], minDepth, maxDepth ))]];
			var lanes:Array<Polygon> = [];
			var paths:Array<Polygon> = [];
			var kinds:Array<String> = [];
			for (laneIndex in 1...rows) {
				var localPath = new Polygon( [for (index in 0...knots.length) new Point( knots[index], profile[laneIndex][index] )] );
				paths.push( toWorld( localPath, center, axis ) );
				var outline = [for (point in localPath) new Point( point.x, point.y - laneWidth / 2 )];
				var upper = [for (point in localPath) new Point( point.x, point.y + laneWidth / 2 )];
				upper.reverse();
				lanes.push( toWorld( new Polygon( outline.concat( upper ) ), center, axis ) );
				kinds.push( "spine" );
			}
			for (row in 0...rows) {
				for (laneIndex in 1...columns) {
					var laneSide = bandCuts[row][laneIndex];
					var startDepth = row == 0 ? minDepth - 1 : profileAt( knots, profile[row], laneSide ) - laneWidth / 2;
					var endDepth = row == rows - 1 ? maxDepth + 1 : profileAt( knots, profile[row + 1], laneSide ) + laneWidth / 2;
					lanes.push( quad( center, axis, laneSide - laneWidth / 2, laneSide + laneWidth / 2, startDepth, endDepth ) );
					paths.push( toWorld( new Polygon( [new Point( laneSide, startDepth ), new Point( laneSide, endDepth )] ), center, axis ) );
					kinds.push( "connector" );
				}
			}
			var access = lanes[0];
			var courtyard = new Polygon();
			var courtyardChosen = false;
			var reserveCourtyard = (((patchIndex * 73856093) ^ seed) & 0x7fffffff) % 3 == 0 && block.square > lotArea * 12;
			var buildings:Array<Polygon> = [];
			var plots:Array<Polygon> = [];
			var groupIds:Array<Int> = [];
			var groupPassages:Array<Polygon> = [];
			for (row in 0...rows) {
				for (column in 0...columns) {
					var left = bandCuts[row][column] + (column == 0 ? 0.08 : laneWidth / 2);
					var right = bandCuts[row][column + 1] - (column == columns - 1 ? 0.08 : laneWidth / 2);
					var cellKnots = [left];
					for (side in knots) if (side > left && side < right) cellKnots.push( side );
					cellKnots.push( right );
					var lower = [for (side in cellKnots) new Point( side,
						profileAt( knots, profile[row], side ) + (row == 0 ? 0.08 : laneWidth / 2) )];
					var upper = [for (side in cellKnots) new Point( side,
						profileAt( knots, profile[row + 1], side ) - (row == rows - 1 ? 0.08 : laneWidth / 2) )];
					var front = Math.POSITIVE_INFINITY;
					var back = Math.NEGATIVE_INFINITY;
					for (point in lower) front = Math.min( front, point.y );
					for (point in upper) back = Math.max( back, point.y );
					upper.reverse();
					var cell = toWorld( new Polygon( lower.concat( upper ) ), center, axis );
					if (right - left < 0.8 || back - front < 0.8) continue;
					var cellCenter = toWorld( new Polygon( [new Point( (left + right) / 2, (front + back) / 2 )] ), center, axis )[0];
					var localArea = transitions.sample( cellCenter ).area;
					var lotRows = Std.int( Math.max( 1, Math.min( 4, Math.round( 2 * Math.sqrt( lotArea / localArea ) ) ) ) );
					var split = 0.42 + (((seed ^ (row * 19349663) ^ (column * 73856093)) & 0x7fffffff) % 17) / 100;
					var rowFractions = lotRows == 2 ? [0.0, split, 1.0] : [for (index in 0...lotRows + 1) index / lotRows];
					for (lotRow in 0...lotRows) {
						var rowStart = buildings.length;
						var rowCenter = toWorld( new Polygon( [new Point( (left + right) / 2,
							front + (back - front) * (rowFractions[lotRow] + rowFractions[lotRow + 1]) / 2 )] ), center, axis )[0];
						var rowWidth = Math.max( 1.2, Math.sqrt( transitions.sample( rowCenter ).area ) * 0.9 );
						var count = Std.int( Math.max( 1, Math.round( (right - left) / rowWidth ) ) );
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
							var plotSides = [plotLeft, plotRight];
							for (side in knots) if (side > plotLeft && side < plotRight) plotSides.push( side );
							var plotFront = Math.NEGATIVE_INFINITY;
							var plotBack = Math.POSITIVE_INFINITY;
							for (side in plotSides) {
								var lowerDepth = profileAt( knots, profile[row], side ) + (row == 0 ? 0.08 : laneWidth / 2);
								var upperDepth = profileAt( knots, profile[row + 1], side ) - (row == rows - 1 ? 0.08 : laneWidth / 2);
								plotFront = Math.max( plotFront, lowerDepth + (upperDepth - lowerDepth) * rowFractions[lotRow] );
								plotBack = Math.min( plotBack, lowerDepth + (upperDepth - lowerDepth) * rowFractions[lotRow + 1] );
							}
							plotFront += 0.035;
							plotBack -= 0.035;
							if (plotBack - plotFront < 0.4) continue;
							var lot = quad( center, axis, plotLeft, plotRight, plotFront, plotBack );
							var clipped:Array<Polygon> = [];
							for (part in clip( lot, cell )) clipped = clipped.concat( clip( part, block ) );
							if (reserveCourtyard && !courtyardChosen && row == 1 && lotRow == 0 && lotIndex == 0 && clipped.length == 1) {
								var courtOutline = toWorld( new Polygon( [
									new Point( plotLeft, profileAt( knots, profile[row], plotLeft ) ),
									new Point( plotRight, profileAt( knots, profile[row], plotRight ) ),
									new Point( plotRight, plotBack ), new Point( plotLeft, plotBack )] ), center, axis );
								var court = clip( courtOutline, block );
								if (court.length == 1 && court[0].square > lotArea * 0.3) {
									courtyard = court[0];
									courtyardChosen = true;
									continue;
								}
							}
							for (polygon in clipped) {
								if (polygon.square < Math.max( 0.25, lotArea * 0.025 )) continue;
									for (building in BuildingFootprints.fromFrontagePlot( polygon, lot, variation, true, transitions.alignmentAt( polygon.centroid ) )) {
									buildings.push( building );
									plots.push( polygon );
										groupIds.push( -1 );
								}
							}
						}
						BuildingGroups.apply( buildings, plots, groupIds, groupPassages, rowStart, center, axis, cell, block, courtyard,
							(seed ^ (patchIndex * 73856093) ^ (row * 19349663) ^ (column * 83492791) ^ (lotRow * 49979687)) & 0x7fffffff );
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
			model.frontageLanePaths[patchIndex] = paths;
			model.frontageLaneKinds[patchIndex] = kinds;
			model.frontageTransitions[patchIndex] = transitions;
			model.frontageGroupIds[patchIndex] = groupIds;
			model.frontageGroupPassages[patchIndex] = groupPassages;
		}
		#end
	}

	private static function boundaryDepth( boundary:Polygon, side:Float, depth:Float, minDepth:Float, maxDepth:Float ):Float {
		var crossings:Array<Float> = [];
		boundary.forEdge( function( start, end ) {
			if ((start.x <= side && end.x > side) || (end.x <= side && start.x > side))
				crossings.push( start.y + (end.y - start.y) * (side - start.x) / (end.x - start.x) );
		} );
		if (crossings.length < 2) return depth;
		crossings.sort( function( first, second ) return first < second ? -1 : (first > second ? 1 : 0) );
		var fraction = (depth - minDepth) / (maxDepth - minDepth);
		var conformed = crossings[0] + fraction * (crossings[crossings.length - 1] - crossings[0]);
		return depth * 0.76 + conformed * 0.24;
	}

	private static function profileAt( sides:Array<Float>, depths:Array<Float>, side:Float ):Float {
		for (index in 1...sides.length) {
			if (side <= sides[index]) {
				var fraction = (side - sides[index - 1]) / (sides[index] - sides[index - 1]);
				return depths[index - 1] + fraction * (depths[index] - depths[index - 1]);
			}
		}
		return depths[depths.length - 1];
	}

	private static function toWorld( polygon:Polygon, center:Point, axis:Point ):Polygon {
		return snap( new Polygon( [for (point in polygon) new Point(
			center.x + point.x * axis.x - point.y * axis.y,
			center.y + point.x * axis.y + point.y * axis.x )] ) );
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