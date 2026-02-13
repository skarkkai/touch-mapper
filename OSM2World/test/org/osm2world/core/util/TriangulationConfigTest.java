package org.osm2world.core.util;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class TriangulationConfigTest {

	@Test
	public void parseCollinearToleranceNullUsesDefault() {
		assertEquals(
				TriangulationConfig.DEFAULT_COLLINEAR_TOLERANCE_M,
				TriangulationConfig.parseCollinearToleranceMeters(null),
				0.0);
	}

	@Test
	public void parseCollinearToleranceInvalidDisablesSimplification() {
		assertEquals(
				0.0,
				TriangulationConfig.parseCollinearToleranceMeters("not-a-number"),
				0.0);
	}

	@Test
	public void parseCollinearToleranceNonPositiveDisablesSimplification() {
		assertEquals(
				0.0,
				TriangulationConfig.parseCollinearToleranceMeters("0"),
				0.0);
		assertEquals(
				0.0,
				TriangulationConfig.parseCollinearToleranceMeters("-0.5"),
				0.0);
	}

	@Test
	public void parseCollinearTolerancePositiveUsesProvidedValue() {
		assertEquals(
				0.125,
				TriangulationConfig.parseCollinearToleranceMeters("0.125"),
				0.0);
	}

}
