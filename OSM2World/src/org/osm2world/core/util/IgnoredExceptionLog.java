package org.osm2world.core.util;

/**
 * Helper for controlled logging of repeatedly ignored exceptions.
 *
 * By default, only the first few stack traces are printed and the rest are
 * summarized to reduce stderr overhead in large conversion runs.
 */
public final class IgnoredExceptionLog {

	private static final String MAX_DETAILED_ENV =
			"TOUCH_MAPPER_MAX_IGNORED_EXCEPTIONS_LOGGED";

	private static final int DEFAULT_MAX_DETAILED = 3;

	private static final int maxDetailedExceptions = parseMaxDetailed(
			System.getenv(MAX_DETAILED_ENV));

	private IgnoredExceptionLog() { }

	private static int parseMaxDetailed(String rawValue) {
		if (rawValue == null || rawValue.trim().isEmpty()) {
			return DEFAULT_MAX_DETAILED;
		}
		try {
			return Integer.parseInt(rawValue.trim());
		} catch (NumberFormatException nfe) {
			return DEFAULT_MAX_DETAILED;
		}
	}

	public static int getMaxDetailedExceptions() {
		return maxDetailedExceptions;
	}

	public static boolean shouldLogDetailed(int oneBasedExceptionIndex) {
		return maxDetailedExceptions < 0
				|| oneBasedExceptionIndex <= maxDetailedExceptions;
	}

	public static void logDetailed(Exception e, Object input) {
		System.err.println("ignored exception:");
		e.printStackTrace();
		System.err.println("this exception occurred for the following input:\n"
				+ input);
	}

	public static void logSuppressionNotice(String context) {
		if (maxDetailedExceptions == 0) {
			System.err.println(
					"ignored exceptions in " + context
					+ " are summarized (no stack traces).");
		} else {
			System.err.println(
					"ignored exceptions in " + context
					+ ": showing first " + maxDetailedExceptions
					+ " stack traces; suppressing the rest.");
		}
	}

	public static void logSummary(String context, int totalExceptions,
			int suppressedExceptions) {
		if (totalExceptions <= 0) {
			return;
		}
		if (suppressedExceptions > 0) {
			System.err.println(
					"ignored exception summary (" + context + "): total="
					+ totalExceptions + ", suppressed=" + suppressedExceptions);
		} else {
			System.err.println(
					"ignored exception summary (" + context + "): total="
					+ totalExceptions);
		}
	}

}
