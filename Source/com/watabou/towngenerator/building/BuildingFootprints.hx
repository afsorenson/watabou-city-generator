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
			var alternativeAxis = longestEdge( parcel );
			if (alternativeAxis.x * frontage.x + alternativeAxis.y * frontage.y < 0) {
				alternativeAxis.x = -alternativeAxis.x;
				alternativeAxis.y = -alternativeAxis.y;
			}
			var alternative = inscribed( parcel, center, alternativeAxis );
			if (alternative.square > rectangle.square) rectangle = alternative;
		}
		if (rectangle.square < 0.05) return parcel;
		return articulate( rectangle, variation );
	}

	public static function fromFrontagePlot( parcel:Polygon, block:Polygon, variation:Int, dense=false, alignment:Point=null ):Array<Polygon> {
		if (parcel.length < 3 || !parcel.isConvex() || parcel.square < 0.4) return [];
		var rectangle = create( parcel, block, 9 );
		if (rectangle == parcel || rectangle.length != 4 || rectangle.square < 0.3) return [];
		if (alignment != null) {
			var candidate = inscribed( parcel, parcel.centroid, alignment, true );
			if (candidate.square >= rectangle.square * 0.9) rectangle = candidate;
		}
		var width = Point.distance( rectangle[0], rectangle[1] );
		var depth = Point.distance( rectangle[1], rectangle[2] );
		if (Math.min( width, depth ) < 0.35) return [];
		var side = rectangle[1].subtract( rectangle[0] );
		var inward = rectangle[3].subtract( rectangle[0] );
		var count = !dense && depth > width * 2.6 && depth > 4 ? 2 : 1;
		var buildings:Array<Polygon> = [];
		for (buildingIndex in 0...count) {
			var detail = (variation ^ (buildingIndex * 83492791)) & 0x7fffffff;
			var sideInset = dense ? 0.01 + (detail % 4) / 200 : 0.015 + (detail % 6) / 100;
			var front = buildingIndex == 0 ? 0.0 : 0.5 + Math.min( 0.12, 0.45 / depth );
			var back = count == 1 ? (dense ? 0.93 + ((detail >>> 4) % 6) / 100 : 0.76 + ((detail >>> 4) % 22) / 100) :
				(buildingIndex == 0 ? 0.47 : 0.86 + ((detail >>> 4) % 12) / 100);
			var outline = new Polygon( [for (corner in [new Point( sideInset, front ), new Point( 1 - sideInset, front ),
				new Point( 1 - sideInset, back ), new Point( sideInset, back )]) new Point(
				rectangle[0].x + corner.x * side.x + corner.y * inward.x,
				rectangle[0].y + corner.x * side.y + corner.y * inward.y )] );
			if (outline.square >= 0.2) buildings.push( articulate( outline, detail ) );
		}
		return buildings;
	}

	public static function repairOutlier( parcel:Polygon ):Array<Polygon> {
		if (parcel.length < 3 || parcel.square < 0.2) return [];
		var rectangle = inscribed( parcel, parcel.centroid, longestEdge( parcel ), true );
		var side = rectangle[1].subtract( rectangle[0] );
		var inward = rectangle[3].subtract( rectangle[0] );
		var width = side.length;
		var depth = inward.length;
		if (Math.min( width, depth ) < 0.35 || rectangle.square < 0.2) return [];
		var horizontal = width >= depth;
		var count = Std.int( Math.max( 1, Math.ceil( Math.max( width, depth ) / Math.min( width, depth ) / 4 ) ) );
		if (count > 16) return [];
		var buildings:Array<Polygon> = [];
		for (index in 0...count) {
			var gap = count == 1 ? 0.0 : Math.min( 0.04, 0.1 / (horizontal ? width : depth) );
			var front = index / count + (index == 0 ? 0 : gap);
			var back = (index + 1) / count - (index == count - 1 ? 0 : gap);
			var outline = horizontal ? [new Point( front, 0 ), new Point( back, 0 ), new Point( back, 1 ), new Point( front, 1 )] :
				[new Point( 0, front ), new Point( 1, front ), new Point( 1, back ), new Point( 0, back )];
			var building = new Polygon( [for (point in outline) new Point(
				rectangle[0].x + point.x * side.x + point.y * inward.x,
				rectangle[0].y + point.x * side.y + point.y * inward.y )] );
			if (building.square >= 0.2 && FootprintQuality.reason( building ) == null) buildings.push( building );
		}
		return buildings;
	}

	private static function articulate( rectangle:Polygon, variation:Int ):Polygon {
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

	private static function inscribed( parcel:Polygon, center:Point, axis:Point, refine=false ):Polygon {
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
		var spanWidth = maxSide - minSide;
		var spanDepth = maxDepth - minDepth;
		var setback = Math.min( 0.18, Math.sqrt( parcel.square ) * 0.03 );
		var constraints = [];
		parcel.forEdge( function( start, end ) {
			var edge = end.subtract( start );
			var edgeLength = edge.length;
			if (edgeLength < 0.000001) return;
			constraints.push( {
				side: (edge.x * axis.y - edge.y * axis.x) / edgeLength,
				depth: (edge.x * normal.y - edge.y * normal.x) / edgeLength,
				clearance: (edge.x * (center.y - start.y) - edge.y * (center.x - start.x)) / edgeLength
			} );
		} );
		var bestScore = -1.0;
		var bestSide = 0.0;
		var bestDepth = 0.0;
		var width = 0.0;
		var depth = 0.0;
		if (refine) {
			var centeredFit = 1.0;
			for (constraint in constraints) {
				var extent = Math.abs( constraint.side ) * spanWidth / 2 + Math.abs( constraint.depth ) * spanDepth / 2;
				if (extent > 0) centeredFit = Math.min( centeredFit, Math.max( 0, constraint.clearance - setback ) / extent );
			}
			width = spanWidth * centeredFit / 2;
			depth = spanDepth * centeredFit / 2;
			bestScore = width * depth;
		}
		var offsets = refine ? [0.0, 0.01, 0.025, 0.06, 0.12, 0.2] : [0.0, 0.06, 0.12, 0.2];
		for (frontOffset in offsets) {
			var front = minDepth + setback + spanDepth * frontOffset;
			for (depthStep in 0...14) {
				var halfDepth = (spanDepth - setback * 2 - spanDepth * frontOffset) * (0.22 + depthStep * 0.06) / 2;
				if (halfDepth <= 0) continue;
				var depthCenter = front + halfDepth;
				for (sideStep in 0...7) {
					var sideCenter = sideStep == 0 ? 0.0 : minSide + spanWidth * (0.2 + (sideStep - 1) * 0.12);
					var halfWidth = spanWidth / 2;
					for (constraint in constraints) {
						var available = constraint.clearance + constraint.side * sideCenter
							+ constraint.depth * depthCenter - setback - Math.abs( constraint.depth ) * halfDepth;
						if (Math.abs( constraint.side ) > 0.000001)
							halfWidth = Math.min( halfWidth, available / Math.abs( constraint.side ) );
						else if (available < -0.000001) halfWidth = 0;
					}
					if (halfWidth <= 0) continue;
					var score = halfWidth * halfDepth / (refine ? 1 : (1 + frontOffset * 0.8));
					if (score > bestScore) {
						bestScore = score;
						bestSide = sideCenter;
						bestDepth = depthCenter;
						width = halfWidth;
						depth = halfDepth;
					}
				}
			}
		}
		var position = new Point( center.x + bestSide * axis.x + bestDepth * normal.x,
			center.y + bestSide * axis.y + bestDepth * normal.y );
		return new Polygon( [for (corner in [new Point( -1, -1 ), new Point( 1, -1 ), new Point( 1, 1 ), new Point( -1, 1 )])
			new Point( position.x + corner.x * width * axis.x + corner.y * depth * normal.x,
				position.y + corner.x * width * axis.y + corner.y * depth * normal.y )] );
	}
}