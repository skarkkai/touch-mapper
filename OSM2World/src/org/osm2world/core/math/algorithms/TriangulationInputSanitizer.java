package org.osm2world.core.math.algorithms;

import static org.osm2world.core.math.GeometryUtil.distanceFromLineSegment;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.List;

import org.osm2world.core.math.InvalidGeometryException;
import org.osm2world.core.math.LineSegmentXZ;
import org.osm2world.core.math.SimplePolygonXZ;
import org.osm2world.core.math.VectorXZ;
import org.osm2world.core.util.TouchMapperProfile;
import org.osm2world.core.util.TriangulationConfig;

/**
 * Removes near-collinear vertices from triangulation inputs.
 *
 * This improves triangulation robustness for source data that contains
 * very small kinks or almost-straight vertex chains.
 */
public final class TriangulationInputSanitizer {

	public static final class SanitizedPolygonData {
		private final SimplePolygonXZ outerPolygon;
		private final List<SimplePolygonXZ> holes;
		private final int removedOuterVertices;
		private final int removedHoleVertices;
		private final int fallbackRings;

		private SanitizedPolygonData(
				SimplePolygonXZ outerPolygon,
				List<SimplePolygonXZ> holes,
				int removedOuterVertices,
				int removedHoleVertices,
				int fallbackRings) {
			this.outerPolygon = outerPolygon;
			this.holes = holes;
			this.removedOuterVertices = removedOuterVertices;
			this.removedHoleVertices = removedHoleVertices;
			this.fallbackRings = fallbackRings;
		}

		public SimplePolygonXZ getOuterPolygon() {
			return outerPolygon;
		}

		public List<SimplePolygonXZ> getHoles() {
			return holes;
		}

		public int getRemovedOuterVertices() {
			return removedOuterVertices;
		}

		public int getRemovedHoleVertices() {
			return removedHoleVertices;
		}

		public int getRemovedTotalVertices() {
			return removedOuterVertices + removedHoleVertices;
		}

		public int getFallbackRingCount() {
			return fallbackRings;
		}
	}

	private static final class RingSimplifyResult {
		private final SimplePolygonXZ polygon;
		private final int removedVertices;
		private final boolean fellBackToOriginal;

		private RingSimplifyResult(
				SimplePolygonXZ polygon,
				int removedVertices,
				boolean fellBackToOriginal) {
			this.polygon = polygon;
			this.removedVertices = removedVertices;
			this.fellBackToOriginal = fellBackToOriginal;
		}
	}

	private TriangulationInputSanitizer() { }

	public static SanitizedPolygonData sanitize(
			SimplePolygonXZ outerPolygon,
			Collection<SimplePolygonXZ> holes) {

		double toleranceMeters = TriangulationConfig.getCollinearToleranceMeters();
		SanitizedPolygonData result =
				sanitize(outerPolygon, holes, toleranceMeters);

		if (result.getRemovedTotalVertices() > 0
				|| result.getFallbackRingCount() > 0) {
			TouchMapperProfile.logValue(
					"triangulation.collinear_tolerance_m",
					toleranceMeters);
			TouchMapperProfile.logValue(
					"triangulation.collinear_removed_outer_vertices",
					result.getRemovedOuterVertices());
			TouchMapperProfile.logValue(
					"triangulation.collinear_removed_hole_vertices",
					result.getRemovedHoleVertices());
			TouchMapperProfile.logValue(
					"triangulation.collinear_fallback_rings",
					result.getFallbackRingCount());
		}

		return result;
	}

	static SanitizedPolygonData sanitize(
			SimplePolygonXZ outerPolygon,
			Collection<SimplePolygonXZ> holes,
			double toleranceMeters) {

		if (!(toleranceMeters > 0)) {
			List<SimplePolygonXZ> unchangedHoles =
					new ArrayList<SimplePolygonXZ>(holes);
			return new SanitizedPolygonData(
					outerPolygon, unchangedHoles, 0, 0, 0);
		}

		RingSimplifyResult simplifiedOuter =
				simplifyRing(outerPolygon, toleranceMeters);

		List<SimplePolygonXZ> simplifiedHoles =
				new ArrayList<SimplePolygonXZ>(holes.size());

		int removedHoles = 0;
		int fallbackRings = simplifiedOuter.fellBackToOriginal ? 1 : 0;

		for (SimplePolygonXZ hole : holes) {
			RingSimplifyResult simplifiedHole = simplifyRing(hole, toleranceMeters);
			simplifiedHoles.add(simplifiedHole.polygon);
			removedHoles += simplifiedHole.removedVertices;
			if (simplifiedHole.fellBackToOriginal) {
				fallbackRings += 1;
			}
		}

		return new SanitizedPolygonData(
				simplifiedOuter.polygon,
				simplifiedHoles,
				simplifiedOuter.removedVertices,
				removedHoles,
				fallbackRings);
	}

	private static RingSimplifyResult simplifyRing(
			SimplePolygonXZ originalRing,
			double toleranceMeters) {

		List<VectorXZ> vertices =
				new ArrayList<VectorXZ>(originalRing.getVertices());

		if (vertices.size() <= 3) {
			return new RingSimplifyResult(originalRing, 0, false);
		}

		int removed = 0;
		boolean removedInThisPass = true;

		while (removedInThisPass && vertices.size() > 3) {
			removedInThisPass = false;
			int size = vertices.size();

			for (int i = 0; i < size; i++) {
				VectorXZ previous = vertices.get((size + i - 1) % size);
				VectorXZ current = vertices.get(i);
				VectorXZ next = vertices.get((i + 1) % size);

				double distance = distanceFromLineSegment(
						current, new LineSegmentXZ(previous, next));

				if (distance >= toleranceMeters) {
					continue;
				}

				List<VectorXZ> candidate =
						new ArrayList<VectorXZ>(vertices);
				candidate.remove(i);

				if (candidate.size() < 3) {
					break;
				}

				if (!isValidSimplePolygon(candidate)) {
					// If simplification would break polygon validity,
					// keep the original ring unchanged.
					return new RingSimplifyResult(originalRing, 0, true);
				}

				vertices = candidate;
				removed += 1;
				removedInThisPass = true;
				break;
			}
		}

		if (removed == 0) {
			return new RingSimplifyResult(originalRing, 0, false);
		}

		try {
			return new RingSimplifyResult(
					new SimplePolygonXZ(toLoop(vertices)),
					removed,
					false);
		} catch (InvalidGeometryException e) {
			return new RingSimplifyResult(originalRing, 0, true);
		}
	}

	private static boolean isValidSimplePolygon(List<VectorXZ> vertices) {
		try {
			new SimplePolygonXZ(toLoop(vertices));
			return true;
		} catch (InvalidGeometryException e) {
			return false;
		}
	}

	private static List<VectorXZ> toLoop(List<VectorXZ> vertices) {
		if (vertices.isEmpty()) {
			return Collections.emptyList();
		}
		List<VectorXZ> loop = new ArrayList<VectorXZ>(vertices.size() + 1);
		loop.addAll(vertices);
		loop.add(vertices.get(0));
		return loop;
	}

}
