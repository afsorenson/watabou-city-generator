package com.watabou.towngenerator;

#if html5
import js.Browser;
import openfl.geom.Rectangle;
import com.watabou.coogee.Game;
import com.watabou.towngenerator.building.Model;

class BrowserControls {

	public static function bind( exportPng:Void->Void, bounds:Rectangle=null ):Void {
		var prototypeCrop:Dynamic = null;
		if (Model.instance.prototypePatchIndex >= 0 && bounds != null) {
			var center = Model.instance.frontageBlocks[Model.instance.prototypePatchIndex].centroid;
			var scale = 1920 / Math.max( bounds.width, bounds.height );
			prototypeCrop = {left: Math.round( Math.max( 0, Math.min( 1448, 724 + (center.x - bounds.x - bounds.width / 2) * scale ) ) ),
				top: Math.round( Math.max( 0, Math.min( 1448, 724 + (center.y - bounds.y - bounds.height / 2) * scale ) ) )};
		}
		untyped Browser.window.cityGenerator = {
			buildId: BuildInfo.identifier(),
			size: StateManager.size,
			seed: StateManager.seed,
			walls: Model.instance.wall != null,
			footprints: StateManager.footprints,
			blockFrontage: StateManager.blockFrontage,
			roofed: StateManager.roofed,
			diagnostic: StateManager.diagnostic,
			setDiagnostic: setDiagnostic,
			prototype: StateManager.neighborhoodPrototype,
			frontageGrowth: StateManager.frontageGrowth,
			mixed: StateManager.mixedNeighborhoods,
			mixPercent: StateManager.mixPercent,
			districtOverrides: StateManager.districtOverrides,
			districtOverrideId: StateManager.districtOverrides == "" ? "" : haxe.crypto.Md5.encode( StateManager.districtOverrides ).substr( 0, 8 ),
			districtPolicies: Model.instance.districtPolicies,
			setMix: setMix,
			prototypePatch: Model.instance.prototypePatchIndex,
			prototypeCrop: prototypeCrop,
			setStyle: setStyle,
			exportPng: exportPng,
			restoreSeed: restoreSeed,
			generate: generate
		};
		Browser.document.dispatchEvent( new js.html.Event( "city-ready" ) );
	}

	private static function restoreSeed( seed:Int ):Void {
		if (seed < 1 || seed > 2147483646 || seed != Math.floor( seed )) return;
		if (StateManager.seed != seed) StateManager.districtOverrides = "";
		StateManager.seed = seed;
		generate( StateManager.size, StateManager.walls, false, StateManager.footprints, StateManager.blockFrontage, StateManager.neighborhoodPrototype, StateManager.frontageGrowth, StateManager.mixedNeighborhoods );
	}

	private static function setStyle( roofed:Bool ):Void {
		StateManager.diagnostic = false;
		StateManager.roofed = roofed;
		StateManager.pushParams();
		Game.switchScene( TownScene );
	}

	private static function setDiagnostic():Void {
		if (!StateManager.frontageGrowth && !StateManager.mixedNeighborhoods) return;
		StateManager.diagnostic = true; StateManager.roofed = false;
		StateManager.pushParams(); Game.switchScene( TownScene );
	}

	private static function setMix( percent:Int, overrides:String ):Void {
		if (percent < 0 || percent > 100 || percent != Math.floor( percent )) return;
		StateManager.mixPercent = percent;
		StateManager.districtOverrides = com.watabou.towngenerator.building.NeighborhoodMix.normalize( overrides );
		generate( StateManager.size, StateManager.walls, false, false, true, false, false, true );
	}

	private static function generate( size:Int, walls:Null<Bool>, newSeed:Bool, footprintMode:Bool, blockFrontageMode=false, prototype=false, frontageGrowth=false, mixed=false ):Void {
		if (size < 6 || size > 40) return;
		if (newSeed || size != StateManager.size || walls != StateManager.walls) StateManager.districtOverrides = "";
		StateManager.size = size;
		StateManager.walls = walls;
		StateManager.footprints = footprintMode;
		StateManager.blockFrontage = blockFrontageMode;
		StateManager.neighborhoodPrototype = blockFrontageMode && prototype;
		StateManager.frontageGrowth = blockFrontageMode && frontageGrowth;
		StateManager.mixedNeighborhoods = blockFrontageMode && mixed;
		if (!StateManager.frontageGrowth && !StateManager.mixedNeighborhoods) StateManager.diagnostic = false;
		if (newSeed) StateManager.seed = -1;
		StateManager.pushParams();
		new Model( StateManager.size, StateManager.seed, StateManager.walls, StateManager.footprints, StateManager.blockFrontage, StateManager.neighborhoodPrototype, StateManager.frontageGrowth,
			StateManager.mixedNeighborhoods, StateManager.mixPercent, StateManager.districtOverrides );
		Game.switchScene( TownScene );
	}
}
#end