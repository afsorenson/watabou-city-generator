package com.watabou.towngenerator.building;

import openfl.geom.Point;
import com.watabou.geom.Polygon;
import com.watabou.towngenerator.wards.CommonWard;

typedef BuildableLand = Array<Array<Array<Array<Float>>>>;
typedef FrontageStreet = {var id:Int; var start:Point; var end:Point; var width:Float; var existing:Bool; var parent:Int; var connectsTo:Int;}
typedef FrontagePlot = {var polygon:Polygon; var building:Polygon; var street:Int; var frontage:Polygon;}

class FrontageNeighborhood {
	public var block:Polygon;
	public var exclusions:Array<Polygon>;
	public var remaining:BuildableLand;
	public var streets:Array<FrontageStreet> = [];
	public var lanes:Array<Polygon> = [];
	public var plots:Array<FrontagePlot> = [];
	public var events:Array<{kind:String, street:Int, count:Int}> = [];
	public var unservedDistance:Float = 0;
	private var lotArea:Float;
	private var seed:Int;
	private var transitions:DistrictTransitions;

	public function new( block:Polygon, sources:Array<Polygon>, lotArea:Float, seed:Int,
		transitions:DistrictTransitions=null, exclusions:Array<Polygon>=null ) {
		this.block = block;
		this.lotArea = lotArea;
		this.seed = seed;
		this.transitions = transitions;
		this.exclusions = exclusions == null ? [] : exclusions;
		remaining = land( block );
		for (excluded in this.exclusions) remaining = difference( remaining, land( excluded ) );
		for (source in sources) streets.push( {id: streets.length, start: source[0], end: source[1],
			width: 1.0, existing: true, parent: -1, connectsTo: -1} );
	}

	public function generate():Void {
		#if html5
		allocateAll();
		for (iteration in 0...18) {
			var target = deepest();
			if (target == null || unservedDistance < Math.sqrt( lotArea ) * 0.35) break;
			var connections = [for (street in streets) {street: street, point: project( target, street )}];
			connections.sort( function( first, second ) return Point.distance( target, first.point ) < Point.distance( target, second.point ) ? -1 : 1 );
			var connected = false;
			for (connection in connections) {
				if (Point.distance( connection.point, target ) < 1) continue;
				var opposite:Dynamic = null;
				var direction = connection.point.subtract( target );
				direction.normalize( 1 );
				for (candidate in connections) {
					if (candidate.street.id == connection.street.id || Point.distance( candidate.point, target ) < 1) continue;
					var other = candidate.point.subtract( target ); other.normalize( 1 );
					if (direction.x * other.x + direction.y * other.y < -0.35) { opposite = candidate; break; }
				}
				var width = StreetHierarchy.connector( Math.sqrt( lotArea ) * 0.9 );
				if (!routeAllowed( connection.point, target, width )) continue;
				if (opposite != null && !routeAllowed( target, opposite.point, width )) continue;
				var savedLand = remaining;
				var savedPlots = plots.copy();
				var savedStreets = streets.length;
				var savedLanes = lanes.length;
				var savedEvents = events.length;
				try {
					var firstId = addLane( connection.point, target, width, connection.street.id, -1 );
					if (opposite != null) addLane( target, opposite.point, width, firstId, opposite.street.id );
					allocateAll();
				} catch (error:Dynamic) {
					remaining = savedLand; plots = savedPlots;
					streets.splice( savedStreets, streets.length - savedStreets );
					lanes.splice( savedLanes, lanes.length - savedLanes );
					events.splice( savedEvents, events.length - savedEvents );
					continue;
				}
				connected = true;
				break;
			}
			if (!connected) break;
		}
		deepest();
		#end
	}

	private function allocateAll():Void {
		for (street in streets) {
			allocate( street, false );
			if (!street.existing) allocate( street, true );
		}
	}

