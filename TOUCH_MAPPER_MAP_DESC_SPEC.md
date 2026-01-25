# Specification: Textual Map Description for Touch Mapper

## High level design

### 1) Purpose and scope

Add a textual description panel next to the map preview and/or generated output. The description must:

* Help a blind/tactile user build an accurate mental model of the map content.
* Help any user validate that the selected area and included features match intent.
* Be consistent with the tactile geometry that will be produced (i.e., same inclusion/exclusion choices).
* Be copyable and suitable for bug reports / support.

Out of scope (v1):

* Turn-by-turn navigation instructions (“go 200m then left…”)
* Personalized directions from a user location
* NLP chatty summaries; the output is structured, not poetic.

---

### 2) Inputs

The feature consumes a **semantic input bundle** generated alongside the map geometry by OMS2World. Minimum required:

**Required**

* Bounding box / extents in local coordinates (`minX`, `minZ`, `maxX`, `maxZ`)
* “Ways” (roads/paths) represented as polylines (`points`), with per-way `totalLength`, and a label/name when available
* POIs represented as points (`centerPoint`) with type/category and optional name/label

**Optional (may be derived)**

* Intersections (road–road junctions), with which ways meet and approximate location
* Border crossings (where a way exits the map area), with which border edge (N/E/S/W) and which way
* Feature classes beyond roads + POIs (water, parks, buildings) if available later

---

### 3) Outputs

The system produces:

1. **Human-readable description text** (primary)
2. **Structured description object** (secondary, for future + debugging), e.g. JSON with the same content sections and computed facts.

The human text must be generated deterministically from the structured description (so it’s stable, diffable, and testable).

---

### 4) Where it appears in the product

* On the results page where the map preview is shown.
* On the final/download page for the generated map.
* In exported formats (optional in v1): include as downloadable `.txt` and as embedded metadata in the output package if such a package exists.

UI requirements:

* Visible by default (collapsed allowed if space-constrained).
* “Copy” button copies the full description text.
* “Download description” optional.
* A “Detail level” control: **Compact** vs **Detailed** (v1 supports both).

Accessibility requirements:

* Fully readable by screen readers.
* Keyboard accessible controls.
* No information conveyed only by visual cues (“left side”, “looks like”), unless also given in cardinal directions.

---

### 5) Description style rules

Hard rules:

* Prefer **cardinal directions** (north/south/east/west) and **relative relations** (“north of”, “intersects”, “parallel to”) over “left/right/top/bottom”.
* Include **quantities**: counts, approximate lengths, and density cues.
* Be explicit about **unknown / omitted** content when relevant (e.g., “Unnamed paths are included” vs “Only named roads included”).
* Avoid subjective words (“nice”, “pleasant”, “busy”) unless backed by a metric (“dense network: 9 roads and 14 intersections”).

Tone:

* Neutral, technical, readable.
* No flowery prose.

Units:

* Use meters and kilometers, rounded appropriately.

Rounding guidelines:

* Distances < 200 m: round to nearest 10 m
* 200–2000 m: round to nearest 50 m
* > 2 km: round to nearest 0.1 km

---

### 6) Content structure (human text)

The description is organized into sections. The exact section set depends on available data.

#### 6.1 Header

* Map title (if user supplied a label)
* Date/time generated (optional, but helpful)
* Area extents:

  * “Map covers approximately **W × H meters**.”
  * Optionally: “North is up” (if that’s always true)

#### 6.2 Summary

A 3–6 line executive summary:

* Feature counts:

  * “Roads/paths: N (named: A, unnamed: B)”
  * “POIs: N (by category…)”
  * “Intersections: N” (if computed)
* One-sentence shape of the network:

  * “One main north–south route crosses the area; two shorter east–west streets intersect it.”

#### 6.3 Roads and paths

List **key ways**, ordered by salience:

* Salience scoring (v1):

  * longer length = more salient
  * named > unnamed
  * more intersections = more salient
