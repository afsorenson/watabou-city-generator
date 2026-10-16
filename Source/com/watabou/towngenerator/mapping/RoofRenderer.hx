package com.watabou.towngenerator.mapping;

import openfl.display.Graphics;
import openfl.display.Shape;
import openfl.display.Sprite;
import openfl.geom.Point;
import com.watabou.geom.Polygon;

using com.watabou.utils.GraphicsExtender;

typedef RoofFace = { var polygon:Polygon; var light:Bool; @:optional var color:Int; }
typedef RoofPlan = { var faces:Array<RoofFace>; var ridges:Array<Polygon>; var sections:Array<Polygon>; var kind:String; }

class RoofRenderer {
	private var shadows:Graphics;
	private var detailLayer:Sprite;
	private var details:Array<{shape:Shape, span:Float, threshold:Float}> = [];

	public function new( shadows:Graphics, detailLayer:Sprite ) {
		this.shadows = shadows;
		this.detailLayer = detailLayer;
	}

	public function draw( graphics:Graphics, footprint:Polygon, variation:Int ):Void {
		if (footprint.length < 3 || Math.abs( footprint.square ) < 0.01) return;
		var roof = plan( footprint );
		var height = Math.min( 0.55, Math.max( 0.18, Math.sqrt( Math.abs( footprint.square ) ) * 0.065 ) );
		shadows.lineStyle();
		shadows.beginFill( 0x444444, 0.17 );
		shadows.drawPolygon( [for (point in footprint) new Point( point.x + height * 0.7, point.y + height )] );
		shadows.endFill();
		graphics.lineStyle( 0.32, 0xd3d3d3 );
		graphics.beginFill( 0xaaaaaa );
		graphics.drawPolygon( footprint );
		graphics.endFill();
		graphics.lineStyle();
		for (face in roof.faces) {
			graphics.beginFill( face.color != null ? face.color : (face.light ? 0xc2c2c2 : 0x969696) );
			graphics.drawPolygon( face.polygon );
			graphics.endFill();
		}
		graphics.lineStyle( 0.16, 0x555555 );
		graphics.drawPolygon( footprint );
		graphics.lineStyle();
		var span = Math.sqrt( Math.abs( footprint.square ) );
		var ridges = new Shape();
		ridges.graphics.lineStyle( 0.09, 0x666666, 0.8 );
		for (ridge in roof.ridges) ridges.graphics.drawPolyline( ridge );
		detailLayer.addChild( ridges );
		details.push( {shape: ridges, span: span, threshold: 8.0} );
		if ((variation & 0x7fffffff) % 13 == 0 && roof.sections.length > 0) {
			var section = roof.sections[0];
			if (section.length == 4 && Math.abs( section.square ) > 10 && section.isConvex()) {
				var center = section.centroid;
				var clearance = Math.POSITIVE_INFINITY;
				section.forEdge( function( start, end ) {
					var edge = end.subtract( start );
					clearance = Math.min( clearance, Math.abs( edge.x * (center.y - start.y) - edge.y * (center.x - start.x) ) / edge.length );
				} );
				if (clearance < 0.3) return;
				var chimney = new Shape();
				chimney.graphics.lineStyle( 0.08, 0x555555 );
				chimney.graphics.beginFill( 0x777777 );
				chimney.graphics.drawRect( center.x - 0.16, center.y - 0.16, 0.32, 0.32 );
				chimney.graphics.endFill();
				detailLayer.addChild( chimney );
				details.push( {shape: chimney, span: span, threshold: 16.0} );
			}
		}
	}

	public function setScale( pixelsPerUnit:Float ):Void {
		for (detail in details) detail.shape.visible = detail.span * pixelsPerUnit >= detail.threshold;
	}

