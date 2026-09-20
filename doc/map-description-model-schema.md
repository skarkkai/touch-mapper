# Map Description Model Schema

This document defines the development-time JSON schema used to inspect map
description outputs without rendering UI.

The schema is produced by:

- `window.TM.mapDescWays.buildModel(...)`
- `window.TM.mapDescAreas.buildModel(...)`
- `window.TM.mapDescription.buildModel(...)`
- `test/map-content/inspect-map-description.js`

## Top-level structure

```json
{
  "roads": "SectionModel",
  "paths": "SectionModel",
  "railways": "SectionModel",
  "waterways": "SectionModel",
  "otherLinear": "SectionModel",
  "buildings": "SectionModel",
  "ui": {
    "sectionHeightNotes": {
      "roads": "string",
      "paths": "string",
      "railways": "string",
      "waterways": "string",
      "otherLinear": "string",
      "buildings": "string",
      "poiFamiliar": "string",
      "poiDaily": "string",
      "poiTransport": "string"
    },
    "buildingsToggle": {
      "hiddenCount": 0,
      "collapsedLabel": "string",
      "expandedLabel": "string"
    }
  }
}
```

`roads` and `buildings` are always present in UI. `paths`, `railways`,
`waterways`, and `otherLinear` are hidden in UI when empty.

`ui.buildingsToggle` is `null` when the section does not need a show-more
toggle.

`ui.sectionHeightNotes` contains one localized note string per map-content
section heading (for example raised mm, waved surface, or varying raised
amounts).

## `SectionModel`

```json
{
  "items": ["ItemModel"],
  "emptyMessage": "string or null",
  "count": 0
}
```

- `items` contains render-ready items for that section.
- `emptyMessage` is used when `count` is `0`.
- `count` is the number of non-empty section items.

## `ItemModel`

```json
{
  "type": "way | building | summary | message",
  "attrs": {
    "dataOsmId": "optional string",
    "dataUnnamedSurface": "optional string",
    "filterRefs": ["way:123", "poi:node:456"],
    "initiallyHidden": "optional boolean"
  },
  "lines": ["LineModel"]
}
```

Notes:

- `type="summary"` is currently used for unnamed-way aggregate rows.
- `type="message"` is used for section-level fallback text items.
- `attrs.initiallyHidden=true` marks building items hidden behind the
  show-more toggle in initial state.
- `attrs.filterRefs` lists the filter identities represented by a selectable result-page entry. Aggregated entries contain every contributing identity. Ordinary features use `node:<id>`, `way:<id>`, or `relation:<id>`. `poi:` references suppress text-only POI entries during metadata grouping while retaining any shared physical object. Empty messages and non-feature notes have no filter references.
- Generated coastal water areas use `coastline:<sha256>` rather than their synthetic OSM relation ID. OSM2World writes their `filterRefs` into raw area metadata; metadata enrichment and the final `map-content.json` area items preserve it, and the UI uses it in preference to `osmType`/`osmId`. The hash covers sorted, undirected polygon edges with outer/inner roles, so ring ordering and synthetic IDs do not affect identity. These references refer to the retained source geometry and are applied during OSM2World map creation before rendering.

## `LineModel`

```json
{
  "className": "optional string",
  "parts": [
    {
      "text": "string",
      "className": "optional string",
      "wrap": true
    }
  ]
}
```

- `className` maps to the corresponding line-level CSS class in rendered UI.
- `parts` preserves text segmentation and style classes for inline spans.
- `wrap=false` means the text fragment is rendered as raw inline text (no span).


## Existing building groups

Building groups with multiple members display a localized count/type heading,
every distinct member location and edge-contact phrase, and summed member
coverage (rounded once for display). Missing or invalid member coverage omits
the total rather than showing a partial sum. Group descriptions do not display
single-building shape, orientation or component-count details. Individual
filter identities and converter group membership remain unchanged; this does
not merge additional buildings by address. Singleton and water-area descriptions
retain their existing behavior. Coverage values supplied by the converter are
already rounded; the UI does not infer additional precision or union geometry.

