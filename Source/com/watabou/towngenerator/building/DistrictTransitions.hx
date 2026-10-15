package com.watabou.towngenerator.building;

import openfl.geom.Point;
import com.watabou.towngenerator.wards.CommonWard;

typedef DistrictBorder = {
	var start:Point;
	var end:Point;
	var neighborArea:Float;
	var neighborIndex:Int;
}

class DistrictTransitions {

	public var baseArea:Float;
	public var range:Float;
	public var borders:Array<DistrictBorder> = [];

	public function new( model:Model, patch:Patch ) {
		var ward:CommonWard = cast patch.ward;
		baseArea = ward.getFrontageLotArea();
		range = Math.sqrt( baseArea ) * 2.5;
		for (neighbor in model.getNeighbours( patch )) {
			if (!neighbor.withinCity || !Std.is( neighbor.ward, CommonWard )) continue;
			if (model.wall != null && neighbor.withinWalls != patch.withinWalls) continue;
			var neighborWard:CommonWard = cast neighbor.ward;
			patch.shape.forEdge( function( start, end ) {
				if (neighbor.shape.findEdge( end, start ) == -1) return;
				borders.push( {start: start, end: end, neighborArea: neighborWard.getFrontageLotArea(),
					neighborIndex: model.patches.indexOf( neighbor )} );
			} );
		}
	}

	public function sample( point:Point ):{area:Float, influence:Float, border:Int} {
		var nearest = Math.POSITIVE_INFINITY;
		var borderIndex = -1;
		for (index in 0...borders.length) {
			var border = borders[index];
			var direction = border.end.subtract( border.start );
			var lengthSquared = direction.x * direction.x + direction.y * direction.y;
			if (lengthSquared < 0.000001) continue;
			var projection = ((point.x - border.start.x) * direction.x + (point.y - border.start.y) * direction.y) / lengthSquared;
			projection = Math.max( 0, Math.min( 1, projection ) );
			var distance = Point.distance( point, new Point( border.start.x + projection * direction.x,
				border.start.y + projection * direction.y ) );
			if (distance < nearest) {
				nearest = distance;
				borderIndex = index;
			}
		}
		var influence = Math.max( 0, 1 - nearest / range );
		var area = borderIndex < 0 ? baseArea : baseArea * Math.pow( borders[borderIndex].neighborArea / baseArea, influence * 0.5 );
		return {area: area, influence: influence, border: borderIndex};
	}

	public function alignmentAt( point:Point ):Point {
		var transition = sample( point );
		if (transition.border < 0 || transition.influence < 0.6) return null;
		var border = borders[transition.border];
		var direction = border.end.subtract( border.start );
		direction.normalize( 1 );
		return direction;
	}
}