	public static function plan( footprint:Polygon ):RoofPlan {
		var axis = new Point( 1, 0 );
		var longest = 0.0;
		footprint.forEdge( function( start, end ) {
			var edge = end.subtract( start );
			if (edge.length > longest) { longest = edge.length; axis = edge; }
		} );
		axis.normalize( 1 );
		var origin = footprint[0];
		var local = new Polygon( [for (point in footprint) new Point(
			(point.x - origin.x) * axis.x + (point.y - origin.y) * axis.y,
			-(point.x - origin.x) * axis.y + (point.y - origin.y) * axis.x )] );
		var orthogonal = true;
		local.forEdge( function( start, end ) {
			if (Math.abs( start.x - end.x ) > 0.00001 && Math.abs( start.y - end.y ) > 0.00001) orthogonal = false;
		} );
		if (!orthogonal) {
			var cleaned = clean( footprint );
			if (cleaned.length >= 3 && cleaned.isConvex()) {
				try {
					var roof = hipped( cleaned );
					var area = 0.0;
					for (face in roof.faces) area += Math.abs( face.polygon.square );
					if (roof.faces.length >= 3 && Math.abs( area - cleaned.square ) < cleaned.square * 0.00001) return roof;
				} catch (error:Dynamic) {}
			}
			return {faces: [{polygon: footprint, light: true, color: 0xaaaaaa}], ridges: [], sections: [], kind: "restrained"};
		}
		var pieces:Array<Polygon> = [];
		if (orthogonal) {
			var cuts = [for (point in local) point.x];
			cuts.sort( compare );
			var unique:Array<Float> = [];
			for (cut in cuts) if (unique.length == 0 || cut - unique[unique.length - 1] > 0.00001) unique.push( cut );
			var rectangles:Array<{left:Float, right:Float, front:Float, back:Float}> = [];
			for (index in 1...unique.length) {
				var left = unique[index - 1];
				var right = unique[index];
				var crossings = crossSection( local, (left + right) / 2, true );
				var crossing = 0;
				while (crossing + 1 < crossings.length) {
					var front = crossings[crossing++];
					var back = crossings[crossing++];
					var merged = false;
					for (rectangle in rectangles) {
						if (Math.abs( rectangle.right - left ) < 0.00001 && Math.abs( rectangle.front - front ) < 0.00001
							&& Math.abs( rectangle.back - back ) < 0.00001) { rectangle.right = right; merged = true; break; }
					}
					if (!merged) rectangles.push( {left: left, right: right, front: front, back: back} );
				}
			}
			for (rectangle in rectangles) pieces.push( rectanglePolygon( rectangle.left, rectangle.right, rectangle.front, rectangle.back ) );
		}
		var result:RoofPlan = {faces: [], ridges: [], sections: [], kind: "sectioned"};
		for (piece in pieces) {
			var minX = Math.POSITIVE_INFINITY;
			var minY = Math.POSITIVE_INFINITY;
			var maxX = Math.NEGATIVE_INFINITY;
			var maxY = Math.NEGATIVE_INFINITY;
			for (point in piece) {
				minX = Math.min( minX, point.x ); maxX = Math.max( maxX, point.x );
				minY = Math.min( minY, point.y ); maxY = Math.max( maxY, point.y );
			}
			var vertical = maxY - minY > maxX - minX;
			var middle = vertical ? (minX + maxX) / 2 : (minY + maxY) / 2;
			var first = vertical ? rectanglePolygon( minX - 1, middle, minY - 1, maxY + 1 ) : rectanglePolygon( minX - 1, maxX + 1, minY - 1, middle );
			var second = vertical ? rectanglePolygon( middle, maxX + 1, minY - 1, maxY + 1 ) : rectanglePolygon( minX - 1, maxX + 1, middle, maxY + 1 );
			var lightFirst = vertical ? axis.x * 0.6 + axis.y * 0.8 > 0 : -axis.y * 0.6 + axis.x * 0.8 > 0;
			for (half in 0...2) {
				for (face in intersect( piece, half == 0 ? first : second ))
					result.faces.push( {polygon: world( face, origin, axis ), light: half == 0 ? lightFirst : !lightFirst} );
			}
			var crossings = crossSection( piece, middle, vertical );
			var crossing = 0;
			while (crossing + 1 < crossings.length) {
				var start = crossings[crossing++];
				var end = crossings[crossing++];
				result.ridges.push( world( new Polygon( vertical ? [new Point( middle, start ), new Point( middle, end )] :
					[new Point( start, middle ), new Point( end, middle )] ), origin, axis ) );
			}
			result.sections.push( world( piece, origin, axis ) );
		}
		return result;
	}

	private static function clean( footprint:Polygon ):Polygon {
		var vertices = footprint.copy();
		var changed = true;
		while (changed && vertices.length > 3) {
			changed = false;
			for (index in 0...vertices.length) {
				var previous = vertices[(index + vertices.length - 1) % vertices.length];
				var point = vertices[index];
				var next = vertices[(index + 1) % vertices.length];
				var incoming = point.subtract( previous );
				var outgoing = next.subtract( point );
				if (incoming.length < 0.000001 || outgoing.length < 0.000001
					|| Math.abs( incoming.x * outgoing.y - incoming.y * outgoing.x ) < incoming.length * outgoing.length * 0.00000001) {
					vertices.splice( index, 1 );
					changed = true;
					break;
				}
			}
		}
		var result = new Polygon( vertices );
		if (result.square < 0) result.reverse();
		return result;
	}