## Road naming and content mode

All supported linear-way type labels have counted plural forms in every locale,
injected through the result-page template. Connection counts use those forms
instead of the generic “ways of type” fallback (reserved for unknown types).
Finnish uses counted partitive forms; Finnish and German connection-count phrases
use a “Connections:” construction to avoid incompatible grammatical cases.

Road entries prioritize map-border crossings for their location description:

- Two or more crossing events: report only the border edges and their position
  qualifiers; omit internal segment location clauses.
- One crossing event: report that border location plus distinct in-map terminal
  locations, each labelled `Endpoint`. A terminal can be a dead end or a segment
  endpoint junction with no continuation into another member of the same road
  group. Intermediate junctions and same-road splits are omitted. For branching
  roads, retain all known terminal locations. Missing endpoint data contributes
  no invented endpoint.
- No crossings: retain the segment-based location description below.

Repeated source-segment events are deduplicated before counting crossings. Two
contacts on the same edge still count separately; a corner contact counts once
while contributing both adjacent edges to the crossing sentence. This selection
uses existing `visibleGeometry[].segments[].events` metadata (`t`, `type`, `zone`,
`edge`, `edges`, `connections`) and does not change the converter JSON schema.

Other individual linear-feature entries describe every visible segment using the existing
localized location phrases, joined with semicolons and deduplicated in source order.
Deduplication uses unordered structured endpoint-location pairs, not translated
text; the first pair's direction is retained. Standalone locations are omitted
when already covered by a retained pair. Distinct unrelated locations remain.
Edge-crossing descriptions collect all visible segments, deduplicating edges and
combining their position qualifiers. No geometric connectivity reconstruction is performed.
Unnamed road/path aggregate summaries remain unchanged.

### Roundabout connections

Junction `connections[]` retain the physical `osmType`, `osmId`, `name`, and
`subClass`. A member of a connected `junction=roundabout` component additionally
has `roundabout: {id, name}`. The ID is `roundabout:way:<representative-osm-id>`,
using the lexicographically smallest member ID; it is deterministic for the same
source ways, independent of iteration order. The name is the sole distinct
nonblank roundabout-member name, or `null` when absent or conflicting.

The metadata renderer groups roundabout source centerlines at shared coordinates,
before clipping affects connection visibility. Ordinary approach roads never
join components. Only visible contacts become junction events. A contact between
a roundabout and an approach can supply an inferred junction when explicit
connector metadata is absent, even when the roundabout is unnamed.

The UI counts roundabout connections by this shared ID, not by member way ID or
translated label. It emits named or counted unnamed-roundabout phrases, excluding
those same contacts from generic road counts. It does not infer connections
between roads on opposite sides of a roundabout or borrow approach-road names.
Physical way IDs and map-content filtering references remain unchanged.

### Semantic grouping boundary

Browser selectors choose small location, route, edge-contact, coverage, and POI
type descriptions before their formatters produce `LineModel.parts[].text`.
The same selected values supply explicit-field JSON keys for semantic equality;
neither complete input records nor rendered sentences are compared. This is
browser-only state: the `map-content.json` schema and converter stages are unchanged.

- Route pairs and sets of selected route/edge facts compare without regard to
  input order. The first retained route direction still supplies the wording.
  A known start with an unknown end retains only the start location; no route
  is inferred. Unknown locations do not supply a generic merge identity.
- First-stage unnamed linear merging includes the source subclass, selected
  routes and edge qualifiers. Railways ignore length; other linear types use
  the numeric displayed-meter bucket: nearest meter below 100 m, nearest 5 m
  below 1000 m, nearest 10 m thereafter. A bucket is the rounded value itself,
  so 99.6 m and 100.2 m both have identity 100. Formatting uses this same
  function; totals sum the unformatted source measurements. Missing/nonpositive
  lengths do not supply a first-stage merge bucket.
