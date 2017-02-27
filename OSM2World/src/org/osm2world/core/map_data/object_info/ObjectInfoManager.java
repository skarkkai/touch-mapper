package org.osm2world.core.map_data.object_info;

import java.util.HashMap;
import java.util.Map;

import org.openstreetmap.josm.plugins.graphview.core.data.Tag;
import org.osm2world.core.map_data.data.MapNode;
import org.osm2world.core.map_data.data.MapWaySegment;
import org.osm2world.core.osm.data.OSMElement;
import org.osm2world.core.osm.data.OSMNode;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.ObjectWriter;

public class ObjectInfoManager {
	private static Map<String, WayObject> ways = new HashMap<>();
	private static Map<String, PoiObject> pois = new HashMap<>();
	private static Map<String, Map<String, PoiObject>> poiByType = new HashMap<>(); // tram_stop => Jaakkimantie => WayObject
	
	public static void add(MapWaySegment line) {
		try {
			String name = line.getTags().getValue("name");
			if (name == null || name.equals("")) {
				return;
			}
			WayObject info = ways.get(name);
			if (info == null) {
				info = new WayObject(name);
				ways.put(name, info);
			}
			info.points.add(new Point(line.getStartNode().getPos().x, line.getStartNode().getPos().z));
			
			for (Tag tag : line.getTags()) {
				//System.out.println("tag:" + tag.key + "=" + tag.value);
			}
		} catch (Exception e) {
			System.out.println(line);
			e.printStackTrace();
		}
	}

	public static void addPoi(OSMElement element, String subtype, MapNode mapNode) {
		String name = element.tags.getValue("name");
		if (name == null) {
			return;
		}
		if (mapNode == null && pois.containsKey(name)) {
			return;
		}
		
		// Create PoiObject
		PoiObject poi = new PoiObject(name);
		if (mapNode != null) {
			poi.center = new Point(mapNode.getPos().x, mapNode.getPos().z);
		}
		
		// Store by name and type+name
		pois.put(name, poi);
		Map<String, PoiObject> byType = poiByType.get(subtype);
		if (byType == null) {
			byType = new HashMap<>();
			poiByType.put(subtype, byType);
		}
		byType.put(name, poi);
		
		// If POI references a street and has a housenumber, add that to the street.
		addStreetHouseNumber(element, name);
	}

	public static void addStreetMeta(OSMElement element) {
		addStreetHouseNumber(element, element.tags.getValue("name"));
	}
	
	public WayObject getPoiStreet(PoiObject poi) {
		if (poi.street != null && ways.containsKey(poi.street)) {
			return ways.get(poi.street);
		}
		return null;
	}

	private static void addStreetHouseNumber(OSMElement element, String name) {
		String street = element.tags.getValue("addr:street");
		String housenumber = element.tags.getValue("addr:housenumber");
		System.out.println(street + ":" + housenumber);
		if (street != null && housenumber != null) {
			WayObject way = ways.get(street);
			if (way != null) {
				System.out.println("Adding housenumber " + street + "/" + housenumber + " from POI " + name + " ");
				way.houseNumbers.add(housenumber);
			}
		}
	}
	
	public static String getJsonLine() {
		ObjectWriter writer = new ObjectMapper().writer();
		try {
			HashMap<String, Object> out = new HashMap<>();
			out.put("ways", ways);
			out.put("pois", poiByType);
			return writer.writeValueAsString(out);
		} catch (JsonProcessingException e) {
			e.printStackTrace();
			return "{}";
		}
	}
}
