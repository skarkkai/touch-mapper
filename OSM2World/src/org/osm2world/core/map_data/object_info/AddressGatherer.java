package org.osm2world.core.map_data.object_info;

import org.openstreetmap.josm.plugins.graphview.core.data.Tag;
import org.osm2world.core.map_data.data.MapData;
import org.osm2world.core.map_data.data.MapNode;
import org.osm2world.core.map_data.object_info.ObjectType.MainType;
import org.osm2world.core.osm.data.OSMData;
import org.osm2world.core.osm.data.OSMElement;
import org.osm2world.core.osm.data.OSMNode;
import org.osm2world.core.osm.data.OSMRelation;
import org.osm2world.core.osm.data.OSMWay;

import com.google.common.base.Strings;

public class AddressGatherer {
	public static void gather(OSMData osmData, MapData grid) {
		for (MapNode mapNode : grid.getMapNodes()) {
			gatherMapNode(mapNode);
		}
		for (OSMNode node : osmData.getNodes()) {
			gatherOsmNode(node);
		}
//		for (OSMWay way : osmData.getWays()) {
//			addAddresses(way);
//		}
		for (OSMRelation relation : osmData.getRelations()) {
			// http://wiki.openstreetmap.org/wiki/Relation:associatedStreet
		}
	}

	private static void gatherMapNode(MapNode mapNode) {
		gatherAnyNode(mapNode.getOsmNode(), mapNode);

//			BaseObject addr = ObjectInfoManager.addAddress(name);
//			String houseNumber = node.tags.getValue("addr:housenumber");
//			if (! Strings.isNullOrEmpty(houseNumber)) {
//				// TODO: expand number ranges etc: https://en.wikipedia.org/wiki/House_numbering
////				addr.houseNumbers.add(houseNumber);
//			}
	}

	private static void gatherOsmNode(OSMNode node) {
		gatherAnyNode(node, null);
	}

	private static void gatherAnyNode(OSMNode osmNode, MapNode mapNode) {
		ObjectType type = ObjectType.fromElement(osmNode);
		if (type.maintype == MainType.POI) {
			ObjectInfoManager.addPoi(osmNode, type.subtype, mapNode);
		} else if (type.maintype == MainType.STREET_META) {
			ObjectInfoManager.addStreetMeta(osmNode);
		}
//		for (Tag tag : osmNode.tags) {
//			System.out.println(tag.key + ": " + tag.key + "=" + tag.value);
//		}
//		System.out.println("---");
	}

}
