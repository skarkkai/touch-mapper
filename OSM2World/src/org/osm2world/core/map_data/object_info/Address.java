package org.osm2world.core.map_data.object_info;

import java.util.Set;
import java.util.TreeSet;

public class Address {
	public final String name;
	public int importance;
	public Set<String> houseNumbers = new TreeSet<>();
	public Point center;

	public Address(String name) {
		this.name = name;
	}
}
