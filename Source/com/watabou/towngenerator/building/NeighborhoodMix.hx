package com.watabou.towngenerator.building;

import haxe.crypto.Md5;

typedef DistrictPolicy = {var index:Int; var label:String; var policy:String; var requested:String; var applied:String; var status:String; var score:Float;}

class NeighborhoodMix {
	public static function normalize( raw:String ):String {
		var policies = new Map<Int,String>();
		for (entry in raw.split( "," )) {
			var pair = entry.split( ":" );
			if (pair.length != 2 || !~/^[0-9]+$/.match( pair[0] )) continue;
			var index = Std.parseInt( pair[0] );
			if (index < 0 || index > 999 || (pair[1] != "grid" && pair[1] != "growth")) continue;
			policies[index] = pair[1];
		}
		var indices = [for (index in policies.keys()) index];
		indices.sort( function( first, second ) return first - second );
		return [for (index in indices) index + ":" + policies[index]].join( "," );
	}

	public static function score( seed:Int, district:Int ):Float {
		var hash = Md5.encode( seed + ":" + district + ":district-mix-v1" );
		return Std.parseInt( "0x" + hash.substr( 0, 7 ) ) / 268435456 * 100;
	}

	public static function eligible( model:Model, district:Int ):Bool {
		if (district < 0 || district >= model.frontageBlocks.length) return false;
		var block = model.frontageBlocks[district];
		return block.length >= 3 && block.square >= 12 && block.isConvex() && block.compactness >= 0.45;
	}

	public static function apply( model:Model, seed:Int, percent:Int, overrides:String ):Void {
		for (index in 0...model.frontageBlocks.length) {
			if (!eligible( model, index )) continue;
			var policy = policyFor( overrides, index );
			var value = score( seed, index );
			var growth = policy == "growth" || (policy == "auto" && value < percent);
			var applied = false;
			var status = "grid";
			if (growth) {
				try {
					applied = FrontageNeighborhood.apply( model, seed, index );
					status = applied ? "growth" : "fallback";
				} catch (error:Dynamic) status = "fallback";
			}
			model.districtPolicies.push( {index: index, label: model.patches[index].ward.getLabel(), policy: policy,
				requested: growth ? "growth" : "grid", applied: applied ? "growth" : "grid", status: status, score: value} );
		}
	}

	public static function policyFor( overrides:String, district:Int ):String {
		for (entry in overrides.split( "," )) {
			var pair = entry.split( ":" );
			if (pair.length == 2 && Std.parseInt( pair[0] ) == district && (pair[1] == "grid" || pair[1] == "growth")) return pair[1];
		}
		return "auto";
	}
}