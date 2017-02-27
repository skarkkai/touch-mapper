package org.osm2world.core.map_data.object_info;

import org.osm2world.core.math.VectorXZ;

public class PoiObject extends BaseObject {
    public String street; // if set, may match name of a WayObject
    public String houseNumber;
	public Point center;

	public PoiObject(String name) {
		super(name);
	}
}
