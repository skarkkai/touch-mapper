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
	private static Map<String, Road> roads = new HashMap<>();        // key is street name
	private static Map<String, Address> addresses = new HashMap<>(); // key is street or place name
	
	public static void add(MapWaySegment line) {
		try {
			String name = line.getTags().getValue("name");
			if (name == null || name.equals("")) {
				return;
			}
			Road info = roads.get(name);
			if (info == null) {
				info = new Road(name);
				roads.put(name, info);
			}
			info.points.add(new Point(line.getStartNode().getPos().x, line.getStartNode().getPos().z));
			
			for (Tag tag : line.getTags()) {
				//System.out.println("tag:" + tag.key + "=" + tag.value);
			}
//			String houseNumber = line.getTags().getValue("addr:housenumber");
//			if (houseNumber != null && ! houseNumber.equals("")) {
//					info.houseNumbers.add(Integer.valueOf(houseNumber));
//			}
		} catch (Exception e) {
			System.out.println(line);
			e.printStackTrace();
		}
	}

	public static Address addAddress(String name) {
		Address addr = addresses.get(name);
		if (addr == null) {
			addr = new Address(name);
			addresses.put(name, addr);
		}
		return addr;
		
	}

	public static String getJsonLine() {
		ObjectWriter writer = new ObjectMapper().writer();
		try {
			HashMap<String, Object> out = new HashMap<>();
			out.put("roads", roads);
			out.put("addresses", addresses);
			return writer.writeValueAsString(out);
		} catch (JsonProcessingException e) {
			e.printStackTrace();
			return "{}";
		}
	}
}