* For each key way (top K, default K=5 in compact, K=10 in detailed):

  * Name (or “Unnamed path #i”)
  * Approx length
  * Dominant orientation (N–S / E–W / diagonal / curved)
  * Relationship notes:

    * “crosses the map” (if border crossings exist)
    * “intersects with X and Y” (top 2–3 intersections)
* Then: “Other shorter roads/paths: … count”

#### 6.4 Intersections (if available)

Compact:

* “Key intersections: A–B near center; A–C in northwest…”

Detailed:

* List intersections ordered by salience:

  * degree (3-way/4-way)
  * involvement of salient roads
* For each:

  * roads involved
  * approximate location relative to map center: “northwest of center”, plus optional distance bands (“~60 m north of center”)

#### 6.5 POIs (if available)

Grouped by category (e.g., bus stops, stations, etc.):

* Count per category
* List named POIs first
* Provide relative location (“near east edge”, “south of Road A” if nearest-road relation computed)

If many POIs:

* Compact: show top N (e.g., 8), then “and X more”
* Detailed: show all, but allow collapsible group sections

#### 6.6 Edge crossings (optional but valuable)

If border crossing data exists (or is derived):

* “These roads/paths continue beyond the map area: Road A exits north and south edges; Unnamed path #2 exits east edge…”

This is tactually important: it tells the user whether a line is a “dead end” vs “continues off map.”

#### 6.7 Data limitations / omissions

A short “Notes” section, generated only when relevant:

* “Some roads are unnamed in OSM and are listed as Unnamed.”
* “At this scale, minor footpaths may be omitted.” (Only if you can justify from settings/filters)
* “Intersections are approximated with tolerance X.” (only if computed)

---

### 7) Derived computations (semantic enrichment)

Even if OSM2World doesn’t provide these, the system may compute them from polylines and bbox.

#### 7.1 Cardinal direction mapping

Define coordinate system mapping (must be consistent with how the map is oriented for the user).

* Establish which axis corresponds to east/west and north/south.
* “North is up” assumption must be explicit.

#### 7.2 Orientation of a way

Compute dominant heading from polyline segments:

* segment-length-weighted angle histogram
* classify:

  * N–S if within ±20° of north/south
  * E–W if within ±20° of east/west
  * diagonal if between those
  * curved if no dominant bin > threshold (e.g., 55%)

#### 7.3 Intersection detection

Detect polyline–polyline intersections with tolerance:

* Consider segment–segment intersections
* Merge nearby intersection points within epsilon (e.g., 5–10 m in map coords) to avoid duplicates
* Record:

  * involved ways
  * location point
  * degree (number of ways meeting)

#### 7.4 Border crossings

Intersect each polyline with bbox edges:

* Record per-way which edges are crossed (N/E/S/W)
* If a polyline endpoint is near border (within epsilon), treat as crossing

#### 7.5 Relative-location phrases

Create stable bins:

* Quadrants (NW/NE/SW/SE) based on bbox midpoints
* Edge proximity (“near north edge”) if within 15% of bbox height from edge
* “near center” if within radius threshold (e.g., 15% of min(width,height))

Optional (nice): nearest salient road for POI:

* compute nearest distance from POI to each road polyline
* if within threshold, say “near Road A”

---

### 8) Detail levels

#### Compact

* Header + Summary
* Top 5 ways
* POIs grouped by category, list top ~8
* Intersections count + top 3 key intersections (if available)
* Notes only if needed

#### Detailed

* Everything from compact
* Top 10 ways + “others count”
* Intersections list expanded (up to N or capped)
* Full POI lists by category (collapsible UI recommended)

---

### 9) Internationalization and localization

* The description must be generated from templates with placeholders.
* Unit formatting localized (decimal separator etc.).
* Cardinal directions localized (N/E/S/W equivalents).

v1 requirement: at least English; additional languages optional.

---

### 10) Acceptance criteria (testable)

Given a known metadata fixture, the system must:

* Produce deterministic output (same input ⇒ byte-identical text).
* Include accurate counts for ways and POIs.
* Correctly state map extents within rounding rules.
* For each listed key way, include a length and orientation classification.
* If intersections are enabled, report an intersections count and list at least the top 3 by degree/salience.
* Copy button copies the full text.
* Screen reader reads sections in logical order.

## OSM data

The original input for the whole process is OSM data in format https://wiki.openstreetmap.org/wiki/Overpass_API/Language_Guide

## Processing pipeline

1. OSM data is fetched from OSM servers for the requested areas.

2. OSM data is read by OSM2World, which outputs both files `map.obj` and `map-meta.json`. Modifying OSM2world code so that it outputs suitable map-meta.json is part of this implementation task. map-meta.json contains most of the information received from OSM but in the same coordinates that map.obj uses, and only includes things element types included in map.obj.

3. Browser UI fetches map-meta.json from Touch Mapper S3 bucket, and presents its content to the user in a way described above.
