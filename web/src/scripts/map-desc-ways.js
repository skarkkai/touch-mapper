/* global $ isNaN */
/* eslint quotes:0, space-unary-ops:0, no-alert:0, no-unused-vars:0, no-shadow:0, no-extend-native:0, no-trailing-spaces:0, space-infix-ops:0, camelcase:0, dot-notation:0 */

(function(){
  'use strict';

  function fallbackTranslate(key, fallback) {
    return fallback !== undefined ? fallback : key;
  }

  let translate = fallbackTranslate;

  function setTranslator(helpers) {
    translate = helpers && typeof helpers.t === 'function' ? helpers.t : fallbackTranslate;
  }

  function t(key, fallback) {
    return translate(key, fallback);
  }

  function interpolate(text, replacements) {
    if (!replacements) {
      return text;
    }
    return text.replace(/__([a-zA-Z0-9_]+)__/g, function(match, name) {
      if (replacements[name] === undefined) {
        return match;
      }
      return replacements[name];
    });
  }

  function capitalizeFirst(text) {
    if (!text || typeof text !== 'string') {
      return text;
    }
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function edgeLabel(edge) {
    if (edge === "north") return t("map_content_edge_north", "north");
    if (edge === "south") return t("map_content_edge_south", "south");
    if (edge === "east") return t("map_content_edge_east", "east");
    if (edge === "west") return t("map_content_edge_west", "west");
    return edge;
  }

  function edgePositionBucketFromDirection(edge, direction) {
    if (edge === "east") {
      if (direction === "northeast") return "north";
      if (direction === "east") return "center";
      if (direction === "southeast") return "south";
      return null;
    }
    if (edge === "west") {
      if (direction === "northwest") return "north";
      if (direction === "west") return "center";
      if (direction === "southwest") return "south";
      return null;
    }
    if (edge === "north") {
      if (direction === "northwest") return "west";
      if (direction === "north") return "center";
      if (direction === "northeast") return "east";
      return null;
    }
    if (edge === "south") {
      if (direction === "southwest") return "west";
      if (direction === "south") return "center";
      if (direction === "southeast") return "east";
      return null;
    }
    return null;
  }

  function edgePositionQualifier(position) {
    if (!position) {
      return null;
    }
    if (position === "multiple") return t("map_content_touch_pos_multiple", "in multiple places");
    if (position === "center") return t("map_content_touch_pos_center", "near the center");
    if (position === "north") return t("map_content_touch_pos_north", "in the north");
    if (position === "south") return t("map_content_touch_pos_south", "in the south");
    if (position === "east") return t("map_content_touch_pos_east", "in the east");
    if (position === "west") return t("map_content_touch_pos_west", "in the west");
    return null;
  }

  function directionLabel(direction) {
    if (direction === "north") return t("map_content_dir_north", "north");
    if (direction === "northeast") return t("map_content_dir_northeast", "north-east");
    if (direction === "east") return t("map_content_dir_east", "east");
    if (direction === "southeast") return t("map_content_dir_southeast", "south-east");
    if (direction === "south") return t("map_content_dir_south", "south");
    if (direction === "southwest") return t("map_content_dir_southwest", "south-west");
    if (direction === "west") return t("map_content_dir_west", "west");
    if (direction === "northwest") return t("map_content_dir_northwest", "north-west");
    return direction;
  }

  function cornerLabel(direction) {
    if (direction === "northwest") return t("map_content_corner_northwest", "north-west corner");
    if (direction === "northeast") return t("map_content_corner_northeast", "north-east corner");
    if (direction === "southwest") return t("map_content_corner_southwest", "south-west corner");
    if (direction === "southeast") return t("map_content_corner_southeast", "south-east corner");
    return direction;
  }

  function isCornerDirection(direction) {
    return direction === "northwest" || direction === "northeast" ||
      direction === "southwest" || direction === "southeast";
  }

  /**
   * Location phrase grammar (distance classification only):
   * 1) center, 2) part + dir, 3) near_edge + dir (diagonal near_edge means corner).
   * Forms:
   * - atom: "center", "east part", "north edge", "north-east corner"
   * - clause: "in the center", "in the east part", "near the north edge", "in the north-east corner"
   * - endpoint: "the center", "the east part", "near the north edge", "the north-east corner"
   * Rules:
   * - no "of the map" suffix
   * - avoid duplicated prepositions ("Near near ...", "From in ...") by choosing form per context.
   */
  function locationPhraseFromLoc(loc, form) {
    if (!loc || typeof loc !== 'object') {
      return null;
    }
    const phraseForm = form || "clause";
    const kind = loc.kind;
    const dirLabel = loc.dir ? directionLabel(loc.dir) : null;
    const corner = loc.dir ? cornerLabel(loc.dir) : null;
    const atomCenter = t("map_content_loc_center", "center");
    const clauseCenter = t("map_content_loc_full_center", "in the center");
    const endpointCenter = t("map_content_loc_endpoint_center", "the center");

    if (kind === "center") {
      if (phraseForm === "atom") {
        return atomCenter;
      }
      if (phraseForm === "endpoint") {
        return endpointCenter;
      }
      return clauseCenter;
    }
    if (kind === "part") {
      if (!dirLabel) {
        if (phraseForm === "atom") {
          return atomCenter;
        }
        if (phraseForm === "endpoint") {
          return endpointCenter;
        }
        return clauseCenter;
      }
      const atomPart = interpolate(t("map_content_loc_part", "__dir__ part"), { dir: dirLabel });
      if (phraseForm === "atom") {
        return atomPart;
      }
      if (phraseForm === "endpoint") {
        return interpolate(t("map_content_loc_endpoint_part", "the __dir__ part"), { dir: dirLabel });
      }
      return interpolate(t("map_content_loc_full_part", "in the __dir__ part"), { dir: dirLabel });
    }
    if (kind === "near_edge") {
      if (isCornerDirection(loc.dir)) {
        if (!corner) {
          return null;
        }
        if (phraseForm === "atom") {
          return interpolate(t("map_content_loc_corner", "__corner__"), { corner: corner });
        }
        if (phraseForm === "endpoint") {
          return interpolate(t("map_content_loc_endpoint_corner", "the __corner__"), { corner: corner });
        }
        return interpolate(t("map_content_loc_full_near_corner", "in the __corner__"), { corner: corner });
      }
      if (!dirLabel) {
        return null;
      }
      const atomEdge = interpolate(t("map_content_loc_edge", "__dir__ edge"), { dir: dirLabel });
      if (phraseForm === "atom") {
        return atomEdge;
      }
      return interpolate(
        phraseForm === "endpoint"
          ? t("map_content_loc_endpoint_near_edge", "near the __dir__ edge")
          : t("map_content_loc_full_near_edge", "near the __dir__ edge"),
        { dir: dirLabel }
      );
    }
    return null;
  }

  function joinWithAnd(parts) {
    if (!parts.length) {
      return "";
    }
    if (parts.length === 1) {
      return parts[0];
    }
    if (parts.length === 2) {
      return parts[0] + " and " + parts[1];
    }
    return parts.slice(0, -1).join(", ") + ", and " + parts[parts.length - 1];
  }

  function collectWayGroups(mapContent) {
    const ways = [];
    const classA = mapContent && typeof mapContent === 'object' ? mapContent.A : null;
    const subclasses = classA && Array.isArray(classA.subclasses) ? classA.subclasses : [];

    subclasses.forEach(function(subclass, subclassOrder){
      if (!subclass || subclass.kind !== "linear" || !Array.isArray(subclass.groups)) {
        return;
      }
      subclass.groups.forEach(function(group){
        if (!group || typeof group !== 'object') {
          return;
        }
        ways.push({
          group: group,
          subclassOrder: subclassOrder,
          subclassType: singularSubclassType(subclass.key, subclass.name)
        });
      });
    });

    ways.sort(function(a, b){
      if (a.subclassOrder !== b.subclassOrder) {
        return a.subclassOrder - b.subclassOrder;
      }
      const lengthDiff = wayLengthValue(b.group) - wayLengthValue(a.group);
      if (Math.abs(lengthDiff) > 1e-9) {
        return lengthDiff;
      }
      return wayTitle(a.group).localeCompare(wayTitle(b.group));
    });
    return ways;
  }

  function wayLengthValue(group) {
    const value = group && (group.totalLength !== undefined ? group.totalLength : group.length);
    if (value === null || value === undefined || isNaN(value)) {
      return 0;
    }
    const number = Number(value);
    if (!isFinite(number)) {
      return 0;
    }
    return Math.max(0, number);
  }

  function wayTitle(group) {
    const label = group && (group.displayLabel || group.label);
    if (!label || label === "(unnamed)") {
      return t("map_content_way_unnamed", "Unnamed way");
    }
    return capitalizeFirst(label);
  }

  function wayName(group) {
    const label = group && (group.displayLabel || group.label);
    if (!label || label === "(unnamed)") {
      return null;
    }
    return label;
  }

  function singularSubclassType(subclassKey, fallbackName) {
    const byKey = {
      "A1_road_construction": "road under construction",
      "A1_major_roads": "major road",
      "A1_secondary_roads": "secondary road",
      "A1_local_streets": "local street",
      "A1_service_roads": "service road",
      "A1_track_roads": "track road",
      "A1_vehicle_unspecified": "other vehicular road",
      "A2_pedestrian_streets": "pedestrian street",
      "A2_footpaths_trails": "footpath / trail",
      "A2_cycleways": "cycleway",
      "A2_steps_ramps": "step / ramp",
      "A2_pedestrian_unspecified": "other pedestrian path",
      "A3_rail_lines": "rail line",
      "A3_tram_light_rail": "tram / light rail",
      "A3_subway_metro": "subway / metro",
      "A3_rail_yards_sidings": "rail yard / siding",
      "A4_rivers": "river",
      "A4_streams_canals": "stream / canal",
      "A4_ditches_drains": "ditch / drain",
      "A4_other_waterways": "other waterway",
      "A_other_ways": "other way"
    };
    if (subclassKey && byKey[subclassKey]) {
      return byKey[subclassKey];
    }
    if (!fallbackName || typeof fallbackName !== 'string') {
      return null;
    }
    const name = fallbackName.trim();
    if (!name) {
      return null;
    }
    if (name.endsWith("ies")) {
      return name.slice(0, -3).toLowerCase() + "y";
    }
    if (name.endsWith("s")) {
      return name.slice(0, -1).toLowerCase();
    }
    return name.toLowerCase();
  }

  function formatLength(item) {
    const length = wayLengthValue(item);
    if (!length) {
      return null;
    }
    let rounded = 0;
    if (length >= 1000) {
      rounded = Math.round(length / 10) * 10;
    } else if (length >= 100) {
      rounded = Math.round(length / 5) * 5;
    } else {
      rounded = Math.round(length);
    }
    return interpolate(t("map_content_way_length_m", "__meters__ meters"), { meters: rounded });
  }

  function unnamedRoadsCountText(count) {
    if (count === null || count === undefined || isNaN(count)) {
      return null;
    }
    const rounded = Math.max(0, Math.round(Number(count)));
    if (!rounded) {
      return null;
    }
    const isOne = rounded === 1;
    return interpolate(
      t(
        isOne ? "map_content_unnamed_roads_one" : "map_content_unnamed_roads_many",
        isOne ? "__count__ unnamed road" : "__count__ unnamed roads"
      ),
      { count: rounded }
    );
  }

  function collectSegmentPoints(segment) {
    const points = [];
    const events = segment && Array.isArray(segment.events) ? segment.events : [];
    events.forEach(function(event){
      if (!event || event.zone === undefined || event.zone === null) {
        return;
      }
      const tValue = event.t !== undefined && !isNaN(event.t) ? Number(event.t) : 0;
      points.push({ t: tValue, zone: event.zone });
    });
    if (points.length) {
      points.sort(function(a, b){ return a.t - b.t; });
      return points;
    }

    const samples = segment && Array.isArray(segment.locationSamples) ? segment.locationSamples : [];
    samples.forEach(function(sample){
      if (!sample || sample.zone === undefined || sample.zone === null) {
        return;
      }
      const tValue = sample.t !== undefined && !isNaN(sample.t) ? Number(sample.t) : 0;
      points.push({ t: tValue, zone: sample.zone });
    });
    points.sort(function(a, b){ return a.t - b.t; });
    return points;
  }

  function locationTextFromZone(zone, form) {
    if (zone && typeof zone === 'object') {
      return locationPhraseFromLoc(zone, form) || null;
    }
    return null;
  }

  function segmentList(target) {
    const visibleGeometry = target && Array.isArray(target.visibleGeometry) ? target.visibleGeometry : null;
    if (visibleGeometry) {
      if (!visibleGeometry.length) {
        return [];
      }
      if (visibleGeometry[0] && Array.isArray(visibleGeometry[0].segments)) {
        const flattened = [];
        visibleGeometry.forEach(function(bucket){
          const segments = bucket && Array.isArray(bucket.segments) ? bucket.segments : [];
          segments.forEach(function(segment){
            flattened.push(segment);
          });
        });
        return flattened;
      }
      return visibleGeometry;
    }
    return target && Array.isArray(target.visibleSegments) ? target.visibleSegments : [];
  }

  /**
   * Route line grammar:
   * - single visible location: sentence(clause(loc))
   * - start->end: "From " + endpoint(start) + " to " + endpoint(end)
   * This avoids "Near near ..." and "From in ...".
   */
  function routeText(target) {
    const segments = segmentList(target);
    if (!segments.length) {
      return null;
    }
    const points = collectSegmentPoints(segments[0]);
    if (!points.length) {
      return null;
    }
    const startEndpoint = locationTextFromZone(points[0].zone, "endpoint");
    const endEndpoint = locationTextFromZone(points[points.length - 1].zone, "endpoint");

    if (startEndpoint && endEndpoint && startEndpoint !== endEndpoint) {
      return interpolate(
        t("map_content_way_route_from_to", "From __start__ to __end__"),
        { start: startEndpoint, end: endEndpoint }
      );
    }
    const single = locationTextFromZone(points[0].zone, "clause") || startEndpoint;
    if (single) {
      return interpolate(
        t("map_content_way_route_near", "__location__"),
        { location: single.replace(/[.]+$/, "") }
      );
    }
    return null;
  }

  function collectEdgeDetails(target) {
    const segments = segmentList(target);
    const found = {};
    segments.forEach(function(segment){
      const events = segment && Array.isArray(segment.events) ? segment.events : [];
      events.forEach(function(event){
        if (!event || event.type !== "map_edge_crossing" || !event.edge) {
          return;
        }
        if (!found[event.edge]) {
          found[event.edge] = { edge: event.edge, buckets: {} };
        }
        const zone = event.zone && typeof event.zone === 'object'
          ? (event.zone.loc && typeof event.zone.loc === 'object' ? event.zone.loc : event.zone)
          : null;
        if (!zone || zone.kind !== "near_edge") {
          return;
        }
        const bucket = edgePositionBucketFromDirection(event.edge, zone.dir);
        if (!bucket) {
          return;
        }
        found[event.edge].buckets[bucket] = (found[event.edge].buckets[bucket] || 0) + 1;
      });
    });
    const preferred = ["north", "south", "east", "west"];
    const ordered = [];
    preferred.forEach(function(edge){
      if (found[edge]) {
        ordered.push(found[edge]);
        delete found[edge];
      }
    });
    Object.keys(found).forEach(function(edge){
      ordered.push(found[edge]);
    });
    return ordered.map(function(detail){
      const present = Object.keys(detail.buckets).filter(function(bucket){
        return detail.buckets[bucket] > 0;
      });
      let position = null;
      if (present.length > 1) {
        position = "multiple";
      } else if (present.length === 1) {
        position = present[0];
      }
      return {
        edge: detail.edge,
        position: position
      };
    });
  }

  function edgesText(target) {
    const details = collectEdgeDetails(target);
    if (!details.length) {
      return null;
    }
    const detailTexts = details.map(function(detail){
      const base = edgeLabel(detail.edge) + " edge";
      const qualifier = edgePositionQualifier(detail.position);
      return qualifier ? base + " " + qualifier : base;
    });
    const hasPosition = details.some(function(detail){ return !!detail.position; });
    if (!hasPosition && details.length > 1) {
      return interpolate(t("map_content_touches_edges", "Touches __edges__ edges"), {
        edges: joinWithAnd(details.map(function(detail){ return edgeLabel(detail.edge); }))
      });
    }
    if (details.length === 1) {
      const detail = details[0];
      const base = interpolate(t("map_content_touches_edge", "Touches __edge__ edge"), {
        edge: edgeLabel(detail.edge)
      });
      const qualifier = edgePositionQualifier(detail.position);
      return qualifier ? base + " " + qualifier : base;
    }
    return interpolate(
      t("map_content_touches_items", "Touches __items__"),
      { items: joinWithAnd(detailTexts) }
    );
  }

  function lanesText(item) {
    const sem = item && item.semantics && typeof item.semantics === 'object' ? item.semantics : null;
    const lanes = sem && sem.lanes && typeof sem.lanes === 'object' ? sem.lanes : null;
    const total = lanes ? lanes.total : null;
    if (total === null || total === undefined || isNaN(total)) {
      return null;
    }
    const count = Math.round(Number(total));
    if (!isFinite(count) || count <= 2) {
      return null;
    }
    return interpolate(t("map_content_way_lanes_many", "__count__ lanes"), { count: count });
  }

  function surfacePavingText(item) {
    const klass = surfaceClass(item);
    return surfacePavingTextFromClass(klass);
  }

  function surfaceClass(item) {
    const sem = item && item.semantics && typeof item.semantics === 'object' ? item.semantics : null;
    const surface = sem && sem.surface && typeof sem.surface === 'object' ? sem.surface : null;
    const klass = surface && typeof surface.class === 'string' ? surface.class : null;
    if (klass === "paved") {
      return "paved";
    }
    if (klass === "unpaved") {
      return "unpaved";
    }
    return "unknown";
  }

  function surfacePavingTextFromClass(klass) {
    if (klass === "paved") {
      return t("map_content_way_surface_paved", "Paved surface");
    }
    if (klass === "unpaved") {
      return t("map_content_way_surface_unpaved", "Unpaved surface");
    }
    return t("map_content_way_surface_unknown", "Paving not known");
  }

  function primaryWay(group) {
    const ways = group && Array.isArray(group.ways) ? group.ways : [];
    if (!ways.length) {
      return null;
    }
    return ways[0];
  }

  function wayDetailsText(group) {
    const parts = [];
    const item = primaryWay(group);
    if (!item) {
      return "";
    }
    const lanes = lanesText(item);
    if (lanes) {
      parts.push(lanes);
    }
    const surface = surfacePavingText(item);
    if (surface) {
      parts.push(surface);
    }
    return parts.join(", ");
  }

  function appendLine(listItem, parts, className) {
    if (!parts || !parts.length) {
      return;
    }
    const line = $("<div>");
    if (className) {
      line.addClass(className);
    }
    parts.forEach(function(part){
      if (!part || part.text === undefined || part.text === null || part.text === "") {
        return;
      }
      if (part.wrap === false) {
        line.append(document.createTextNode(part.text));
        return;
      }
      const span = $("<span>").text(part.text);
      if (part.className) {
        span.addClass(part.className);
      }
      line.append(span);
    });
    if (!line.text()) {
      return;
    }
    listItem.append(line);
  }

  function renderWay(entry, listElem) {
    const group = entry && entry.group ? entry.group : null;
    if (!group) {
      return;
    }
    const listItem = $("<li>").addClass("map-content-way");
    const mainWay = primaryWay(group);
    if (mainWay && mainWay.osmId !== undefined && mainWay.osmId !== null) {
      listItem.attr("data-osm-id", String(mainWay.osmId));
    }

    const typeText = entry.subclassType || null;
    const nameText = wayName(group);
    const lengthText = formatLength(group);
    let lineText = "";

    if (!nameText) {
      lineText = t("map_content_way_unnamed", "Unnamed way");
    } else if (typeText) {
      lineText = typeText + " " + nameText;
    } else {
      lineText = nameText;
    }
    if (lengthText) {
      lineText += ", " + lengthText;
    }

    appendLine(listItem, [
      { text: capitalizeFirst(lineText), className: "map-content-title" }
    ], "map-content-title-line");

    const routeSummary = routeText(group);
    if (routeSummary) {
      appendLine(listItem, [
        { text: capitalizeFirst(routeSummary), className: "map-content-location-text" }
      ], "map-content-location");
    }

    const edgeSummary = edgesText(group);
    if (edgeSummary) {
      appendLine(listItem, [
        { text: capitalizeFirst(edgeSummary), className: "map-content-location-text" }
      ], "map-content-location");
    }

    const detailsText = wayDetailsText(group);
    if (detailsText) {
      appendLine(listItem, [
        { text: capitalizeFirst(detailsText), className: "map-content-way-details-text" }
      ], "map-content-way-details");
    }

    listElem.append(listItem);
  }

  function unnamedSurfaceClass(entry) {
    const item = primaryWay(entry && entry.group ? entry.group : null);
    return surfaceClass(item);
  }

  function summarizeUnnamedWays(entries) {
    const buckets = {
      paved: { surfaceClass: "paved", count: 0, totalLength: 0 },
      unpaved: { surfaceClass: "unpaved", count: 0, totalLength: 0 },
      unknown: { surfaceClass: "unknown", count: 0, totalLength: 0 }
    };
    const orderedClasses = ["paved", "unpaved", "unknown"];

    entries.forEach(function(entry){
      const klass = unnamedSurfaceClass(entry);
      const bucket = buckets[klass] || buckets.unknown;
      bucket.count += 1;
      bucket.totalLength += wayLengthValue(entry.group);
    });

    return orderedClasses
      .map(function(klass){ return buckets[klass]; })
      .filter(function(summary){ return summary.count > 0; });
  }

  function renderUnnamedWaySummary(summary, listElem) {
    if (!summary || !listElem || !listElem.length) {
      return;
    }
    const listItem = $("<li>").addClass("map-content-way");
    listItem.attr("data-unnamed-surface", summary.surfaceClass);

    const lengthText = formatLength({ totalLength: summary.totalLength });
    let titleText = unnamedRoadsCountText(summary.count) || t("content__unnamed_roads", "Unnamed roads");
    if (lengthText) {
      titleText += ", " + lengthText;
    }
    appendLine(listItem, [
      { text: capitalizeFirst(titleText), className: "map-content-title" }
    ], "map-content-title-line");

    const surfaceText = surfacePavingTextFromClass(summary.surfaceClass);
    if (surfaceText) {
      appendLine(listItem, [
        { text: capitalizeFirst(surfaceText), className: "map-content-way-details-text" }
      ], "map-content-way-details");
    }

    listElem.append(listItem);
  }

  function render(mapContent, listElem, helpers) {
    if (!listElem || !listElem.length) {
      return 0;
    }
    setTranslator(helpers);
    const entries = collectWayGroups(mapContent);
    const namedEntries = [];
    const unnamedEntries = [];

    entries.forEach(function(entry){
      if (wayName(entry.group)) {
        namedEntries.push(entry);
      } else {
        unnamedEntries.push(entry);
      }
    });

    namedEntries.forEach(function(entry){
      renderWay(entry, listElem);
    });

    const unnamedSummaries = summarizeUnnamedWays(unnamedEntries);
    unnamedSummaries.forEach(function(summary){
      renderUnnamedWaySummary(summary, listElem);
    });

    return namedEntries.length + unnamedSummaries.length;
  }

  function emptyMessage(helpers) {
    setTranslator(helpers);
    return t("map_content_no_ways", "No ways listed for this map.");
  }

  window.TM = window.TM || {};
  window.TM.mapDescWays = {
    render: render,
    emptyMessage: emptyMessage
  };
})();