	private function allocate( street:FrontageStreet, reverse:Bool ):Void {
		var start = reverse ? street.end : street.start;
		var end = reverse ? street.start : street.end;
		var axis = end.subtract( start );
		var length = axis.length;
		if (length < 1) return;
		axis.normalize( 1 );
		var cursor = 0.08;
		var index = 0;
		while (cursor < length - 0.8) {
			var local = new Point( start.x + axis.x * cursor, start.y + axis.y * cursor );
			var area = transitions == null ? lotArea : transitions.sample( local ).area;
			var variation = (seed ^ (street.id * 73856093) ^ (index * 19349663) ^ (reverse ? 83492791 : 0)) & 0x7fffffff;
			var width = Math.min( length - 0.08 - cursor, Math.max( 1.2, Math.sqrt( area ) * (0.75 + variation % 31 / 100) ) );
			var depth = Math.max( 1.5, Math.sqrt( area ) * (1.0 + ((variation >>> 5) % 31) / 100) );
			var front = street.existing ? 0.08 : street.width / 2 + 0.08;
			var candidate = quad( start, axis, cursor + 0.035, cursor + width - 0.035, front, front + depth );
			var available = intersection( remaining, land( candidate ) );
			for (part in polygons( available )) {
				if (part.square < area * 0.08 || !part.isConvex()) continue;
				var minFront = Math.POSITIVE_INFINITY;
				var maxFront = Math.NEGATIVE_INFINITY;
				for (point in part) {
					var offset = point.subtract( start );
					var distance = -offset.x * axis.y + offset.y * axis.x;
					if (Math.abs( distance - front ) < 0.00001) {
						var position = offset.x * axis.x + offset.y * axis.y;
						minFront = Math.min( minFront, position ); maxFront = Math.max( maxFront, position );
					}
				}
				if (maxFront - minFront < 0.65) continue;
				var buildings = BuildingFootprints.fromFrontagePlot( part, candidate, variation, true, axis );
				if (buildings.length != 1) continue;
				plots.push( {polygon: part, building: buildings[0], street: street.id,
					frontage: new Polygon( [world( start, axis, minFront, front ), world( start, axis, maxFront, front )] )} );
				remaining = difference( remaining, land( part ) );
				events.push( {kind: "plot", street: street.id, count: plots.length} );
			}
			cursor += width;
			index++;
		}
	}

	private function addLane( start:Point, end:Point, width:Float, parent:Int, connectsTo:Int ):Int {
		var axis = end.subtract( start ); var length = axis.length; axis.normalize( 1 );
		var lane = quad( start, axis, -width / 2, length + width / 2, -width / 2, width / 2 );
		var retained:Array<FrontagePlot> = [];
		var retired = 0;
		for (plot in plots) {
			if (areaOf( intersection( land( plot.polygon ), land( lane ) ) ) > 0.000001) {
				remaining = union( remaining, land( plot.polygon ) ); retired++;
			} else retained.push( plot );
		}
		plots = retained;
		lanes.push( lane );
		for (road in lanes) remaining = difference( remaining, land( road ) );
		for (excluded in exclusions) remaining = difference( remaining, land( excluded ) );
		var id = streets.length;
		streets.push( {id: id, start: start, end: end, width: width, existing: false, parent: parent, connectsTo: connectsTo} );
		events.push( {kind: "lane", street: id, count: retired} );
		return id;
	}

	private function routeAllowed( start:Point, end:Point, width:Float ):Bool {
		var axis = end.subtract( start ); var length = axis.length; axis.normalize( 1 );
		var lane = quad( start, axis, -width / 2, length + width / 2, -width / 2, width / 2 );
		for (excluded in exclusions) if (areaOf( intersection( land( lane ), land( excluded ) ) ) > 0.000001) return false;
		return true;
	}

	private function deepest():Point {
		#if html5
		var result:Point = null;
		unservedDistance = 0;
		for (part in remaining) {
			if (areaOf( [part] ) < lotArea * 0.3) continue;
			var label:Array<Float> = untyped js.Browser.window.cityPolylabel( part, 0.15 );
			var distance:Float = untyped label.distance;
			if (distance > unservedDistance) { unservedDistance = distance; result = new Point( label[0], label[1] ); }
		}
		return result;
		#else
		return null;
		#end
	}

