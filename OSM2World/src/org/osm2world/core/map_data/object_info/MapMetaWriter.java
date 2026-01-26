package org.osm2world.core.map_data.object_info;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

import org.openstreetmap.josm.plugins.graphview.core.data.Tag;
import org.openstreetmap.josm.plugins.graphview.core.data.TagGroup;
import org.osm2world.core.map_data.data.MapArea;
import org.osm2world.core.map_data.data.MapData;
import org.osm2world.core.map_data.data.MapNode;
import org.osm2world.core.map_data.data.MapWaySegment;
import org.osm2world.core.math.AxisAlignedBoundingBoxXZ;
import org.osm2world.core.math.VectorXZ;
import org.osm2world.core.osm.data.OSMElement;
import org.osm2world.core.osm.data.OSMNode;
import org.osm2world.core.osm.data.OSMRelation;
import org.osm2world.core.osm.data.OSMWay;
import org.osm2world.core.world.data.WorldObject;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.ObjectWriter;

public final class MapMetaWriter {

	private static final String EMPTY_TERRAIN_SURFACE = "osm2world:empty_terrain";

	private MapMetaWriter() {}

	public static void write(File outputFile, MapData mapData) throws IOException {
		ObjectWriter writer = new ObjectMapper().writer();

		Map<String, Object> root = new LinkedHashMap<String, Object>();
		root.put("meta", buildMeta(mapData));
		root.put("nodes", buildNodes(mapData));
		root.put("ways", buildWays(mapData));
		root.put("areas", buildAreas(mapData));

		System.out.println(root);
		writer.writeValue(outputFile, root);
	}

	private static Map<String, Object> buildMeta(MapData mapData) {
		Map<String, Object> meta = new LinkedHashMap<String, Object>();
		meta.put("boundary", boundsToMap(mapData.getBoundary()));
		meta.put("dataBoundary", boundsToMap(mapData.getDataBoundary()));
		return meta;
	}

	private static List<Map<String, Object>> buildNodes(MapData mapData) {
		List<MapNode> nodes = new ArrayList<MapNode>();
		for (MapNode node : mapData.getMapNodes()) {
			if (node.getRepresentations().isEmpty()) {
				continue;
			}
			if (isEmptyTerrain(node.getTags())) {
				continue;
			}
			nodes.add(node);
		}

		Collections.sort(nodes, new Comparator<MapNode>() {
			@Override
			public int compare(MapNode a, MapNode b) {
				long aId = a.getOsmNode().id;
				long bId = b.getOsmNode().id;
				return (aId < bId) ? -1 : ((aId > bId) ? 1 : 0);
			}
		});

		List<Map<String, Object>> output = new ArrayList<Map<String, Object>>();
		for (MapNode node : nodes) {
			output.add(buildNodeEntry(node));
		}
		return output;
	}

	private static List<Map<String, Object>> buildWays(MapData mapData) {
		Map<OSMNode, VectorXZ> nodePositions = new HashMap<OSMNode, VectorXZ>();
		for (MapNode node : mapData.getMapNodes()) {
			nodePositions.put(node.getOsmNode(), node.getPos());
		}

		Map<OSMWay, List<MapWaySegment>> segmentsByWay =
				new HashMap<OSMWay, List<MapWaySegment>>();
		for (MapWaySegment segment : mapData.getMapWaySegments()) {
			if (segment.getRepresentations().isEmpty()) {
				continue;
			}
			OSMWay way = segment.getOsmWay();
			List<MapWaySegment> segments = segmentsByWay.get(way);
			if (segments == null) {
				segments = new ArrayList<MapWaySegment>();
				segmentsByWay.put(way, segments);
			}
			segments.add(segment);
		}

		List<OSMWay> ways = new ArrayList<OSMWay>(segmentsByWay.keySet());
		Collections.sort(ways, new Comparator<OSMWay>() {
			@Override
			public int compare(OSMWay a, OSMWay b) {
				long aId = a.id;
				long bId = b.id;
				return (aId < bId) ? -1 : ((aId > bId) ? 1 : 0);
			}
		});

		List<Map<String, Object>> output = new ArrayList<Map<String, Object>>();
		for (OSMWay way : ways) {
			List<VectorXZ> positions = new ArrayList<VectorXZ>();
			List<List<Double>> coords = new ArrayList<List<Double>>();
			for (OSMNode node : way.nodes) {
				VectorXZ pos = nodePositions.get(node);
				if (pos == null) {
					continue;
				}
				positions.add(pos);
				coords.add(coordToList(pos));
			}
			if (coords.isEmpty()) {
				continue;
			}

			Map<String, Object> entry =
					buildWayEntry(way, segmentsByWay.get(way), positions, coords);
			output.add(entry);
		}

		return output;
	}

