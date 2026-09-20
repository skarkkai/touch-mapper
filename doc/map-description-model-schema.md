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


## Road naming and content mode

Individual linear-feature entries describe every visible segment using the existing
localized location phrases, joined with semicolons and deduplicated in source order.
Deduplication uses unordered structured endpoint-location pairs, not translated
text; the first pair's direction is retained. Standalone locations are omitted
when already covered by a retained pair. Distinct unrelated locations remain.
Edge-crossing descriptions collect all visible segments, deduplicating edges and
combining their position qualifiers. No connectivity reconstruction is performed.
Unnamed road/path aggregate summaries remain unchanged.

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
