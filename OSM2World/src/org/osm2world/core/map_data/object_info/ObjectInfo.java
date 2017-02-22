package org.osm2world.core.map_data.object_info;

import java.util.HashSet;
import java.util.Set;
import java.util.TreeSet;

public class ObjectInfo {
	public final String name;
	public final ObjectType type;
	public int importance;
	public Set<Integer> houseNumbers = new TreeSet<>();
	public Set<Point> points = new HashSet<>();
	public Set<Point> borderCrossings = new HashSet<>(); // TODO
	public Set<String> intersections = new HashSet<>(); // TODO

	public ObjectInfo(String name, ObjectType type) {
		this.name = name;
		this.type = type;
	}
}
