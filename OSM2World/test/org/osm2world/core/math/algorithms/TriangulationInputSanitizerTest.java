package org.osm2world.core.math.algorithms;

import static java.util.Collections.emptyList;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import org.junit.Test;
import org.osm2world.core.math.SimplePolygonXZ;
import org.osm2world.core.math.TriangleXZ;
import org.osm2world.core.math.VectorXZ;

public class TriangulationInputSanitizerTest {

	@Test
	public void nearCollinearChainGetsSimplifiedAtOneCentimeter() {

		SimplePolygonXZ polygon = building364Outline();

		TriangulationInputSanitizer.SanitizedPolygonData sanitized =
				TriangulationInputSanitizer.sanitize(polygon, emptyList(), 0.01);

		assertEquals(7, sanitized.getRemovedOuterVertices());
		assertEquals(8, sanitized.getOuterPolygon().size());
	}

	@Test
	public void smallerToleranceKeepsMostVertices() {

		SimplePolygonXZ polygon = building364Outline();

		TriangulationInputSanitizer.SanitizedPolygonData sanitized =
				TriangulationInputSanitizer.sanitize(polygon, emptyList(), 0.001);

		assertEquals(2, sanitized.getRemovedOuterVertices());
		assertEquals(13, sanitized.getOuterPolygon().size());
	}

	@Test
	public void disabledSimplificationKeepsOriginalPolygon() {

		SimplePolygonXZ polygon = building364Outline();

		TriangulationInputSanitizer.SanitizedPolygonData sanitized =
				TriangulationInputSanitizer.sanitize(polygon, emptyList(), 0.0);

		assertSame(polygon, sanitized.getOuterPolygon());
		assertEquals(0, sanitized.getRemovedTotalVertices());
	}

	@Test
	public void invalidSimplificationFallsBackToOriginalRing() {

		SimplePolygonXZ polygon = new SimplePolygonXZ(loop(Arrays.asList(
				new VectorXZ(0, 0),
				new VectorXZ(4, 0),
				new VectorXZ(4, 4),
				new VectorXZ(3, 4),
				new VectorXZ(3, 1),
				new VectorXZ(1, 1),
				new VectorXZ(1, 4),
				new VectorXZ(0, 4)
		)));

		TriangulationInputSanitizer.SanitizedPolygonData sanitized =
				TriangulationInputSanitizer.sanitize(polygon, emptyList(), 3.0);

		assertSame(polygon, sanitized.getOuterPolygon());
		assertEquals(1, sanitized.getFallbackRingCount());
		assertEquals(0, sanitized.getRemovedTotalVertices());
	}

	@Test
	public void building364RegressionAvoidsSliverTrianglesByDefaultTolerance() {

		SimplePolygonXZ polygon = building364Outline();

		List<TriangleXZ> legacyTriangles = TriangulationUtil.triangulate(
				polygon, emptyList(), emptyList(), 0.0);
		double legacyMinArea = minArea(legacyTriangles);
		assertTrue("legacy min area should include slivers", legacyMinArea < 0.01);

		List<TriangleXZ> fixedTriangles = TriangulationUtil.triangulate(
				polygon, emptyList(), emptyList(), 0.01);
		double fixedMinArea = minArea(fixedTriangles);
		assertTrue(
				"fixed min area should avoid sliver triangles, got " + fixedMinArea,
				fixedMinArea >= 0.01);
	}

	private static SimplePolygonXZ building364Outline() {
		return new SimplePolygonXZ(loop(Arrays.asList(
				new VectorXZ(-16.273, -24.972),
				new VectorXZ(-19.639, -6.672),
				new VectorXZ(-16.047, -6.004),
				new VectorXZ(-20.484, 18.119),
				new VectorXZ(-13.134, 19.477),
				new VectorXZ(-12.438, 15.704),
				new VectorXZ(-11.321, 9.626),
				new VectorXZ(-10.183, 3.447),
				new VectorXZ(-9.067, -2.608),
				new VectorXZ(-8.619, -5.057),
				new VectorXZ(-12.344, -5.748),
				new VectorXZ(-11.636, -9.588),
				new VectorXZ(-10.498, -15.766),
				new VectorXZ(-9.382, -21.855),
				new VectorXZ(-9.05, -23.637)
		)));
	}

	private static List<VectorXZ> loop(List<VectorXZ> vertices) {
		List<VectorXZ> loop = new ArrayList<VectorXZ>(vertices.size() + 1);
		loop.addAll(vertices);
		loop.add(vertices.get(0));
		return loop;
	}

	private static double minArea(List<TriangleXZ> triangles) {
		double minArea = Double.MAX_VALUE;
		for (TriangleXZ triangle : triangles) {
			minArea = Math.min(minArea, triangle.getArea());
		}
		return minArea;
	}

}
