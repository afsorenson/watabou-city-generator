package com.watabou.towngenerator;

import openfl.display.BitmapData;
import openfl.display.PNGEncoderOptions;
import openfl.display.Shape;
import openfl.display.Sprite;
import openfl.geom.Matrix;
import openfl.geom.Rectangle;
import openfl.net.FileReference;
import openfl.utils.ByteArray;

import com.watabou.coogee.Scene;

import com.watabou.towngenerator.building.Model;
import com.watabou.towngenerator.mapping.CityMap;
import com.watabou.towngenerator.ui.Button;
import com.watabou.towngenerator.ui.CitySizeButton;
import com.watabou.towngenerator.ui.Tooltip;

class TownScene extends Scene {

	private var buttons	: Sprite;
	private var map		: CityMap;
	private var mapMask : Shape;

	public function new() {
		super();

		map = new CityMap( Model.instance );
		addChild( map );
		mapMask = new Shape();
		addChild( mapMask );
		map.mask = mapMask;

		addChild( new Tooltip() );

		buttons = new Sprite();
		addChild( buttons );

		#if html5
		BrowserControls.bind( exportPng );
		#else
		var smallTown = new CitySizeButton( "Small Town", 6, 10 );
		var largeTown = new CitySizeButton( "Large Town", 10, 15 );
		var smallCity = new CitySizeButton( "Small City", 15, 24 );
		var largeCity = new CitySizeButton( "Large City", 24, 40 );
		var exportButton = new Button( "Export PNG" );
		exportButton.click.add( exportPng );

		var pos = 0.0;
		for (btn in [smallTown, largeTown, smallCity, largeCity, exportButton]) {
			btn.y = pos;
			pos += btn.height + 1;
			buttons.addChild( btn );
		}
		#end
	}

	private function exportPng():Void {
		var resolution = 2048;
		var padding = 64;
		var bounds = map.getCityBounds();
		var exportScale = (resolution - padding * 2) / Math.max( bounds.width, bounds.height );
		var transform = new Matrix( exportScale, 0, 0, exportScale,
			resolution / 2 - (bounds.x + bounds.width / 2) * exportScale,
			resolution / 2 - (bounds.y + bounds.height / 2) * exportScale );
		var image = new BitmapData( resolution, resolution, false, CityMap.palette.paper );
		var clip = new Rectangle( (resolution - bounds.width * exportScale) / 2,
			(resolution - bounds.height * exportScale) / 2,
			bounds.width * exportScale, bounds.height * exportScale );
		map.mask = null;
		image.draw( map, transform, null, null, clip, true );
		map.mask = mapMask;
		var png = image.encode( image.rect, new PNGEncoderOptions() );
		image.dispose();
		var bytes:haxe.io.Bytes = png;
		var suffix = StateManager.footprints ? "-footprints" : "";
		new FileReference().save( ByteArray.fromBytes( bytes.sub( 0, png.length ) ),
			'city-${StateManager.size}-${StateManager.seed}-${Model.instance.wall != null ? "walled" : "open"}$suffix.png' );
	}

	private var scale(get,set) : Float;
	private inline function get_scale():Float
		return map.scaleX;
	private function set_scale( value:Float ):Float
		return (map.scaleX = map.scaleY = value);

	override public function layout():Void {
		var bounds = map.getCityBounds();
		scale = Math.min( rWidth / bounds.width, rHeight / bounds.height );
		map.x = rWidth / 2 - (bounds.x + bounds.width / 2) * scale;
		map.y = rHeight / 2 - (bounds.y + bounds.height / 2) * scale;
		mapMask.graphics.clear();
		mapMask.graphics.beginFill( 0xffffff );
		mapMask.graphics.drawRect( map.x + bounds.x * scale, map.y + bounds.y * scale,
			bounds.width * scale, bounds.height * scale );
		mapMask.graphics.endFill();

		buttons.x = rWidth - buttons.width - 1;
		buttons.y = 1;
	}
}
