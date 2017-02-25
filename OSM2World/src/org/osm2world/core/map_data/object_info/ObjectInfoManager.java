package org.osm2world.core.map_data.object_info;

import java.util.HashMap;
import java.util.Map;

import org.openstreetmap.josm.plugins.graphview.core.data.Tag;
import org.osm2world.core.map_data.data.MapNode;
import org.osm2world.core.map_data.data.MapWaySegment;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.ObjectWriter;

public class ObjectInfoManager {
	private static Map<String, ObjectInfo> infos = new HashMap<>();
	
	public static void add(MapWaySegment line, ObjectType type) {
		String name = line.getTags().getValue("name");
		if (name == null || name.equals("")) {
			return;
		}
		ObjectInfo info = infos.get(name);
		if (info == null) {
			info = new ObjectInfo(name, type);
			infos.put(name, info);
		}
		if (info.type != type) {
			System.out.println("WARNING: different object types for " + name);
		}
		info.points.add(new Point(line.getStartNode().getPos().x, line.getStartNode().getPos().z));
		
		for (Tag tag : line.getTags()) {
			//System.out.println("tag:" + tag.key + "=" + tag.value);
		}
		String houseNumber = line.getTags().getValue("addr:housenumber");
		if (houseNumber != null && ! houseNumber.equals("")) {
			try {
				info.houseNumbers.add(Integer.valueOf(houseNumber));
			} catch (Exception e) {
				System.out.println(houseNumber);
				e.printStackTrace();
			}
		}
	}
	
	public static String getJsonLine() {
		ObjectWriter writer = new ObjectMapper().writer();
		try {
			return writer.writeValueAsString(infos);
		} catch (JsonProcessingException e) {
			e.printStackTrace();
			return "{}";
		}
	}
}
