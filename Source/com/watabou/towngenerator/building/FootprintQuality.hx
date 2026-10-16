package com.watabou.towngenerator.building;

import openfl.geom.Point;
import com.watabou.geom.Polygon;
import com.watabou.towngenerator.wards.CommonWard;
import com.watabou.towngenerator.wards.MilitaryWard;

class FootprintQuality {

	public static function reason( polygon:Polygon ):String {
		if (polygon.length < 3) return "degenerate";
		var axis = new Point( 1, 0 );
		var longest = 0.0;
		polygon.forEdge( function( start, end ) {
			var edge = end.subtract( start );
			if (edge.length > longest) { longest = edge.length; axis = edge; }
		} );
		if (longest < 0.00001 || Math.abs( polygon.square ) < 0.01) return "degenerate";
		axis.normalize( 1 );
		var minSide = Math.POSITIVE_INFINITY;
		var maxSide = Math.NEGATIVE_INFINITY;
		var minDepth = Math.POSITIVE_INFINITY;
		var maxDepth = Math.NEGATIVE_INFINITY;
		for (point in polygon) {
			var side = point.x * axis.x + point.y * axis.y;
			var depth = -point.x * axis.y + point.y * axis.x;
			minSide = Math.min( minSide, side ); maxSide = Math.max( maxSide, side );
			minDepth = Math.min( minDepth, depth ); maxDepth = Math.max( maxDepth, depth );
		}
		var width = maxSide - minSide;
		var depth = maxDepth - minDepth;
		if (Math.min( width, depth ) < 0.08) return "sliver";
		if (Math.max( width, depth ) / Math.min( width, depth ) > 14) return "needle";
		if (polygon.length == 3) return "taper";
		for (index in 0...polygon.length) {
			var point = polygon[index];
			var incoming = polygon[(index + polygon.length - 1) % polygon.length].subtract( point );
			var outgoing = polygon[(index + 1) % polygon.length].subtract( point );
			if (incoming.length < 0.00001 || outgoing.length < 0.00001) continue;
			var turn = incoming.x * outgoing.y - incoming.y * outgoing.x;
			if (turn >= 0) continue;
			var cosine = (incoming.x * outgoing.x + incoming.y * outgoing.y) / (incoming.length * outgoing.length);
			if (cosine > Math.cos( Math.PI * 22 / 180 )) return "acute-corner";
		}
		return null;
	}

	public static function apply( model:Model ):Void {
		model.footprintQualityOriginals = [for (patch in model.patches) patch.ward.geometry];
		model.footprintQualitySources = [for (patch in model.patches) [for (index in 0...patch.ward.geometry.length) index]];
		for (patchIndex in 0...model.patches.length) {
			var patch = model.patches[patchIndex];
			if (!Std.is( patch.ward, CommonWard ) && !Std.is( patch.ward, MilitaryWard )) continue;
			if (patchIndex < model.frontageBlocks.length && model.frontageBlocks[patchIndex].length > 0) continue;
			var original = model.footprintQualityOriginals[patchIndex];
			var buildings:Array<Polygon> = [];
			var sources:Array<Int> = [];
			for (index in 0...original.length) {
				var polygon = original[index];
				var issue = reason( polygon );
				var replacements = issue == null ? [polygon] : BuildingFootprints.repairOutlier( polygon );
				if (issue != null) model.footprintQualityChanges.push( {patchIndex: patchIndex, sourceIndex: index,
					reason: issue, before: polygon, after: replacements} );
				for (replacement in replacements) { buildings.push( replacement ); sources.push( index ); }
			}
			patch.ward.geometry = buildings;
			model.footprintQualitySources[patchIndex] = sources;
		}
	}
}