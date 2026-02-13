package org.osm2world.core.util;

/**
 * utility class that allows iterations where Exceptions in the processing
 * of a single element don't cause program failure
 */
final public class FaultTolerantIterationUtil {

	private FaultTolerantIterationUtil() { }
	
	public static interface Operation<T> {
		public void perform(T input);
	}
	
	public static final <T> void iterate(
			Iterable<? extends T> collection, Operation<T> operation) {

		long totalStart = TouchMapperProfile.start();
		int itemCount = 0;
		int exceptionCount = 0;
		int suppressedExceptionCount = 0;
		long exceptionLoggingNanos = 0;
		
		for (T input : collection) {
			itemCount++;
			try {
				operation.perform(input);
			} catch (Exception e) {
				long catchStart = TouchMapperProfile.start();
				exceptionCount++;
				if (IgnoredExceptionLog.shouldLogDetailed(exceptionCount)) {
					IgnoredExceptionLog.logDetailed(e, input);
				} else {
					if (suppressedExceptionCount == 0) {
						IgnoredExceptionLog.logSuppressionNotice(
								"FaultTolerantIterationUtil.iterate");
					}
					suppressedExceptionCount++;
				}
				if (TouchMapperProfile.isEnabled()) {
					exceptionLoggingNanos += (System.nanoTime() - catchStart);
				}
			}
		}

		IgnoredExceptionLog.logSummary("FaultTolerantIterationUtil.iterate",
				exceptionCount, suppressedExceptionCount);

		if (TouchMapperProfile.isEnabled() && exceptionCount > 0) {
			TouchMapperProfile.logValue("fault_tolerant_iterate.items", itemCount);
			TouchMapperProfile.logValue("fault_tolerant_iterate.exceptions",
					exceptionCount);
			TouchMapperProfile.logValue(
					"fault_tolerant_iterate.suppressed_exceptions",
					suppressedExceptionCount);
			TouchMapperProfile.logNanosAsMillis(
					"fault_tolerant_iterate.exception_logging_ms",
					exceptionLoggingNanos);
			TouchMapperProfile.logMillis("fault_tolerant_iterate.total_ms", totalStart);
		}
		
	}
	
}
