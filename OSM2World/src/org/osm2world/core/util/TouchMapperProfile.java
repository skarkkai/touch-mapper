package org.osm2world.core.util;

import java.util.Locale;

/**
 * Minimal opt-in profiling helper for Touch Mapper performance analysis.
 *
 * Enable by setting TOUCH_MAPPER_PROFILE=1 (or true/yes/on).
 */
public final class TouchMapperProfile {

	private static final boolean ENABLED = parseEnabled(
			System.getenv("TOUCH_MAPPER_PROFILE"));

	private TouchMapperProfile() { }

	private static boolean parseEnabled(String rawValue) {
		if (rawValue == null) {
			return false;
		}
		String value = rawValue.trim().toLowerCase(Locale.US);
		return "1".equals(value)
				|| "true".equals(value)
				|| "yes".equals(value)
				|| "on".equals(value);
	}

	public static boolean isEnabled() {
		return ENABLED;
	}

	public static long start() {
		return ENABLED ? System.nanoTime() : 0L;
	}

	public static void logMillis(String label, long startNanos) {
		if (!ENABLED) {
			return;
		}
		long elapsedNanos = System.nanoTime() - startNanos;
		logNanosAsMillis(label, elapsedNanos);
	}

	public static void logNanosAsMillis(String label, long nanos) {
		if (!ENABLED) {
			return;
		}
		System.err.println(String.format(Locale.US,
				"TM_PROFILE %s %.3f", label, nanos / 1000000.0));
	}

	public static void logValue(String label, Object value) {
		if (!ENABLED) {
			return;
		}
		System.err.println("TM_PROFILE " + label + " " + String.valueOf(value));
	}

}