	public static function apply( model:Model, seed:Int ):Void {
		var chosen = -1;
		var largest = 0.0;
		for (index in 0...model.frontageBlocks.length) {
			var block = model.frontageBlocks[index];
			if (block.length < 3 || !block.isConvex() || block.compactness < 0.45) continue;
			if (block.square > largest) { largest = block.square; chosen = index; }
		}
		if (chosen < 0) return;
		var patch = model.patches[chosen];
		var block = model.frontageBlocks[chosen];
		var sources:Array<Polygon> = [];
		block.forEdge( function( start, end ) {
			var midpoint = Point.interpolate( start, end, 0.5 );
			var direction = end.subtract( start ); direction.normalize( 1 );
			var eligible = false;
			patch.shape.forEdge( function( outerStart, outerEnd ) {
				if (model.wall != null && model.wall.bordersBy( patch, outerStart, outerEnd )) return;
				var outer = outerEnd.subtract( outerStart ); var length = outer.length; outer.normalize( 1 );
				if (direction.x * outer.x + direction.y * outer.y < 0.95) return;
				var distance = Math.abs( outer.x * (midpoint.y - outerStart.y) - outer.y * (midpoint.x - outerStart.x) );
				if (distance > 2.1) return;
				for (street in model.arteries) if (street.contains( outerStart ) && street.contains( outerEnd )) eligible = true;
				for (neighbor in model.getNeighbours( patch ))
					if (neighbor.withinCity && neighbor.shape.findEdge( outerEnd, outerStart ) >= 0) eligible = true;
			} );
			if (eligible) sources.push( new Polygon( [start, end] ) );
		} );
		if (sources.length == 0) return;
		var ward:CommonWard = cast patch.ward;
		var generated = new FrontageNeighborhood( block, sources, ward.getFrontageLotArea(), seed, model.frontageTransitions[chosen] );
		generated.generate();
		model.frontageGrowthData = generated;
		var oldArea = 0.0;
		for (building in patch.ward.geometry) oldArea += Math.abs( building.square );
		var newArea = 0.0;
		for (plot in generated.plots) newArea += Math.abs( plot.building.square );
		model.prototypeAttempt = {patchIndex: chosen, previousArea: oldArea, candidateArea: newArea};
		if (generated.plots.length < 8 || generated.lanes.length == 0 || newArea < oldArea * 0.8 || newArea > oldArea * 1.15) return;
		patch.ward.geometry = [for (plot in generated.plots) plot.building];
		model.frontagePlots[chosen] = [for (plot in generated.plots) plot.polygon];
		model.frontageLanes[chosen] = generated.lanes;
		model.frontageAccess[chosen] = generated.lanes[0];
		var streets = generated.streets.filter( function( street ) return !street.existing );
		model.frontageLanePaths[chosen] = [for (street in streets) new Polygon( [street.start, street.end] )];
		model.frontageLaneKinds[chosen] = [for (street in streets) "grown-lane"];
		model.frontageLaneWidths[chosen] = [for (street in streets) street.width];
		model.frontageGroupIds[chosen] = [for (plot in generated.plots) -1];
		model.frontageGroupPassages[chosen] = [];
		model.frontageCourtyards[chosen] = new Polygon();
		model.prototypePatchIndex = chosen;
		model.prototypeRegions = [];
	}

	private static function project( point:Point, street:FrontageStreet ):Point {
		var direction = street.end.subtract( street.start );
		var squared = direction.x * direction.x + direction.y * direction.y;
		var ratio = Math.max( 0, Math.min( 1, ((point.x - street.start.x) * direction.x + (point.y - street.start.y) * direction.y) / squared ) );
		return new Point( street.start.x + direction.x * ratio, street.start.y + direction.y * ratio );
	}
	private static function land( polygon:Polygon ):BuildableLand return [[[for (point in polygon) [point.x, point.y]]]];
	private static function normalized( source:BuildableLand ):BuildableLand return [for (part in source)
		[for (ring in part) [for (point in ring) [Math.fround( point[0] * 1000000 ) / 1000000, Math.fround( point[1] * 1000000 ) / 1000000]]]];
	private static function intersection( first:BuildableLand, second:BuildableLand ):BuildableLand
		return normalized( untyped js.Browser.window.polygonClipping.intersection( normalized( first ), normalized( second ) ) );
	private static function difference( first:BuildableLand, second:BuildableLand ):BuildableLand
		return normalized( untyped js.Browser.window.polygonClipping.difference( normalized( first ), normalized( second ) ) );
	private static function union( first:BuildableLand, second:BuildableLand ):BuildableLand
		return normalized( untyped js.Browser.window.polygonClipping.union( normalized( first ), normalized( second ) ) );
	private static function areaOf( land:BuildableLand ):Float {
		var area = 0.0;
		for (part in land) for (index in 0...part.length) {
			var ring = part[index];
			var polygon = new Polygon( [for (point in ring.slice( 0, ring.length - 1 )) new Point( point[0], point[1] )] );
			area += (index == 0 ? 1 : -1) * Math.abs( polygon.square );
		}
		return area;
	}
	private static function polygons( land:BuildableLand ):Array<Polygon> {
		var result:Array<Polygon> = [];
		for (part in land) {
			if (part.length != 1) continue;
			var points = part[0];
			var polygon = new Polygon( [for (point in points.slice( 0, points.length - 1 )) new Point( point[0], point[1] )] );
			if (polygon.length < 3 || Math.abs( polygon.square ) < 0.05) continue;
			if (polygon.square < 0) polygon.reverse();
			result.push( polygon );
		}
		return result;
	}
	private static function world( origin:Point, axis:Point, side:Float, depth:Float ):Point return new Point(
		origin.x + side * axis.x - depth * axis.y, origin.y + side * axis.y + depth * axis.x );
	private static function quad( origin:Point, axis:Point, left:Float, right:Float, front:Float, back:Float ):Polygon return new Polygon( [
		world( origin, axis, left, front ), world( origin, axis, right, front ), world( origin, axis, right, back ), world( origin, axis, left, back )] );
}