- The existing broad unnamed-waterway summary category still groups by selected
  route/location, across waterway subtypes. Counts retain the existing post-merge
  entry convention; lengths and filtering references include all contributors.
  Its existing title-plus-route output remains unchanged: unlike individual
  linear entries, the aggregate does not narrate edge crossings.
- Localized source names remain presentation values. The browser preserves
  the original source label when localizing a payload so that locale changes
  cannot merge distinct named groups or discard named connection facts. Area
  namedness also uses those original fields: a translated name matching an
  unnamed placeholder must not make a named area eligible for aggregation.
- Area coverage equality compares only the selected sentence kind and regions,
  not the input weights. Dominant/secondary regions retain their roles; region
  sets in the other multi-region descriptions compare without input order.
  A selected single region and an equivalent fallback location compare equally.
  Selection thresholds and fallback priorities are unchanged.
- Building-member edge contacts compare explicit edge, position qualifier, and
  unrounded percentage fields. Unknown measurements remain distinct from zero;
  two distinct measurements survive even if their formatted percentages match.
  Contacts are never summed or geometrically unioned.
- The existing POI payload encodes its untranslated source type qualifier in
  the converter's `displayLabel` prefix; there is no separate amenity/shop/type
  field in those records. The input adapter extracts that source token before
  localization, and uses it for type identity. Translated type labels and
  location sentences never become keys. Missing meaningful types or locations
  cannot establish equality between independently supplied POI groups.

Missing structured information leaves an item separate rather than using
translated text as a fallback identity. Existing source OSM filter references
are carried through aggregation; description keys do not replace them.

Existing area-aggregation limitations remain intentionally unchanged: unnamed
water-area summaries span source subtypes, use each group's primary member for
coverage aggregation, and retain the maximum percentage per edge rather than
unioning spans. Their aggregated edge positions are not inferred from coverage.
The current coverage-selector priority also classifies a 50/50 distribution as
distributed before reaching the comparable-region branch; this refactor does
not reorder those rules.

`metadata.requestBody.contentMode` accepts `normal`, `no-buildings`,
`only-big-roads`, and `only-named-roads`. The named-roads mode is applied to OSM
before geometry generation; descriptions must not filter features independently.

Linear way records and their groups carry `isNamed` (boolean). Individual way
records also carry `nameTags`, an object of trimmed, nonblank `name`, `name:*`,
`loc_name`, and `short_name` values. `label` is the resolved name or null;
`displayLabel` includes presentation modifiers. Consumers must not infer namedness
from `displayLabel` or the `(unnamed)` placeholder. A literal name `(unnamed)` is valid.

Default resolution: `name`, then any `name:*` value in ascending tag-key order,
then `loc_name`, then `short_name`. Browser resolution first tries the UI locale,
its base language, and a regional variant of that base language (ascending key
order), then the default resolution. All languages qualify; `ref`, `alt_name`,
`official_name`, and relation-only names do not. Blank values never prevent fallback.
A grouped road uses a localized name only when every member resolves to the same
name; otherwise its default group name is retained.

The Python resolver is `converter/map_desc/road_names.py`; the JavaScript resolver
is `converter/road-names.js`, included in the browser bundle by `web/build.js` and
packaged with the converter. Shared regression fixtures verify parity.

### Physical dimensions in request metadata

`metadata.requestBody.printWidthCm` and `printHeightCm` are independent finite,
physical dimensions in centimeters, each from 1 to 99.9 inclusive. `scale` remains
one scalar. `effectiveArea` holds the actual rectangular geographic bounds.
New requests no longer store scalar `size` or `diameter`; legacy saved square
maps containing `size` remain readable by the browser. A partial explicit pair
is invalid, even if a legacy `size` also exists. Section identities, textual
feature semantics, and tactile height/width encodings are unchanged.
