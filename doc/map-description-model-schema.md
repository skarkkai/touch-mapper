# Map Description Model Schema

This document defines the development-time JSON schema used to inspect map
description outputs without rendering UI.

The schema is produced by:

- `window.TM.mapDescWays.buildModel(...)`
- `window.TM.mapDescAreas.buildModel(...)`
- `window.TM.mapDescription.buildModel(...)`
- `test/scripts/inspect-map-description.js`

## Top-level structure

```json
{
  "ways": "SectionModel",
  "buildings": "SectionModel",
  "ui": {
    "buildingsToggle": {
      "hiddenCount": 0,
      "collapsedLabel": "string",
      "expandedLabel": "string"
    }
  }
}
```

`ui.buildingsToggle` is `null` when the section does not need a show-more
toggle.

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
