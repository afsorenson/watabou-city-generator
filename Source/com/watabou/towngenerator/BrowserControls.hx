package com.watabou.towngenerator;

#if html5
import js.Browser;
import com.watabou.coogee.Game;
import com.watabou.towngenerator.building.Model;

class BrowserControls {

	public static function bind( exportPng:Void->Void ):Void {
		untyped Browser.window.cityGenerator = {
			size: StateManager.size,
			seed: StateManager.seed,
			walls: Model.instance.wall != null,
			exportPng: exportPng,
			generate: generate
		};
		Browser.document.dispatchEvent( new js.html.Event( "city-ready" ) );
	}

	private static function generate( size:Int, walls:Null<Bool>, newSeed:Bool ):Void {
		if (size < 6 || size > 40) return;
		StateManager.size = size;
		StateManager.walls = walls;
		if (newSeed) StateManager.seed = -1;
		StateManager.pushParams();
		new Model( StateManager.size, StateManager.seed, StateManager.walls );
		Game.switchScene( TownScene );
	}
}
#end