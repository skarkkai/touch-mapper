## 1. Classification principle (non-negotiable)

OSM’s raw ontology is **too flat** and **too verbose** for users.
UI should *not* mirror OSM tags; it should **collapse them into tactile-meaningful classes**.

The guiding question for every class:

> “Does this feature change how a blind user mentally models space or navigates it?”

If no → de-emphasize or omit.

You want **few top-level classes**, each with **subclasses only where behavior differs**.

---

## 2. Core feature classes the UI must distinguish

### A. Linear features (“ways”, but semantically split)

These are *orientation and connectivity carriers*. They matter a lot.

#### A1. Roads (vehicular)

OSM basis: `highway=*` (subset)

Subclasses (ordered by importance):

* **Major roads**

  * `motorway`, `trunk`, `primary`
* **Secondary roads**

  * `secondary`, `tertiary`
* **Local streets**

  * `residential`, `unclassified`, `living_street`
* **Service roads**

  * `service`, `driveway`, `parking_aisle`

---

#### A2. Pedestrian / non-vehicular paths

OSM: `highway=footway|path|cycleway|steps|pedestrian`

Subclasses:

* **Pedestrian streets** (`pedestrian`)
* **Footpaths / trails** (`footway`, `path`)
* **Cycleways** (`cycleway`)
* **Steps / ramps** (`steps`)

---

#### A3. Rail infrastructure

OSM: `railway=*`

Subclasses:

* **Rail lines** (`rail`)
* **Tram/light rail**
* **Subway / metro**
* **Rail yards / sidings** (usually omit unless dominant)

---

#### A4. Waterways (linear)

OSM: `waterway=*`

Subclasses:

* **Rivers**
* **Streams / canals**
* **Ditches / drains** (usually omit)

---

### B. Areal features (polygons, but semantic first)

These shape space more than they connect it.

#### B1. Water bodies (areas)

OSM: `natural=water`, `water=*`

Subclasses:

* Lakes
* Ponds
* Reservoirs
* Sea / coastline


---

#### B2. Green / open areas

OSM: `landuse=grass|forest|meadow|recreation_ground`, `leisure=park`

Subclasses:

* **Parks / recreational areas**
* **Forests**
* **Fields / open land**


---

#### B3. Built-up areas (non-building)

OSM: `landuse=residential|commercial|industrial`

Subclasses:

* Residential
* Commercial
* Industrial

---

### C. Buildings (this needs real thought)

Buildings should **not** be one class.

#### C1. Landmark buildings

OSM: `amenity=*`, `building=*` with strong semantics

Examples:

* Church
* School
* Hospital
* Station
* Mall
* Stadium
* Government buildings

---

#### C2. Functional public buildings

Examples:

* Libraries
* Post offices
* Community centers
* Universities


---

#### C3. Generic buildings

OSM: `building=yes` with no special tags

---

### D. POIs (points, but ranked hard)

POIs are where most systems go wrong by listing too much.

#### D1. Transport POIs (high priority)

OSM: `amenity=bus_stop`, `railway=station`, `public_transport=*`

---

#### D2. Civic & essential services

Examples:

* Police
* Fire station
* Hospital
* Pharmacy

---

#### D3. Commercial POIs

Examples:

* Shops
* Cafes
* Restaurants
* Supermarkets

---

#### D4. Leisure / cultural POIs

Examples:

* Museums
* Cinemas
* Sports facilities

---

### E. Boundaries and edges (often ignored, but crucial)

OSM:

* `boundary=*`
* map bbox itself

Subclasses:

* Administrative boundaries
* Coastlines
* Fences / walls (if tactually represented)
