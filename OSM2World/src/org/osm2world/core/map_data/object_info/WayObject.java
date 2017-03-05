package org.osm2world.core.map_data.object_info;

import java.util.HashSet;
import java.util.Set;
import java.util.TreeSet;

import org.osm2world.core.math.LineSegmentXZ;

public class WayObject extends BaseObject {
	public Set<Point> points = new HashSet<>();
	public float totalLength;
	public Set<Point> borderCrossings = new HashSet<>(); // TODO
	public Set<String> intersections = new HashSet<>(); // TODO

	public WayObject(String name) {
		super(name);
	}

	public void addSegment(LineSegmentXZ segment) {
		points.add(new Point(segment.p1.x, segment.p1.z));
		points.add(new Point(segment.p2.x, segment.p2.z));
		totalLength += segment.getLength();
	}
}
