package org.osm2world.core.map_data.object_info;

import java.util.HashSet;
import java.util.Set;
import java.util.TreeSet;

public class Road {
	public final String name;
	public int importance;
	public Set<Point> points = new HashSet<>();
	public Set<Point> borderCrossings = new HashSet<>(); // TODO
	public Set<String> intersections = new HashSet<>(); // TODO

	public Road(String name) {
		this.name = name;
	}
}
