package org.osm2world.core.world.creation;

import java.util.Arrays;
import java.util.Collection;
import java.util.List;

import org.apache.commons.configuration.Configuration;
import org.osm2world.core.map_data.data.MapData;
import org.osm2world.core.util.TouchMapperProfile;

public class WorldCreator {

	private Collection<WorldModule> modules;
		
	public WorldCreator(Configuration config, WorldModule... modules) {
		this(config, Arrays.asList(modules));
	}
	
	public WorldCreator(Configuration config, List<WorldModule> modules) {
		this.modules = modules;
		for (WorldModule module : modules) {
			module.setConfiguration(config);
		}
	}
	
	public void addRepresentationsTo(MapData mapData) {

		long totalStart = TouchMapperProfile.start();
		
		for (WorldModule module : modules) {
			long moduleStart = TouchMapperProfile.start();
			module.applyTo(mapData);
			TouchMapperProfile.logMillis("representation.module."
					+ module.getClass().getSimpleName() + "_ms", moduleStart);
		}
		
		long networkStart = TouchMapperProfile.start();
		NetworkCalculator.calculateNetworkInformationInGrid(mapData);
		TouchMapperProfile.logMillis("representation.network_calculation_ms",
				networkStart);
		TouchMapperProfile.logMillis("representation.total_ms", totalStart);
		
	}
	
}