	private static List<Map<String, Object>> buildAreas(MapData mapData) {
		List<MapArea> areas = new ArrayList<MapArea>();
		for (MapArea area : mapData.getMapAreas()) {
			if (area.getRepresentations().isEmpty()) {
				continue;
			}
			if (isEmptyTerrain(area.getTags())) {
				continue;
			}
			areas.add(area);
		}

		Collections.sort(areas, new Comparator<MapArea>() {
			@Override
			public int compare(MapArea a, MapArea b) {
				long aId = a.getOsmObject().id;
				long bId = b.getOsmObject().id;
				return (aId < bId) ? -1 : ((aId > bId) ? 1 : 0);
			}
		});

		List<Map<String, Object>> output = new ArrayList<Map<String, Object>>();
		for (MapArea area : areas) {
			output.add(buildAreaEntry(area));
		}
		return output;
	}

	private static Map<String, Object> buildNodeEntry(MapNode node) {
		Map<String, Object> entry = new LinkedHashMap<String, Object>();
		OSMNode osmNode = node.getOsmNode();

		addCommonFields(entry, "node", osmNode, node.getTags());
		addRepresentationFields(entry, node.getRepresentations());

		VectorXZ pos = node.getPos();
		AxisAlignedBoundingBoxXZ bounds = new AxisAlignedBoundingBoxXZ(
				pos.x, pos.z, pos.x, pos.z);

		entry.put("geometry", pointGeometry(pos));
		entry.put("bounds", boundsToMap(bounds));
		entry.put("center", centerToList(bounds));

		return entry;
	}

	private static Map<String, Object> buildWayEntry(OSMWay way,
			List<MapWaySegment> segments, List<VectorXZ> positions,
			List<List<Double>> coords) {
		Map<String, Object> entry = new LinkedHashMap<String, Object>();

		addCommonFields(entry, "way", way, way.tags);
		addWayRepresentationFields(entry, segments);

		AxisAlignedBoundingBoxXZ bounds = new AxisAlignedBoundingBoxXZ(positions);

		Map<String, Object> geometry = new LinkedHashMap<String, Object>();
		geometry.put("type", "line_string");
		geometry.put("coordinates", coords);
		geometry.put("closed", Boolean.valueOf(way.isClosed()));

		entry.put("geometry", geometry);
		entry.put("isClosed", Boolean.valueOf(way.isClosed()));
		entry.put("bounds", boundsToMap(bounds));
		entry.put("center", centerToList(bounds));

		return entry;
	}

	private static Map<String, Object> buildAreaEntry(MapArea area) {
		Map<String, Object> entry = new LinkedHashMap<String, Object>();

		OSMElement element = area.getOsmObject();

		addCommonFields(entry, "area", element, area.getTags());
		addRepresentationFields(entry, area.getRepresentations());

		List<List<Double>> outer = new ArrayList<List<Double>>();
		for (MapNode node : area.getBoundaryNodes()) {
			outer.add(coordToList(node.getPos()));
		}

		List<List<List<Double>>> holes = new ArrayList<List<List<Double>>>();
		for (List<MapNode> holeNodes : area.getHoles()) {
			List<List<Double>> hole = new ArrayList<List<Double>>();
			for (MapNode node : holeNodes) {
				hole.add(coordToList(node.getPos()));
			}
			holes.add(hole);
		}

		Map<String, Object> geometry = new LinkedHashMap<String, Object>();
		geometry.put("type", "polygon");
		geometry.put("outer", outer);
		geometry.put("holes", holes);

		AxisAlignedBoundingBoxXZ bounds = area.getAxisAlignedBoundingBoxXZ();

		entry.put("geometry", geometry);
		entry.put("hasHoles", Boolean.valueOf(!holes.isEmpty()));
		entry.put("bounds", boundsToMap(bounds));
		entry.put("center", centerToList(bounds));

		return entry;
	}

	private static void addCommonFields(Map<String, Object> entry,
			String elementType, OSMElement osmElement, TagGroup tags) {
		entry.put("elementType", elementType);
		entry.put("osmType", osmType(osmElement));
		entry.put("osmId", Long.valueOf(osmElement.id));
		entry.put("layer", Integer.valueOf(getLayer(tags)));
		entry.put("tags", tagsToMap(tags));
	}

