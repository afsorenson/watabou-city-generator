package com.watabou.towngenerator;

import com.watabou.utils.Random;

#if html5
import js.Browser;
import js.html.URLSearchParams;
#end

class StateManager {

	private static inline var SIZE = "size";
	private static inline var SEED = "seed";
	private static inline var WALLS = "walls";
	private static inline var BUILDINGS = "buildings";

	public static var size	: Int = 40;
	public static var seed	: Int = -1;
	public static var walls : Null<Bool> = null;
	public static var footprints : Bool = false;
	public static var blockFrontage : Bool = false;
	public static var roofed : Bool = false;
	public static var neighborhoodPrototype : Bool = false;
	public static var frontageGrowth : Bool = false;
	public static var diagnostic : Bool = false;

	public static function pullParams() {
		#if html5
		var params = new URLSearchParams( Browser.location.search );
		if (params != null) {
			var size1 = Std.parseInt( params.get( SIZE ) );
			if (size1 != null)size = (size1 >= 6 ? (size1 <= 40 ? size1: 40) : 6);

			var seed1 = Std.parseInt( params.get( SEED ) );
			if (seed1 != null) seed = (seed1 > 0 && seed1 < 2147483647 ? seed1 : -1);
			walls = switch (params.get( WALLS )) {
				case "1": true;
				case "0": false;
				default: null;
			};
			footprints = params.get( BUILDINGS ) == "footprints";
			blockFrontage = params.get( BUILDINGS ) == "frontage";
			roofed = params.get( "style" ) == "roofed";
			neighborhoodPrototype = blockFrontage && params.get( "layout" ) == "prototype";
			frontageGrowth = blockFrontage && params.get( "layout" ) == "frontage-growth";
			diagnostic = frontageGrowth && params.get( "style" ) == "diagnostic";
		}
		#end
	}

	public static function pushParams() {
		if (seed == -1) {
			Random.reset();
			seed = Random.getSeed();
		}

		#if html5
		var params = new URLSearchParams( Browser.location.search );
		params.set( SIZE, Std.string( size ) );
		params.set( SEED, Std.string( seed ) );
		if (walls == null) params.delete_( WALLS );
		else params.set( WALLS, walls ? "1" : "0" );
		if (blockFrontage) params.set( BUILDINGS, "frontage" );
		else if (footprints) params.set( BUILDINGS, "footprints" );
		else params.delete_( BUILDINGS );
		if (diagnostic) params.set( "style", "diagnostic" );
		else if (roofed) params.set( "style", "roofed" );
		else params.delete_( "style" );
		if (blockFrontage && frontageGrowth) params.set( "layout", "frontage-growth" );
		else if (blockFrontage && neighborhoodPrototype) params.set( "layout", "prototype" );
		else params.delete_( "layout" );
		var query:String = untyped params.toString();
		var url = Browser.location.pathname + "?" + query + Browser.location.hash;
		Browser.window.history.replaceState( {size: size, seed: seed, walls: walls}, getStateName(), url );
		#end
	}

	private static function getStateName():String {
		return if (size >= 6 && size < 10)
			"Small Town"
		else if (size >= 10 && size < 15)
			"Large Town"
		else if (size >= 15 && size <24)
			"Small City"
		else if (size >= 24 && size < 40)
			"Large City"
		else if (size >= 40)
			"Metropilis"
		else
			"Unknown state";
	}
}
