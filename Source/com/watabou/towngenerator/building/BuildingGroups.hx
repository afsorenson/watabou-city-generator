package com.watabou.towngenerator.building;

import openfl.geom.Point;
import com.watabou.geom.Polygon;

typedef GroupPlotBounds = {
	var left:Float;
	var right:Float;
	var front:Float;
	var back:Float;
}

class BuildingGroups {

	public static function apply( buildings:Array<Polygon>, plots:Array<Polygon>, groups:Array<Int>, passages:Array<Polygon>,
		rowStart:Int, center:Point, axis:Point, cell:Polygon, block:Polygon, courtyard:Polygon, seed:Int ):Void {
		#if html5
		var cursor = rowStart;
		while (cursor < buildings.length - 1) {
			var variation = (seed ^ (cursor * 73856093)) & 0x7fffffff;
			if (variation % 5 == 0) {
				cursor++;
				continue;
			}
			var count = Std.int( Math.min( 2 + ((variation >>> 4) % 4), buildings.length - cursor ) );
			var bounds:Array<GroupPlotBounds> = [];
			for (index in 0...count) {
				var candidate = plotBounds( plots[cursor + index], center, axis );
				if (candidate == null) break;
				if (bounds.length > 0) {
					var previous = bounds[bounds.length - 1];
					var gap = candidate.left - previous.right;
					if (gap < -0.00001 || gap > 0.15) break;
				}
				bounds.push( candidate );
			}
			if (bounds.length < 2) {
				cursor++;
				continue;
			}
			count = bounds.length;
			var front = Math.NEGATIVE_INFINITY;
			var minimumBack = Math.POSITIVE_INFINITY;
			for (bound in bounds) {
				front = Math.max( front, bound.front );
				minimumBack = Math.min( minimumBack, bound.back );
			}
			front += 0.12;
			if (minimumBack - front < 0.8) {
				cursor++;
				continue;
			}
			var sharedBack = front + (minimumBack - front) * 0.76;
			var endGap = Math.min( 0.45, Math.max( 0.18, (bounds[0].right - bounds[0].left) * 0.1 ) );
			var replacements:Array<Polygon> = [];
			var owners:Array<Polygon> = [];
			var oldArea = 0.0;
			var newArea = 0.0;
			var valid = true;
			for (index in 0...count) {
				var bound = bounds[index];
				var left = index == 0 ? bound.left + endGap : (bounds[index - 1].right + bound.left) / 2;
				var right = index == count - 1 ? bound.right - endGap : (bound.right + bounds[index + 1].left) / 2;
				var detail = (variation ^ (index * 19349663)) & 0x7fffffff;
				var back = front + (bound.back - front) * (0.86 + (detail % 12) / 100);
				var shoulder = (right - left) * (0.12 + ((detail >>> 4) % 7) / 100);
				var outline = right - left < 1 || back - sharedBack < 0.35 ? [
					new Point( left, front ), new Point( right, front ), new Point( right, sharedBack ), new Point( left, sharedBack )
				] : [
					new Point( left, front ), new Point( right, front ), new Point( right, sharedBack ),
					new Point( right - shoulder, sharedBack ), new Point( right - shoulder, back ),
					new Point( left + shoulder, back ), new Point( left + shoulder, sharedBack ), new Point( left, sharedBack )
				];
				var building = toWorld( new Polygon( outline ), center, axis );
				var owner = toWorld( new Polygon( [new Point( left, bound.front ), new Point( right, bound.front ),
					new Point( right, bound.back ), new Point( left, bound.back )] ), center, axis );
				if (building.square < 0.3 || !inside( building, cell, block, courtyard )) valid = false;
				replacements.push( building );
				owners.push( owner );
				oldArea += buildings[cursor + index].square;
				newArea += building.square;
			}
			if (!valid || newArea < oldArea * 0.97 || newArea > oldArea * 1.08) {
				cursor++;
				continue;
			}
			for (index in 0...count) {
				buildings[cursor + index] = replacements[index];
				plots[cursor + index] = owners[index];
				groups[cursor + index] = cursor;
			}
			for (end in [bounds[0], bounds[count - 1]]) {
				var left = end == bounds[0] ? end.left : end.right - endGap;
				passages.push( toWorld( new Polygon( [new Point( left, end.front ), new Point( left + endGap, end.front ),
					new Point( left + endGap, end.back ), new Point( left, end.back )] ), center, axis ) );
			}
			cursor += count + 1;
		}
		#end
	}

	private static function plotBounds( polygon:Polygon, center:Point, axis:Point ):GroupPlotBounds {
		if (polygon.length != 4) return null;
		var local = [for (point in polygon) new Point( (point.x - center.x) * axis.x + (point.y - center.y) * axis.y,
			-(point.x - center.x) * axis.y + (point.y - center.y) * axis.x )];
		var result = {left: Math.POSITIVE_INFINITY, right: Math.NEGATIVE_INFINITY,
			front: Math.POSITIVE_INFINITY, back: Math.NEGATIVE_INFINITY};
		for (index in 0...local.length) {
			var point = local[index];
			var next = local[(index + 1) % local.length];
			if (Math.abs( point.x - next.x ) > 0.00001 && Math.abs( point.y - next.y ) > 0.00001) return null;
			result.left = Math.min( result.left, point.x );
			result.right = Math.max( result.right, point.x );
			result.front = Math.min( result.front, point.y );
			result.back = Math.max( result.back, point.y );
		}
		return result;
	}

	private static function inside( building:Polygon, cell:Polygon, block:Polygon, courtyard:Polygon ):Bool {
		#if html5
		var rings = function( polygon:Polygon ) return [for (point in polygon) [point.x, point.y]];
		var allowed:Dynamic = untyped js.Browser.window.polygonClipping.intersection( [rings( cell )], [rings( block )] );
		if (courtyard.length > 0) allowed = untyped js.Browser.window.polygonClipping.difference( allowed, [rings( courtyard )] );
		var outside:Array<Array<Array<Array<Float>>>> = untyped js.Browser.window.polygonClipping.difference( [rings( building )], allowed );
		var area = 0.0;
		for (polygon in outside) {
			var outline = polygon[0];
			var piece = new Polygon( [for (point in outline.slice( 0, outline.length - 1 )) new Point( point[0], point[1] )] );
			area += Math.abs( piece.square );
		}
		return area < Math.abs( block.square ) * 0.0000001;
		#else
		return false;
		#end
	}

	private static function toWorld( polygon:Polygon, center:Point, axis:Point ):Polygon {
		return new Polygon( [for (point in polygon) new Point( center.x + point.x * axis.x - point.y * axis.y,
			center.y + point.x * axis.y + point.y * axis.x )] );
	}
}