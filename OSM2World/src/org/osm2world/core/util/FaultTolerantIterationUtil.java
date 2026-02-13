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
		int exceptionCount = 0;
		int suppressedExceptionCount = 0;
		
		for (T input : collection) {
			try {
				operation.perform(input);
			} catch (Exception e) {
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
			}
		}

		IgnoredExceptionLog.logSummary("FaultTolerantIterationUtil.iterate",
				exceptionCount, suppressedExceptionCount);
		
	}
	
}
