package com.watabou.towngenerator.building;

import com.watabou.towngenerator.wards.Ward;

class StreetHierarchy {

	public static inline var MAIN_ROAD = Ward.MAIN_STREET;
	public static inline var DISTRICT_STREET = Ward.REGULAR_STREET;

	public static function spine( lotWidth:Float ):Float {
		return Math.min( 0.9, Math.max( 0.52, lotWidth * 0.14 ) );
	}

	public static function connector( lotWidth:Float ):Float {
		return Math.min( 0.56, Math.max( 0.34, lotWidth * 0.085 ) );
	}

	public static function passage( frontageWidth:Float ):Float {
		return Math.min( 0.28, Math.max( 0.18, frontageWidth * 0.1 ) );
	}
}