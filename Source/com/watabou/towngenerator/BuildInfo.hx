package com.watabou.towngenerator;

class BuildInfo {

	public static macro function identifier():haxe.macro.Expr {
		var identifier = haxe.macro.Context.definedValue( "city_build_id" );
		if (identifier == null) identifier = "unversioned";
		return macro $v{identifier};
	}
}