package com.watabou.towngenerator.building;

import openfl.geom.Point;
import com.watabou.geom.Polygon;
import com.watabou.towngenerator.wards.CommonWard;

class BuildingFootprints {

	public static function apply( model:Model, seed:Int ):Void {
		model.footprintParcels = [for (patch in model.patches) patch.ward.geometry];
		for (patchIndex in 0...model.patches.length) {
			var patch = model.patches[patchIndex];
			if (!Std.is( patch.ward, CommonWard )) continue;
			var block = patch.ward.getCityBlock();
			var parcels = model.footprintParcels[patchIndex];
			patch.ward.geometry = [for (parcelIndex in 0...parcels.length)
				create( parcels[parcelIndex], block,
					((patchIndex * 73856093) ^ (parcelIndex * 19349663) ^ seed) & 0x7fffffff )];
		}
	}

	private static function create( parcel:Polygon, block:Polygon, variation:Int ):Polygon {
		if (parcel.length < 3 || !parcel.isConvex() || parcel.square < 0.2) return parcel;
		var center = parcel.centroid;
		var frontage = nearestEdge( block, center );
		var rectangle = inscribed( parcel, center, frontage );
		if (rectangle.square < parcel.square * 0.38) {
			var alternative = inscribed( parcel, center, longestEdge( parcel ) );
			if (alternative.square > rectangle.square) rectangle = alternative;
		}
		if (rectangle.square < 0.05) return parcel;
		var width = Point.distance( rectangle[0], rectangle[1] );
		var depth = Point.distance( rectangle[1], rectangle[2] );
		if (Math.min( width, depth ) < 2 || rectangle.square < 12) return rectangle;
		var shape = variation % 10;
		if (shape >= 5) return rectangle;
		var side = rectangle[1].subtract( rectangle[0] );
		var inward = rectangle[3].subtract( rectangle[0] );
		var notch = 0.26 + ((variation >>> 5) % 15) / 100;
		var outline:Array<Point> = shape < 3 ? [
			new Point( 0, 0 ), new Point( 1, 0 ), new Point( 1, 1 - notch ),
			new Point( 1 - notch, 1 - notch ), new Point( 1 - notch, 1 ), new Point( 0, 1 )
		] : [
			new Point( 0, 0 ), new Point( 1, 0 ), new Point( 1, 0.65 ),
			new Point( 0.8, 0.65 ), new Point( 0.8, 1 ), new Point( 0.2, 1 ),
			new Point( 0.2, 0.65 ), new Point( 0, 0.65 )
		];
		return new Polygon( [for (point in outline) new Point(
			rectangle[0].x + point.x * side.x + point.y * inward.x,
			rectangle[0].y + point.x * side.y + point.y * inward.y )] );
	}

	private static function nearestEdge( polygon:Polygon, center:Point ):Point {
		var result = longestEdge( polygon );
		var nearest = Math.POSITIVE_INFINITY;
		polygon.forEdge( function( start, end ) {
			var direction = end.subtract( start );
			var lengthSquared = direction.x * direction.x + direction.y * direction.y;
			if (lengthSquared < 0.000001) return;
			var projection = ((center.x - start.x) * direction.x + (center.y - start.y) * direction.y) / lengthSquared;
			projection = Math.max( 0, Math.min( 1, projection ) );
			var distance = Point.distance( center, new Point(
				start.x + projection * direction.x, start.y + projection * direction.y ) );
			if (distance < nearest) {
				nearest = distance;
				result = direction;
			}
		} );
		result.normalize( 1 );
		return result;
	}

	private static function longestEdge( polygon:Polygon ):Point {
		var result = new Point( 1, 0 );
		var longest = 0.0;
		polygon.forEdge( function( start, end ) {
			var direction = end.subtract( start );
			if (direction.length > longest) {
				longest = direction.length;
				result = direction;
			}
		} );
		result.normalize( 1 );
		return result;
	}

	private static function inscribed( parcel:Polygon, center:Point, axis:Point ):Polygon {
		var normal = new Point( -axis.y, axis.x );
		var minSide = Math.POSITIVE_INFINITY;
		var maxSide = Math.NEGATIVE_INFINITY;
		var minDepth = Math.POSITIVE_INFINITY;
		var maxDepth = Math.NEGATIVE_INFINITY;
		for (point in parcel) {
			var offset = point.subtract( center );
			var side = offset.x * axis.x + offset.y * axis.y;
			var depth = offset.x * normal.x + offset.y * normal.y;
			minSide = Math.min( minSide, side );
			maxSide = Math.max( maxSide, side );
			minDepth = Math.min( minDepth, depth );
			maxDepth = Math.max( maxDepth, depth );
		}
		var halfWidth = (maxSide - minSide) / 2;
		var halfDepth = (maxDepth - minDepth) / 2;
		var setback = Math.min( 0.28, Math.sqrt( parcel.square ) * 0.045 );
		var fit = 1.0;
		parcel.forEdge( function( start, end ) {
			var edge = end.subtract( start );
			var edgeLength = edge.length;
			if (edgeLength < 0.000001) return;
			var clearance = (edge.x * (center.y - start.y) - edge.y * (center.x - start.x)) / edgeLength;
			var extent = (Math.abs( edge.x * axis.y - edge.y * axis.x ) * halfWidth
				+ Math.abs( edge.x * normal.y - edge.y * normal.x ) * halfDepth) / edgeLength;
			if (extent > 0) fit = Math.min( fit, Math.max( 0, clearance - setback ) / extent );
		} );
		var width = halfWidth * fit;
		var depth = halfDepth * fit;
		return new Polygon( [for (corner in [new Point( -1, -1 ), new Point( 1, -1 ), new Point( 1, 1 ), new Point( -1, 1 )])
			new Point( center.x + corner.x * width * axis.x + corner.y * depth * normal.x,
				center.y + corner.x * width * axis.y + corner.y * depth * normal.y )] );
	}
}