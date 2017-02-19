package org.osm2world.core.map_data.object_info;

import java.util.HashMap;
import java.util.Map;

import org.osm2world.core.map_data.data.MapWaySegment;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.ObjectWriter;

public class ObjectInfoManager {
	private static Map<String, ObjectInfo> infos = new HashMap<>();
	
	public static void add(MapWaySegment line, ObjectType type) {
		String name = line.getTags().getValue("name");
		if (name == null || name.equals("")) {
			System.out.println("WARNING: object has no name");
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
