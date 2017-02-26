package org.osm2world.core.map_data.object_info;

import java.util.HashSet;
import java.util.Set;
import java.util.TreeSet;

public class WayObject extends BaseObject {
    public Set<String> houseNumbers = new TreeSet<>();
	public Set<Point> points = new HashSet<>();
	public Set<Point> borderCrossings = new HashSet<>(); // TODO
	public Set<String> intersections = new HashSet<>(); // TODO

	public WayObject(String name) {
		super(name);
	}
}
