package org.osm2world.core.util;

/**
 * Shared triangulation-related runtime configuration.
 */
public final class TriangulationConfig {

	public static final String COLLINEAR_TOLERANCE_ENV =
			"TOUCH_MAPPER_TRIANGULATION_COLLINEAR_TOLERANCE_M";

	public static final double DEFAULT_COLLINEAR_TOLERANCE_M = 0.05;

	private static final double collinearToleranceMeters =
			parseCollinearToleranceMeters(System.getenv(COLLINEAR_TOLERANCE_ENV));

	private TriangulationConfig() { }

	/**
	 * @return tolerance in meters for removing near-collinear vertices before
	 *         triangulation. Returns 0 if simplification is disabled.
	 */
	public static double getCollinearToleranceMeters() {
		return collinearToleranceMeters;
	}

	static double parseCollinearToleranceMeters(String rawValue) {
		if (rawValue == null || rawValue.trim().isEmpty()) {
			return DEFAULT_COLLINEAR_TOLERANCE_M;
		}

		try {
			double parsed = Double.parseDouble(rawValue.trim());
			return parsed > 0 ? parsed : 0.0;
		} catch (NumberFormatException nfe) {
			return 0.0;
		}
	}

}
