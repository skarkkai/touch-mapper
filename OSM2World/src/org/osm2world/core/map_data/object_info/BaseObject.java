package org.osm2world.core.map_data.object_info;

public abstract class BaseObject {

	public final String name;
	public int importance;

	public BaseObject(String name) {
		this.name = name;
	}
}