	private static function hipped( footprint:Polygon ):RoofPlan {
		var planes = [for (index in 0...footprint.length) {
			var start = footprint[index];
			var edge = footprint[(index + 1) % footprint.length].subtract( start );
			var normal = new Point( -edge.y / edge.length, edge.x / edge.length );
			{normal: normal, bias: -normal.x * start.x - normal.y * start.y};
		}];
		var result:RoofPlan = {faces: [], ridges: [], sections: [footprint], kind: "hipped"};
		var ridgeKeys = new Map<String,Bool>();
		for (index in 0...planes.length) {
			var owner = planes[index];
			var faces = [footprint];
			for (otherIndex in 0...planes.length) {
				if (index == otherIndex) continue;
				var other = planes[otherIndex];
				var clipped:Array<Polygon> = [];
				for (face in faces) clipped = clipped.concat( halfPlane( face,
					other.normal.x - owner.normal.x, other.normal.y - owner.normal.y, other.bias - owner.bias ) );
				faces = clipped;
				if (faces.length == 0) break;
			}
			var illumination = owner.normal.x * 0.6 + owner.normal.y * 0.8;
			var tone = Math.round( 171 + illumination * 33 );
			for (face in faces) {
				if (Math.abs( face.square ) < 0.000001) continue;
				result.faces.push( {polygon: face, light: illumination >= 0, color: (tone << 16) | (tone << 8) | tone} );
				face.forEdge( function( start, end ) {
					if (Point.distance( start, end ) < 0.00001) return;
					var boundary = false;
					for (plane in planes) {
						var first = plane.normal.x * start.x + plane.normal.y * start.y + plane.bias;
						var second = plane.normal.x * end.x + plane.normal.y * end.y + plane.bias;
						if (Math.abs( first ) < 0.000001 && Math.abs( second ) < 0.000001) boundary = true;
					}
					if (boundary) return;
					var firstKey = Math.round( start.x * 1000000 ) + ":" + Math.round( start.y * 1000000 );
					var secondKey = Math.round( end.x * 1000000 ) + ":" + Math.round( end.y * 1000000 );
					var key = firstKey < secondKey ? firstKey + "/" + secondKey : secondKey + "/" + firstKey;
					if (!ridgeKeys.exists( key )) { ridgeKeys.set( key, true ); result.ridges.push( new Polygon( [start, end] ) ); }
				} );
			}
		}
		return result;
	}

	private static function halfPlane( polygon:Polygon, normalX:Float, normalY:Float, bias:Float ):Array<Polygon> {
		var minimum = Math.POSITIVE_INFINITY;
		var maximum = Math.NEGATIVE_INFINITY;
		for (point in polygon) {
			var value = normalX * point.x + normalY * point.y + bias;
			minimum = Math.min( minimum, value ); maximum = Math.max( maximum, value );
		}
		if (minimum >= -0.00000001) return [polygon];
		if (maximum <= 0.00000001) return [];
		var length = Math.sqrt( normalX * normalX + normalY * normalY );
		if (length < 0.00000001) return bias >= 0 ? [polygon] : [];
		var normal = new Point( normalX / length, normalY / length );
		var center = polygon.centroid;
		var distance = (normalX * center.x + normalY * center.y + bias) / length;
		var origin = new Point( center.x - normal.x * distance, center.y - normal.y * distance );
		var radius = 1.0;
		for (point in polygon) radius = Math.max( radius, Point.distance( origin, point ) + 1 );
		var tangent = new Point( -normal.y * radius, normal.x * radius );
		var inward = new Point( normal.x * radius, normal.y * radius );
		var normalize = function( shape:Polygon ):Polygon return new Polygon( [for (point in shape) new Point(
			Math.fround( point.x * 10000000 ) / 10000000, Math.fround( point.y * 10000000 ) / 10000000 )] );
		return [for (part in intersect( normalize( polygon ), normalize( new Polygon( [origin.subtract( tangent ), origin.add( tangent ),
			origin.add( tangent ).add( inward ), origin.subtract( tangent ).add( inward )] ) ) )) normalize( part )];
	}

	private static function intersect( polygon:Polygon, clip:Polygon ):Array<Polygon> {
		#if html5
		var parts:Array<Array<Array<Array<Float>>>> = untyped js.Browser.window.polygonClipping.intersection(
			[[for (point in polygon) [point.x, point.y]]], [[for (point in clip) [point.x, point.y]]] );
		return [for (part in parts) if (part.length == 1) new Polygon(
			[for (point in part[0].slice( 0, part[0].length - 1 )) new Point( point[0], point[1] )] )];
		#else
		return [polygon];
		#end
	}

	private static function crossSection( polygon:Polygon, coordinate:Float, vertical:Bool ):Array<Float> {
		var crossings:Array<Float> = [];
		polygon.forEdge( function( start, end ) {
			var first = vertical ? start.x : start.y;
			var second = vertical ? end.x : end.y;
			if ((first <= coordinate && second > coordinate) || (second <= coordinate && first > coordinate)) {
				var ratio = (coordinate - first) / (second - first);
				crossings.push( vertical ? start.y + ratio * (end.y - start.y) : start.x + ratio * (end.x - start.x) );
			}
		} );
		crossings.sort( compare );
		return crossings;
	}

	private static function compare( first:Float, second:Float ):Int return first < second ? -1 : (first > second ? 1 : 0);
	private static function rectanglePolygon( left:Float, right:Float, front:Float, back:Float ):Polygon {
		return new Polygon( [new Point( left, front ), new Point( right, front ), new Point( right, back ), new Point( left, back )] );
	}
	private static function world( polygon:Polygon, origin:Point, axis:Point ):Polygon {
		return new Polygon( [for (point in polygon) new Point( origin.x + point.x * axis.x - point.y * axis.y,
			origin.y + point.x * axis.y + point.y * axis.x )] );
	}
}