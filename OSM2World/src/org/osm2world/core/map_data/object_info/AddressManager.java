package org.osm2world.core.map_data.object_info;

import java.util.Optional;

import org.osm2world.core.osm.data.OSMData;
import org.osm2world.core.osm.data.OSMElement;
import org.osm2world.core.osm.data.OSMNode;
import org.osm2world.core.osm.data.OSMRelation;
import org.osm2world.core.osm.data.OSMWay;

import com.google.common.base.MoreObjects;
import com.google.common.base.Objects;
import com.google.common.base.Strings;

public class AddressManager {
	public static void gatherAddresses(OSMData osmData) {
		for (OSMNode node : osmData.getNodes()) {
			gatherAddresses(node);
		}
		for (OSMWay way : osmData.getWays()) {
			gatherAddresses(way);
		}
		for (OSMRelation relation : osmData.getRelations()) {
			// http://wiki.openstreetmap.org/wiki/Relation:associatedStreet
		}
	}

	private static void gatherAddresses(OSMElement node) {
		String name = node.tags.getValue("addr:street");
		if (name == null) {
			name = node.tags.getValue("addr:place");
		}
		if (name == null) {
			name = node.tags.getValue("name");
		}
		System.out.println("name: " + name);
		if (name != null) {
			Address addr = ObjectInfoManager.addAddress(name);
			String houseNumber = node.tags.getValue("addr:housenumber");
			if (! Strings.isNullOrEmpty(houseNumber)) {
				// TODO: expand number ranges etc: https://en.wikipedia.org/wiki/House_numbering
				addr.houseNumbers.add(houseNumber);
			}
		}
	}
}
