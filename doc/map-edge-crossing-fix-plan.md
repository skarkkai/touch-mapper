# Plan: describe edge crossings across all visible way segments

Status: deferred; not implemented. Recorded 2026-09-18.

## Problem and intended behavior

`collectEdgeDetails()` in `web/src/scripts/map-desc-ways.js` currently reads only
the first visible segment. Crossings on other segments of the same group can be
omitted from the textual map description.

An uncommitted partial fix was reviewed and reverted: it used all segments only
when the first segment had no edge crossings. That still omitted crossings when
the first segment crossed one edge and another segment crossed a different edge.
It also made the description depend on segment order.

The complete fix should report every map-edge crossing already present in a
group's visible segment events, regardless of segment or geometry-bucket order.
For example, north and south crossings on separate segments should both appear.
This is a UI aggregation fix; no new crossings should be inferred from geometry.

## Implementation

- In `collectEdgeDetails()`, iterate `segmentList(target)` unconditionally.
  Remove the representative-segment restriction and update its comment.
- Preserve existing edge deduplication, north/south/east/west ordering, position
  bucket aggregation, and translated wording. Multiple distinct position buckets
  on one edge should retain the existing "multiple" qualifier; repeated crossings
  in the same bucket should not duplicate the edge or imply multiple positions.
- Remove `primarySegmentInfo()` if it has no remaining callers after the change.
- Preserve route narration: `routeText()` currently describes a route only when
  there is exactly one visible segment. Edge summaries describe the whole group.
- Check the public model-building path, including grouping and `mergedEdgeTexts`
  handling, so merged summaries retain the complete edge information. Preserve
  intentional grouping rules and existing single-segment behavior.
- Update the relevant description behavior documentation. No map-content JSON
  schema, pipeline-stage responsibility, tactile geometry, or translation-key
  changes are expected.

## Small offline regression test

Add a Node test under `test/regression/`, registered in `test/regression/run.py`.
Load the real browser module in a Node VM with minimal browser globals, and assert
the edge sentences returned by its public `buildModel()` API using tiny synthetic
map-content fixtures. Do not export private functions solely for testing.

Cover:

1. First segment has no crossing, second crosses north: north is described.
2. First segment crosses north, second crosses south: both are described.
3. Reverse segment and geometry-bucket order: edge sentences remain identical.
4. Repeated crossings of the same edge and position: one edge/position description.
5. Different positions on the same edge: existing multiple-position wording.
6. Single-segment crossings: existing wording and route narration stay intact.
7. No segments, no crossing events, or missing event arrays: no edge sentence and
   no exception. Preserve handling of crossing events without position metadata.
8. A fixture exercising merged/grouped way descriptions retains all relevant edges.

The multi-segment cases must fail against the restored committed implementation;
the north-plus-south case must also fail against the discarded partial fix.

## Acceptance and later rollout

- Run `make test-regression`; keep the combined offline suite under 30 seconds.
- Inspect rendered text through the existing map-description inspection workflow
  for a grouped way with crossings on separate segments. Check supported locales
  using their existing edge and position translations.
- Verify only narration changes: existing map-content data should suffice, without
  converter regeneration or a schema migration.
- Deploy only as a separate, reviewed change through the regression-gated workflow.
  This plan itself does not authorize or perform deployment.
