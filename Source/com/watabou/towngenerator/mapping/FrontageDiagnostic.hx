package com.watabou.towngenerator.mapping;

import openfl.display.Shape;
import com.watabou.towngenerator.building.FrontageNeighborhood;
import com.watabou.geom.Polygon;
import openfl.geom.Point;

using com.watabou.utils.GraphicsExtender;

class FrontageDiagnostic extends Shape {
	public function new( data:FrontageNeighborhood ) {
		super();
		graphics.beginFill( 0xf5f5f2 ); graphics.drawPolygon( data.block ); graphics.endFill();
		for (part in data.remaining) {
			graphics.beginFill( 0xdbe8c3 );
			graphics.drawPolygon( [for (point in part[0]) new Point( point[0], point[1] )] ); graphics.endFill();
		}
		for (plot in data.plots) {
			graphics.lineStyle( 0.1, 0x778c9c ); graphics.beginFill( 0xd4e4ee );
			graphics.drawPolygon( plot.polygon ); graphics.endFill();
			graphics.lineStyle( 0.08, 0x555555 ); graphics.beginFill( 0xaaaaaa );
			graphics.drawPolygon( plot.building ); graphics.endFill();
		}
		for (street in data.streets) {
			graphics.lineStyle( street.existing ? 0.28 : street.width, 0x365d88 );
			graphics.drawPolyline( [street.start, street.end] );
		}
		for (plot in data.plots) {
			graphics.lineStyle( 0.26, 0xb36a24 ); graphics.drawPolyline( plot.frontage );
		}
		graphics.lineStyle();
		for (excluded in data.exclusions) {
			graphics.beginFill( 0xe8b7b7 ); graphics.drawPolygon( excluded ); graphics.endFill();
		}
	}
}