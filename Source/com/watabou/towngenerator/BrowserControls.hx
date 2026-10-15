package com.watabou.towngenerator;

#if html5
import js.Browser;
import com.watabou.coogee.Game;
import com.watabou.towngenerator.building.Model;

class BrowserControls {

	public static function bind( exportPng:Void->Void ):Void {
		untyped Browser.window.cityGenerator = {
			buildId: BuildInfo.identifier(),
			size: StateManager.size,
			seed: StateManager.seed,
			walls: Model.instance.wall != null,
			footprints: StateManager.footprints,
			blockFrontage: StateManager.blockFrontage,
			exportPng: exportPng,
			restoreSeed: restoreSeed,
			generate: generate
		};
		Browser.document.dispatchEvent( new js.html.Event( "city-ready" ) );
	}

	private static function restoreSeed( seed:Int ):Void {
		if (seed < 1 || seed > 2147483646 || seed != Math.floor( seed )) return;
		StateManager.seed = seed;
		generate( StateManager.size, StateManager.walls, false, StateManager.footprints, StateManager.blockFrontage );
	}

	private static function generate( size:Int, walls:Null<Bool>, newSeed:Bool, footprintMode:Bool, blockFrontageMode=false ):Void {
		if (size < 6 || size > 40) return;
		StateManager.size = size;
		StateManager.walls = walls;
		StateManager.footprints = footprintMode;
		StateManager.blockFrontage = blockFrontageMode;
		if (newSeed) StateManager.seed = -1;
		StateManager.pushParams();
		new Model( StateManager.size, StateManager.seed, StateManager.walls, StateManager.footprints, StateManager.blockFrontage );
		Game.switchScene( TownScene );
	}
}
#end