	private static void addRepresentationFields(Map<String, Object> entry,
			List<? extends WorldObject> representations) {
		Set<String> repNames = new TreeSet<String>();
		Set<String> groundStates = new TreeSet<String>();
		for (WorldObject representation : representations) {
			repNames.add(representation.getClass().getSimpleName());
			groundStates.add(representation.getGroundState().name());
		}

		WorldObject primary = representations.isEmpty()
				? null
				: representations.get(0);

		entry.put("representations", new ArrayList<String>(repNames));
		entry.put("primaryRepresentation",
				(primary == null) ? null : primary.getClass().getSimpleName());
		entry.put("groundStates", new ArrayList<String>(groundStates));
		entry.put("primaryGroundState",
				(primary == null) ? null : primary.getGroundState().name());
	}

	private static void addWayRepresentationFields(Map<String, Object> entry,
			List<MapWaySegment> segments) {
		Set<String> repNames = new TreeSet<String>();
		Set<String> groundStates = new TreeSet<String>();
		Set<String> primaryNames = new TreeSet<String>();
		Set<String> primaryGroundStates = new TreeSet<String>();

		for (MapWaySegment segment : segments) {
			for (WorldObject representation : segment.getRepresentations()) {
				repNames.add(representation.getClass().getSimpleName());
				groundStates.add(representation.getGroundState().name());
			}
			WorldObject primary = segment.getPrimaryRepresentation();
			if (primary != null) {
				primaryNames.add(primary.getClass().getSimpleName());
				primaryGroundStates.add(primary.getGroundState().name());
			}
		}

		entry.put("representations", new ArrayList<String>(repNames));
		entry.put("groundStates", new ArrayList<String>(groundStates));
		entry.put("primaryRepresentation",
				(primaryNames.size() == 1) ? primaryNames.iterator().next() : null);
		entry.put("primaryGroundState",
				(primaryGroundStates.size() == 1)
						? primaryGroundStates.iterator().next()
						: null);
	}

	private static Map<String, String> tagsToMap(TagGroup tags) {
		Map<String, String> out = new TreeMap<String, String>();
		for (Tag tag : tags) {
			out.put(tag.key, tag.value);
		}
		return out;
	}

	private static Map<String, Double> boundsToMap(AxisAlignedBoundingBoxXZ bounds) {
		Map<String, Double> out = new LinkedHashMap<String, Double>();
		out.put("minX", Double.valueOf(bounds.minX));
		out.put("minY", Double.valueOf(bounds.minZ));
		out.put("maxX", Double.valueOf(bounds.maxX));
		out.put("maxY", Double.valueOf(bounds.maxZ));
		return out;
	}

	private static List<Double> centerToList(AxisAlignedBoundingBoxXZ bounds) {
		double centerX = (bounds.minX + bounds.maxX) / 2.0;
		double centerZ = (bounds.minZ + bounds.maxZ) / 2.0;
		List<Double> center = new ArrayList<Double>(2);
		center.add(Double.valueOf(centerX));
		center.add(Double.valueOf(centerZ));
		return center;
	}

	private static List<Double> coordToList(VectorXZ pos) {
		List<Double> coord = new ArrayList<Double>(2);
		coord.add(Double.valueOf(pos.x));
		coord.add(Double.valueOf(pos.z));
		return coord;
	}

	private static Map<String, Object> pointGeometry(VectorXZ pos) {
		Map<String, Object> geometry = new LinkedHashMap<String, Object>();
		geometry.put("type", "point");
		geometry.put("coordinates", coordToList(pos));
		return geometry;
	}

	private static boolean isEmptyTerrain(TagGroup tags) {
		return tags != null && tags.contains("surface", EMPTY_TERRAIN_SURFACE);
	}

	private static String osmType(OSMElement element) {
		if (element instanceof OSMNode) {
			return "node";
		} else if (element instanceof OSMWay) {
			return "way";
		} else if (element instanceof OSMRelation) {
			return "relation";
		}
		return "unknown";
	}

	private static int getLayer(TagGroup tags) {
		if (tags != null && tags.containsKey("layer")) {
			try {
				return Integer.parseInt(tags.getValue("layer"));
			} catch (NumberFormatException nfe) {
				return 0;
			}
		}
		return 0;
	}
}
