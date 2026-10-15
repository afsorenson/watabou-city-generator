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
		for (patchIndex in 0...model.patches.length) {
			var patch = model.patches[patchIndex];
			if (!patch.withinCity || !Std.is( patch.ward, CommonWard ) || patch.ward.geometry.length == 0) continue;
			if (model.wall != null && !patch.withinWalls) continue;
			var ward:CommonWard = cast patch.ward;
			var block = snap( ward.getCityBlock() );
			if (block.length < 3 || !block.isConvex() || block.square < 12) continue;
			var center = block.centroid;
			var radius = Math.POSITIVE_INFINITY;
			var accessEdge = 0;
			var longest = 0.0;
			for (edgeIndex in 0...block.length) {
				var start = block[edgeIndex];
				var direction = block[(edgeIndex + 1) % block.length].subtract( start );
				if (direction.length < 0.000001) continue;
				radius = Math.min( radius,
					(direction.x * (center.y - start.y) - direction.y * (center.x - start.x)) / direction.length );
				if (direction.length > longest) {
					longest = direction.length;
					accessEdge = edgeIndex;
				}
			}
			if (radius < 0.8) continue;
			var lotArea = ward.getFrontageLotArea();
			var lotWidth = Math.max( 1.2, Math.sqrt( lotArea ) * 0.8 );
			var depth = Math.min( Math.max( lotWidth * 1.7, radius * 0.58 ), radius * 0.72 );
			var gap = Math.min( 0.12, radius * 0.03 );
			var courtyard = snap( block.shrinkEq( depth + gap ) );
			if (courtyard.length < 3 || courtyard.square <= 0) continue;
			var accessStart = block[accessEdge];
			var accessAxis = block[(accessEdge + 1) % block.length].subtract( accessStart );
			accessAxis.normalize( 1 );
			var accessNormal = new Point( -accessAxis.y, accessAxis.x );
			var offset = (center.x - accessStart.x) * accessAxis.x + (center.y - accessStart.y) * accessAxis.y;
			var accessDepth = (center.x - accessStart.x) * accessNormal.x + (center.y - accessStart.y) * accessNormal.y;
			var accessWidth = Math.min( 1.0, Math.max( 0.6, lotWidth * 0.3 ) );
			var access = quad( accessStart, accessAxis, offset - accessWidth / 2, offset + accessWidth / 2, -gap, accessDepth + gap );
			var buildings:Array<Polygon> = [];
			var plots:Array<Polygon> = [];
			for (edgeIndex in 0...block.length) {
				var start = block[edgeIndex];
				var end = block[(edgeIndex + 1) % block.length];
				var axis = end.subtract( start );
				var length = axis.length;
				if (length < 1) continue;
				axis.normalize( 1 );
				var sector = snap( new Polygon( [start, end, center] ).shrinkEq( gap / 2 ) );
				var count = Std.int( Math.max( 1, Math.round( length / lotWidth ) ) );
				var width = length / count;
				for (lotIndex in 0...count) {
					var variation = ((patchIndex * 73856093) ^ (edgeIndex * 19349663) ^ (lotIndex * 83492791) ^ seed) & 0x7fffffff;
					var back = depth * (0.92 + (variation % 9) / 100);
					var lot = quad( start, axis, lotIndex * width + gap, (lotIndex + 1) * width - gap, gap, back );
					var intersection:Dynamic = untyped js.Browser.window.polygonClipping.intersection( [ring( lot )], [ring( sector )] );
					var clipped:Array<Array<Array<Array<Float>>>> = untyped js.Browser.window.polygonClipping.difference(
						intersection, [ring( courtyard )], [ring( access )] );
					for (part in clipped) {
						if (part.length != 1) continue;
						var outline = part[0];
						var polygon = snap( new Polygon( [for (point in outline.slice( 0, outline.length - 1 )) new Point( point[0], point[1] )] ) );
						if (polygon.length < 3 || Math.abs( polygon.square ) < Math.max( 0.25, lotArea * 0.025 )) continue;
						if (polygon.square < 0) polygon.reverse();
						for (building in BuildingFootprints.fromFrontagePlot( polygon, block, variation )) {
							buildings.push( building );
							plots.push( polygon );
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
		}
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