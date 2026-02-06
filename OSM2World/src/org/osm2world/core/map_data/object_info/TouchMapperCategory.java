package org.osm2world.core.map_data.object_info;

import java.util.Collections;
import java.util.List;
import java.util.Set;

import org.openstreetmap.josm.plugins.graphview.core.data.TagGroup;
import org.osm2world.core.map_data.data.MapNode;
import org.osm2world.core.map_data.data.MapWaySegment;
import org.osm2world.core.world.data.WorldObject;

public final class TouchMapperCategory {

	private TouchMapperCategory() {}

	public static String categoryForWorldObject(WorldObject object) {
		if (object == null) {
			return null;
		}
		return categoryForRepresentationNames(
				Collections.singleton(object.getClass().getSimpleName()));
	}

	public static String categoryForRepresentationNames(Set<String> repNames) {
		if (repNames == null || repNames.isEmpty()) {
			return null;
		}
		if (containsPrefix(repNames, "RoadArea")) {
			return "RoadArea";
		}
		if (containsPrefix(repNames, "Road")) {
			return "Road";
		}
		if (containsPrefix(repNames, "Rail")) {
			return "Rail";
		}
		if (containsPrefix(repNames, "BuildingEntrance")) {
			return "BuildingEntrance";
		}
		if (containsPrefix(repNames, "Building")) {
			return "Building";
		}
		if (containsPrefix(repNames, "AreaFountain")) {
			return "AreaFountain";
		}
		if (containsPrefix(repNames, "Waterway")) {
			return "Waterway";
		}
		if (containsPrefix(repNames, "River")) {
			return "River";
		}
		if (containsPrefix(repNames, "Water")) {
			return "Water";
		}
		return repNames.iterator().next();
	}

	public static boolean isPedestrian(MapNode node) {
		if (node == null) {
			return false;
		}
		List<MapWaySegment> connectedWaySegments = node.getConnectedWaySegments();
		int pedestrians = 0;
		for (MapWaySegment mapWaySegment : connectedWaySegments) {
			pedestrians += isPedestrian(mapWaySegment.getTags()) ? 1 : 0;
		}
		return pedestrians >= (connectedWaySegments.size() + 1) / 2;
	}

	public static boolean isPedestrian(TagGroup tags) {
		if (tags == null) {
			return false;
		}
		String highwayValue = tags.getValue("highway");
		if ("path".equals(highwayValue)
			|| "footway".equals(highwayValue)
			|| "cycleway".equals(highwayValue)
			|| "service".equals(highwayValue)
			|| "bridleway".equals(highwayValue)
			|| "living_street".equals(highwayValue)
			|| "pedestrian".equals(highwayValue)
			|| "track".equals(highwayValue)
			|| "steps".equals(highwayValue)) {
			return true;
		}
		if (tags.containsKey("footway")
				|| tags.contains("tourism", "attraction")
				|| tags.contains("man_made", "pier")
				|| tags.contains("man_made", "breakwater")) {
			return true;
		}
		String footValue = tags.getValue("foot");
		if ("yes".equals(footValue)
			|| "designated".equals(footValue)) {
			return true;
		}
		return false;
	}

	public static String roadSuffix(boolean pedestrian) {
		return pedestrian ? "::pedestrian" : "";
	}

	private static boolean containsPrefix(Set<String> repNames, String prefix) {
		for (String name : repNames) {
			if (name.startsWith(prefix)) {
				return true;
			}
		}
		return false;
	}
}
