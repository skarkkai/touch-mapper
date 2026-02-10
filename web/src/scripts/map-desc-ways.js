/* global $ isNaN */
/* eslint quotes:0, space-unary-ops:0, no-alert:0, no-unused-vars:0, no-shadow:0, no-extend-native:0, no-trailing-spaces:0, space-infix-ops:0, camelcase:0, dot-notation:0 */

(function(){
  'use strict';

  const EXTERNAL_LINK_TYPE_PRIORITY = {
    wikipedia: 0,
    wikidata: 1,
    commons: 2,
    website: 3,
    search: 4
  };

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
      if (phraseForm === "route_from") {
        return t("map_content_loc_route_from_center", endpointCenter);
      }
      if (phraseForm === "route_to") {
        return t("map_content_loc_route_to_center", endpointCenter);
      }
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
      if (phraseForm === "route_from") {
        return interpolate(
          t("map_content_loc_route_from_part", t("map_content_loc_endpoint_part", "the __dir__ part")),
          { dir: dirLabel }
        );
      }
      if (phraseForm === "route_to") {
        return interpolate(
          t("map_content_loc_route_to_part", t("map_content_loc_endpoint_part", "the __dir__ part")),
          { dir: dirLabel }
        );
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
        if (phraseForm === "route_from") {
          return interpolate(
            t("map_content_loc_route_from_corner", t("map_content_loc_endpoint_corner", "the __corner__")),
            { corner: corner }
          );
        }
        if (phraseForm === "route_to") {
          return interpolate(
            t("map_content_loc_route_to_corner", t("map_content_loc_endpoint_corner", "the __corner__")),
            { corner: corner }
          );
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
      if (phraseForm === "route_from") {
        return interpolate(
          t("map_content_loc_route_from_near_edge", t("map_content_loc_endpoint_near_edge", "near the __dir__ edge")),
          { dir: dirLabel }
        );
      }
      if (phraseForm === "route_to") {
        return interpolate(
          t("map_content_loc_route_to_near_edge", t("map_content_loc_endpoint_near_edge", "near the __dir__ edge")),
          { dir: dirLabel }
        );
      }
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
    const andWord = t("map_content_list_and", "and");
    if (!parts.length) {
      return "";
    }
    if (parts.length === 1) {
      return parts[0];
    }
    if (parts.length === 2) {
      return parts[0] + " " + andWord + " " + parts[1];
    }
    return parts.slice(0, -1).join(", ") + ", " + andWord + " " + parts[parts.length - 1];
  }

  function normalizeOptions(options) {
    const section = options && typeof options.section === "string" ? options.section : "all";
    return {
      section: section
    };
  }

  function sectionForSubClassKey(subClassKey) {
    if (!subClassKey || typeof subClassKey !== "string") {
      return null;
    }
    if (subClassKey.indexOf("A1_") === 0) {
      return "roads";
    }
    if (subClassKey.indexOf("A2_") === 0) {
      return "paths";
    }
    if (subClassKey.indexOf("A3_") === 0) {
      return "railways";
    }
    if (subClassKey.indexOf("A4_") === 0) {
      return "waterways";
    }
    if (subClassKey.indexOf("A5_") === 0) {
      return null;
    }
    if (subClassKey.indexOf("A") === 0) {
      return "otherLinear";
    }
    return null;
  }

  function collectWayGroups(mapContent, options) {
    const resolved = normalizeOptions(options);
    const ways = [];
    const classA = mapContent && typeof mapContent === 'object' ? mapContent.A : null;
    const subclasses = classA && Array.isArray(classA.subclasses) ? classA.subclasses : [];

    subclasses.forEach(function(subclass, subclassOrder){
      if (!subclass || subclass.kind !== "linear" || !Array.isArray(subclass.groups)) {
        return;
      }
      const sectionKey = sectionForSubClassKey(subclass.key);
      if (!sectionKey) {
        return;
      }
      if (resolved.section !== "all" && sectionKey !== resolved.section) {
        return;
      }
      subclass.groups.forEach(function(group){
        if (!group || typeof group !== 'object') {
          return;
        }
        ways.push({
          group: group,
          subclassOrder: subclassOrder,
          subclassType: singularSubclassType(subclass.key, subclass.name),
          subClass: subclass.key,
          sectionKey: sectionKey
        });
      });
    });

    ways.sort(function(a, b){
      const importanceDiff = wayImportanceScore(b.group) - wayImportanceScore(a.group);
      if (importanceDiff !== 0) {
        return importanceDiff;
      }
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

  function wayImportanceScore(group) {
    const value = group ? group.importanceScore : null;
    const resolved = value && typeof value === "object" ? value.final : value;
    if (resolved === null || resolved === undefined || isNaN(resolved)) {
      return 0;
    }
    const number = Number(resolved);
    if (!isFinite(number)) {
      return 0;
    }
    return number;
  }

  function importanceScoreTooltip(importanceScore) {
    if (!importanceScore || typeof importanceScore !== "object" || Array.isArray(importanceScore)) {
      return null;
    }
    try {
      return JSON.stringify(importanceScore, null, 2);
    } catch (_error) {
      return null;
    }
  }

  function isSafeExternalUrl(url) {
    return typeof url === "string" && /^https?:\/\/\S+$/i.test(url);
  }

  function isGoogleSearchExternalLink(link) {
    if (!link || typeof link !== "object") {
      return false;
    }
    if (typeof link.label !== "string" || link.label.trim().toLowerCase() !== "search") {
      return false;
    }
    if (typeof link.url !== "string") {
      return false;
    }
    try {
      const parsed = new URL(link.url);
      const host = parsed.hostname.toLowerCase();
      if (!/^([a-z0-9-]+\.)*google\./.test(host)) {
        return false;
      }
      return parsed.pathname === "/search";
    } catch (_error) {
      return false;
    }
  }

  function normalizedExternalLink(link) {
    if (!link || typeof link !== "object") {
      return null;
    }
    if (!isSafeExternalUrl(link.url)) {
      return null;
    }
    if (isGoogleSearchExternalLink(link)) {
      return null;
    }
    return {
      type: typeof link.type === "string" ? link.type : "",
      url: link.url,
      label: typeof link.label === "string" ? link.label : ""
    };
  }

  function externalLinkPriority(link) {
    if (!link || !link.type || EXTERNAL_LINK_TYPE_PRIORITY[link.type] === undefined) {
      return Number.MAX_SAFE_INTEGER;
    }
    return EXTERNAL_LINK_TYPE_PRIORITY[link.type];
  }

  function bestGroupExternalLink(group) {
    if (!group || !Array.isArray(group.ways)) {
      return null;
    }
    let best = null;
    let bestPriority = Number.MAX_SAFE_INTEGER;
    group.ways.forEach(function(way){
      if (!way || typeof way !== "object") {
        return;
      }
      const candidate = normalizedExternalLink(way.externalLink);
      if (!candidate) {
        return;
      }
      const priority = externalLinkPriority(candidate);
      if (!best || priority < bestPriority) {
        best = candidate;
        bestPriority = priority;
      }
    });
    return best;
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

  function stripWayModifierSuffix(label) {
    if (!label || typeof label !== "string") {
      return label;
    }
    const trimmed = label.trim();
    const match = trimmed.match(/^(.*)\s+\[([^\]]+)\]$/);
    if (!match) {
      return trimmed;
    }
    const rawBase = match[1] ? match[1].trim() : "";
    const rawModifiers = match[2] ? match[2].trim() : "";
    if (!rawBase || !rawModifiers) {
      return trimmed;
    }

    const modifiers = rawModifiers.split(",").map(function(part){
      return part.trim();
    }).filter(Boolean);
    if (!modifiers.length) {
      return trimmed;
    }

    const allModifierTokens = modifiers.every(function(part){
      return /^[a-z_]+(?:=-?\d+)?$/i.test(part);
    });
    if (!allModifierTokens) {
      return trimmed;
    }

    const hasWayModifier = modifiers.some(function(part){
      const key = part.split("=")[0].toLowerCase();
      return key === "layer" ||
        key === "tunnel" ||
        key === "bridge" ||
        key === "covered" ||
        key === "ford" ||
        key === "embankment" ||
        key === "cutting";
    });

    return hasWayModifier ? rawBase : trimmed;
  }

  function wayTitle(group) {
    const label = stripWayModifierSuffix(group && group.displayLabel);
    if (isUnnamedWayLabel(label)) {
      return t("map_content_way_unnamed", "Unnamed way");
    }
    return capitalizeFirst(label);
  }

  function isUnnamedWayLabel(label) {
    if (!label || typeof label !== "string") {
      return true;
    }
    const trimmed = stripWayModifierSuffix(label).trim();
    return !trimmed || trimmed === "(unnamed)" || trimmed.indexOf("(unnamed)") === 0;
  }

  function wayName(group) {
    const label = stripWayModifierSuffix(group && group.displayLabel);
    if (isUnnamedWayLabel(label)) {
      return null;
    }
    return label;
  }

  function singularSubclassType(subclassKey, fallbackName) {
    if (subclassKey) {
      const typeKey = "map_content_way_type_" + subclassKey;
      const translated = t(typeKey, typeKey);
      if (translated !== typeKey) {
        return translated;
      }
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
    const visibleGeometry = target && Array.isArray(target.visibleGeometry) ? target.visibleGeometry : [];
    const flattened = [];
    visibleGeometry.forEach(function(bucket){
      const segments = bucket && Array.isArray(bucket.segments) ? bucket.segments : [];
      segments.forEach(function(segment){
        flattened.push(segment);
      });
    });
    return flattened;
  }

  function primarySegmentInfo(target) {
    const visibleGeometry = target && Array.isArray(target.visibleGeometry) ? target.visibleGeometry : [];
    for (let i = 0; i < visibleGeometry.length; i += 1) {
      const bucket = visibleGeometry[i];
      const segments = bucket && Array.isArray(bucket.segments) ? bucket.segments : [];
      if (!segments.length) {
        continue;
      }
      return {
        segment: segments[0],
        osmId: bucket && bucket.osmId !== undefined ? bucket.osmId : null
      };
    }
    return null;
  }

  /**
   * Route line grammar:
   * - single visible location: sentence(clause(loc))
   * - start->end: "From " + endpoint(start) + " to " + endpoint(end)
   * This avoids "Near near ..." and "From in ...".
   */
  function routeText(target) {
    const segmentInfo = primarySegmentInfo(target);
    if (!segmentInfo) {
      return null;
    }
    const points = collectSegmentPoints(segmentInfo.segment);
    if (!points.length) {
      return null;
    }
    const startEndpoint = locationTextFromZone(points[0].zone, "route_from") ||
      locationTextFromZone(points[0].zone, "endpoint");
    const endEndpoint = locationTextFromZone(points[points.length - 1].zone, "route_to") ||
      locationTextFromZone(points[points.length - 1].zone, "endpoint");

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

  function translatedWayType(subClass) {
    if (!subClass || typeof subClass !== 'string') {
      return null;
    }
    const typeKey = "map_content_way_type_" + subClass;
    const translated = t(typeKey, typeKey);
    if (translated !== typeKey) {
      return translated;
    }
    return null;
  }

  function translatedWayTypePlural(subClass) {
    if (!subClass || typeof subClass !== 'string') {
      return null;
    }
    const typeKey = "map_content_way_type_plural_" + subClass;
    const translated = t(typeKey, typeKey);
    if (translated !== typeKey) {
      return translated;
    }
    return null;
  }

  function normalizedWayName(name) {
    if (!name || typeof name !== 'string') {
      return null;
    }
    const trimmed = name.trim();
    if (isUnnamedWayLabel(trimmed)) {
      return null;
    }
    return trimmed.toLowerCase();
  }

  function wayOsmIds(group) {
    const ways = group && Array.isArray(group.ways) ? group.ways : [];
    const ids = [];
    const seen = {};
    ways.forEach(function(way){
      if (!way || way.osmId === undefined || way.osmId === null) {
        return;
      }
      const id = String(way.osmId);
      if (seen[id]) {
        return;
      }
      seen[id] = true;
      ids.push(id);
    });
    return ids;
  }

  function groupConnectionKey(group) {
    const ids = wayOsmIds(group);
    if (ids.length) {
      return "ways:" + ids.slice().sort().join("|");
    }
    const normName = normalizedWayName(wayName(group));
    return normName ? ("name:" + normName) : null;
  }

  function collectJunctionEvents(group) {
    const events = [];
    segmentList(group).forEach(function(segment){
      const segmentEvents = segment && Array.isArray(segment.events) ? segment.events : [];
      segmentEvents.forEach(function(event){
        if (event && event.type === "junction") {
          events.push(event);
        }
      });
    });
    return events;
  }

  function connectionSentence(labelInfo) {
    if (!labelInfo || !labelInfo.value) {
      if (!labelInfo || (labelInfo.mode !== "type" && labelInfo.mode !== "type_many")) {
        return null;
      }
    }
    if (labelInfo.mode === "way") {
      return interpolate(
        t("map_content_connects_to_way", "Connects to way __way__"),
        { way: labelInfo.value }
      );
    }
    const singularType = translatedWayType(labelInfo.subClass) ||
      t("map_content_way_type_A_other_ways", "other way");
    if (labelInfo.mode === "type_many") {
      const pluralType = translatedWayTypePlural(labelInfo.subClass);
      if (pluralType) {
        return interpolate(
          t("map_content_connects_to_type_many", "Connects to __count__ __type__"),
          { count: labelInfo.count, type: pluralType }
        );
      }
      return interpolate(
        t("map_content_connects_to_type_many_fallback", "Connects to __count__ ways of type __type__"),
        { count: labelInfo.count, type: singularType }
      );
    }
    return interpolate(
      t("map_content_connects_to_type", "Connects to __type__"),
      { type: singularType }
    );
  }

  function buildNamedConnectionTextsMap(namedEntries) {
    const groupsByKey = {};
    const bucketsByKey = {};
    const osmIdToKey = {};

    namedEntries.forEach(function(entry){
      const group = entry && entry.group ? entry.group : null;
      if (!group) {
        return;
      }
      const key = groupConnectionKey(group);
      if (!key) {
        return;
      }
      entry.connectionKey = key;
      groupsByKey[key] = group;
      bucketsByKey[key] = {
        currentName: normalizedWayName(wayName(group)),
        namedKeys: {},
        namedLabels: {},
        typeBuckets: {}
      };
      wayOsmIds(group).forEach(function(id){
        osmIdToKey[id] = key;
      });
    });

    Object.keys(groupsByKey).forEach(function(key){
      const group = groupsByKey[key];
      const bucket = bucketsByKey[key];
      const ownIds = {};
      wayOsmIds(group).forEach(function(id){
        ownIds[id] = true;
      });
      let unknownCounter = 0;

      collectJunctionEvents(group).forEach(function(event, eventIndex){
        const connections = event && Array.isArray(event.connections) ? event.connections : [];
        connections.forEach(function(connection, connectionIndex){
          if (!connection || typeof connection !== 'object') {
            return;
          }
          if (connection.osmType && connection.osmType !== "way") {
            return;
          }
          const connectionId = connection.osmId !== undefined && connection.osmId !== null
            ? String(connection.osmId)
            : null;
          if (connectionId && ownIds[connectionId]) {
            return;
          }

          const rawName = typeof connection.name === 'string' ? connection.name.trim() : "";
          const normName = normalizedWayName(rawName);
          if (normName && bucket.currentName && normName === bucket.currentName) {
            return;
          }

          if (connectionId) {
            const namedTargetKey = osmIdToKey[connectionId];
            if (namedTargetKey && namedTargetKey !== key) {
              bucket.namedKeys[namedTargetKey] = true;
              return;
            }
          }

          if (normName) {
            if (!bucket.namedLabels[normName]) {
              bucket.namedLabels[normName] = rawName;
            }
            return;
          }

          const subClass = typeof connection.subClass === 'string' && connection.subClass
            ? connection.subClass
            : "A_other_ways";
          if (!bucket.typeBuckets[subClass]) {
            bucket.typeBuckets[subClass] = {};
          }
          const dedupeToken = connectionId
            ? ("id:" + connectionId)
            : ("event:" + eventIndex + ":" + connectionIndex + ":" + (unknownCounter += 1));
          bucket.typeBuckets[subClass][dedupeToken] = true;
        });
      });
    });

    Object.keys(bucketsByKey).forEach(function(sourceKey){
      const source = bucketsByKey[sourceKey];
      Object.keys(source.namedKeys).forEach(function(targetKey){
        if (!bucketsByKey[targetKey] || targetKey === sourceKey) {
          return;
        }
        bucketsByKey[targetKey].namedKeys[sourceKey] = true;
      });
    });

    const connectionTextsByKey = {};
    Object.keys(bucketsByKey).forEach(function(key){
      const bucket = bucketsByKey[key];

      Object.keys(bucket.namedKeys).forEach(function(targetKey){
        const targetName = wayName(groupsByKey[targetKey]);
        const norm = normalizedWayName(targetName);
        if (norm && !bucket.namedLabels[norm]) {
          bucket.namedLabels[norm] = targetName;
        }
      });

      const texts = [];
      const namedNames = Object.keys(bucket.namedLabels).map(function(norm){
        return bucket.namedLabels[norm];
      }).filter(function(value){ return !!value; });
      namedNames.sort(function(a, b){ return a.localeCompare(b); });
      namedNames.forEach(function(name){
        const text = connectionSentence({ mode: "way", value: name });
        if (text) {
          texts.push(text);
        }
      });

      const typeEntries = Object.keys(bucket.typeBuckets).map(function(subClass){
        return {
          subClass: subClass,
          count: Object.keys(bucket.typeBuckets[subClass]).length
        };
      }).filter(function(entry){ return entry.count > 0; });
      typeEntries.sort(function(a, b){
        if (a.count !== b.count) {
          return b.count - a.count;
        }
        const aLabel = translatedWayType(a.subClass) || t("map_content_way_type_A_other_ways", "other way");
        const bLabel = translatedWayType(b.subClass) || t("map_content_way_type_A_other_ways", "other way");
        return aLabel.localeCompare(bLabel);
      });
      typeEntries.forEach(function(entry){
        const text = connectionSentence({
          mode: entry.count > 1 ? "type_many" : "type",
          subClass: entry.subClass,
          count: entry.count
        });
        if (text) {
          texts.push(text);
        }
      });

      connectionTextsByKey[key] = texts;
    });

    return connectionTextsByKey;
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
        const zone = event.zone && typeof event.zone === 'object' ? event.zone : null;
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
      const base = interpolate(t("map_content_edge_phrase", "__edge__ edge"), {
        edge: edgeLabel(detail.edge)
      });
      const qualifier = edgePositionQualifier(detail.position);
      return qualifier ? base + " " + qualifier : base;
    });
    const hasPosition = details.some(function(detail){ return !!detail.position; });
    if (!hasPosition && details.length > 1) {
      return interpolate(t("map_content_crosses_edges", "Crosses __edges__ edges"), {
        edges: joinWithAnd(details.map(function(detail){ return edgeLabel(detail.edge); }))
      });
    }
    if (details.length === 1) {
      const detail = details[0];
      const base = interpolate(t("map_content_crosses_edge", "Crosses __edge__ edge"), {
        edge: edgeLabel(detail.edge)
      });
      const qualifier = edgePositionQualifier(detail.position);
      return qualifier ? base + " " + qualifier : base;
    }
    return interpolate(
      t("map_content_crosses_items", "Crosses __items__"),
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

  function showConnectionsForEntry(entry) {
    return !!(entry && entry.sectionKey === "roads");
  }

  function showRoadDetailsForEntry(entry) {
    return !!(entry && entry.sectionKey === "roads");
  }

  function normalizeLineParts(parts) {
    if (!parts || !parts.length) {
      return [];
    }
    return parts.filter(function(part){
      return part && part.text !== undefined && part.text !== null && part.text !== "";
    }).map(function(part){
      return {
        text: String(part.text),
        className: part.className || null,
        wrap: part.wrap === false ? false : true
      };
    });
  }

  function addModelLine(item, parts, className, titleText, link) {
    if (!item || !Array.isArray(item.lines)) {
      return;
    }
    const lineParts = normalizeLineParts(parts);
    if (!lineParts.length) {
      return;
    }
    item.lines.push({
      className: className || null,
      parts: lineParts,
      title: titleText || null,
      link: link || null
    });
  }

  function applyItemAttrs(listItem, attrs) {
    if (!attrs || typeof attrs !== "object") {
      return;
    }
    if (attrs.dataOsmId !== undefined && attrs.dataOsmId !== null) {
      listItem.attr("data-osm-id", String(attrs.dataOsmId));
    }
    if (attrs.dataUnnamedSurface) {
      listItem.attr("data-unnamed-surface", String(attrs.dataUnnamedSurface));
    }
    if (attrs.initiallyHidden) {
      listItem.attr("data-initially-hidden", "true");
    }
  }

  function appendLineParts(target, parts) {
    parts.forEach(function(part){
      if (!part || part.text === undefined || part.text === null || part.text === "") {
        return;
      }
      if (part.wrap === false) {
        target.append(String(part.text));
        return;
      }
      const span = $("<span>").text(String(part.text));
      if (part.className) {
        span.addClass(part.className);
      }
      target.append(span);
    });
  }

  function renderLineFromModel(listItem, lineModel) {
    if (!lineModel || !Array.isArray(lineModel.parts) || !lineModel.parts.length) {
      return;
    }
    const tagName = lineModel.className === "map-content-title-line" ? "h5" : "div";
    const line = $("<" + tagName + ">");
    if (lineModel.className) {
      line.addClass(lineModel.className);
    }
    const titleLink = lineModel.className === "map-content-title-line"
      ? normalizedExternalLink(lineModel.link)
      : null;
    appendLineParts(line, lineModel.parts);

    if (titleLink) {
      const anchor = $("<a>")
        .addClass("map-content-inline-external-link")
        .attr("href", titleLink.url)
        .attr("target", "_blank")
        .attr("rel", "noopener noreferrer");
      anchor.append($("<span>").text(titleLink.label || "Website"));
      anchor.append($("<span>").addClass("map-content-external-indicator").attr("aria-hidden", "true").text("↗"));
      anchor.append($("<span>").addClass("visuallyhidden").text(
        " " + t("map_content_external_link_aria", "External link, opens in a new tab")
      ));
      line.append($("<span>").addClass("map-content-external-link-sep").text(" "));
      line.append(anchor);
    }

    if (lineModel.title) {
      line.addClass("map-content-has-importance-popup");
      const popup = $("<span>").addClass("map-content-importance-popup");
      popup.append($("<pre>").text(lineModel.title));
      line.append(popup);
    }
    if (!line.text()) {
      return;
    }
    listItem.append(line);
  }

  function renderItemFromModel(item, listElem) {
    if (!item || !listElem || !listElem.length) {
      return;
    }
    const listItem = $("<li>").addClass("map-content-way");
    applyItemAttrs(listItem, item.attrs);
    const lines = Array.isArray(item.lines) ? item.lines : [];
    lines.forEach(function(lineModel){
      renderLineFromModel(listItem, lineModel);
    });
    listElem.append(listItem);
  }

  function buildWayItemModel(entry, connectionTextsByKey) {
    const group = entry && entry.group ? entry.group : null;
    if (!group) {
      return null;
    }
    const item = {
      type: "way",
      attrs: {},
      lines: []
    };
    const mainWay = primaryWay(group);
    if (mainWay && mainWay.osmId !== undefined && mainWay.osmId !== null) {
      item.attrs.dataOsmId = String(mainWay.osmId);
    }

    const typeText = entry.subclassType || null;
    const nameText = wayName(group);
    const lengthText = formatLength(group);
    const scoreTooltip = importanceScoreTooltip(group.importanceScore);
    const titleLink = bestGroupExternalLink(group);
    let lineText = "";

    if (!nameText) {
      lineText = entry && entry.sectionKey === "waterways"
        ? t("map_content_way_unnamed_waterway", "Unnamed waterway")
        : t("map_content_way_unnamed", "Unnamed way");
      item.attrs.dataIsNamed = false;
    } else if (typeText) {
      lineText = typeText + " " + nameText;
      item.attrs.dataIsNamed = true;
    } else {
      lineText = nameText;
      item.attrs.dataIsNamed = true;
    }
    item.summaryTitle = capitalizeFirst(lineText);
    if (lengthText) {
      lineText += ", " + lengthText;
    }

    addModelLine(item, [
      { text: capitalizeFirst(lineText), className: "map-content-title" }
    ], "map-content-title-line", scoreTooltip, titleLink);

    const routeSummary = routeText(group);
    if (routeSummary) {
      addModelLine(item, [
        { text: capitalizeFirst(routeSummary), className: "map-content-location-text" }
      ], "map-content-location");
    }

    const edgeSummary = edgesText(group);
    if (edgeSummary) {
      addModelLine(item, [
        { text: capitalizeFirst(edgeSummary), className: "map-content-location-text" }
      ], "map-content-location");
    }

    if (showConnectionsForEntry(entry)) {
      const key = entry && entry.connectionKey ? entry.connectionKey : null;
      const connectionLines = key && connectionTextsByKey && connectionTextsByKey[key]
        ? connectionTextsByKey[key]
        : [];
      connectionLines.forEach(function(connectionLine){
        addModelLine(item, [
          { text: capitalizeFirst(connectionLine), className: "map-content-location-text" }
        ], "map-content-location");
      });
    }

    if (showRoadDetailsForEntry(entry)) {
      const detailsText = wayDetailsText(group);
      if (detailsText) {
        addModelLine(item, [
          { text: capitalizeFirst(detailsText), className: "map-content-way-details-text" }
        ], "map-content-way-details");
      }
    }

    return item;
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

  function summarizeUnnamedNonRoadWays(entries) {
    const buckets = {};
    entries.forEach(function(entry){
      if (!entry || !entry.subClass) {
        return;
      }
      if (!buckets[entry.subClass]) {
        buckets[entry.subClass] = {
          subClass: entry.subClass,
          count: 0,
          totalLength: 0
        };
      }
      buckets[entry.subClass].count += 1;
      buckets[entry.subClass].totalLength += wayLengthValue(entry.group);
    });

    return Object.keys(buckets).map(function(subClass){
      return buckets[subClass];
    }).sort(function(a, b){
      if (a.count !== b.count) {
        return b.count - a.count;
      }
      const aLabel = translatedWayType(a.subClass) || t("map_content_way_type_A_other_ways", "other way");
      const bLabel = translatedWayType(b.subClass) || t("map_content_way_type_A_other_ways", "other way");
      return aLabel.localeCompare(bLabel);
    });
  }

  function buildUnnamedWaySummaryModel(summary) {
    if (!summary) {
      return null;
    }
    const item = {
      type: "summary",
      attrs: {
        dataUnnamedSurface: summary.surfaceClass,
        dataIsNamed: false
      },
      lines: []
    };

    const lengthText = formatLength({ totalLength: summary.totalLength });
    let titleText = unnamedRoadsCountText(summary.count) || t("content__unnamed_roads", "Unnamed roads");
    if (lengthText) {
      titleText += ", " + lengthText;
    }
    addModelLine(item, [
      { text: capitalizeFirst(titleText), className: "map-content-title" }
    ], "map-content-title-line");

    const surfaceText = surfacePavingTextFromClass(summary.surfaceClass);
    if (surfaceText) {
      addModelLine(item, [
        { text: capitalizeFirst(surfaceText), className: "map-content-way-details-text" }
      ], "map-content-way-details");
    }

    return item;
  }

  function buildUnnamedNonRoadSummaryModel(summary) {
    if (!summary) {
      return null;
    }
    const item = {
      type: "summary",
      attrs: {
        dataIsNamed: false
      },
      lines: []
    };
    const singularType = translatedWayType(summary.subClass) || t("map_content_way_type_A_other_ways", "other way");
    const pluralType = translatedWayTypePlural(summary.subClass) || singularType;
    const typeText = summary.count === 1 ? singularType : pluralType;
    const key = summary.count === 1 ? "map_content_unnamed_features_one" : "map_content_unnamed_features_many";
    let titleText = interpolate(
      t(key, "__count__ unnamed __type__"),
      { count: summary.count, type: typeText }
    );
    const lengthText = formatLength({ totalLength: summary.totalLength });
    if (lengthText) {
      titleText += ", " + lengthText;
    }
    addModelLine(item, [
      { text: capitalizeFirst(titleText), className: "map-content-title" }
    ], "map-content-title-line");
    return item;
  }

  function showUnnamedAsItem(entry) {
    if (!entry || !entry.sectionKey) {
      return false;
    }
    return entry.sectionKey === "railways" ||
      entry.sectionKey === "waterways" ||
      entry.sectionKey === "otherLinear";
  }

  function isUnnamedWaterwayEntry(entry) {
    return !!(entry && entry.sectionKey === "waterways" && !wayName(entry.group));
  }

  function unnamedWaterwayLocationText(entry) {
    if (!entry || !entry.group) {
      return null;
    }
    const text = routeText(entry.group);
    if (!text || typeof text !== "string") {
      return null;
    }
    const trimmed = text.trim();
    return trimmed || null;
  }

  function unnamedWaterwayLocationKey(locationText) {
    if (!locationText || typeof locationText !== "string") {
      return null;
    }
    const trimmed = locationText.trim();
    return trimmed ? trimmed.toLowerCase() : null;
  }

  function buildMergedUnnamedWaterwayModel(summary) {
    if (!summary || summary.count < 2) {
      return null;
    }
    const item = {
      type: "summary",
      attrs: {
        dataIsNamed: false
      },
      lines: []
    };
    const lengthText = formatLength({ totalLength: summary.totalLength });
    const singularType = translatedWayType("A4_other_waterways") ||
      t("map_content_way_type_A4_other_waterways", "other waterway");
    const pluralType = translatedWayTypePlural("A4_other_waterways") || singularType;
    const typeText = summary.count === 1 ? singularType : pluralType;
    const key = summary.count === 1 ? "map_content_unnamed_features_one" : "map_content_unnamed_features_many";
    let titleText = interpolate(
      t(key, "__count__ unnamed __type__"),
      { count: summary.count, type: typeText }
    );
    if (lengthText) {
      titleText += ", " + lengthText;
    }
    addModelLine(item, [
      { text: capitalizeFirst(titleText), className: "map-content-title" }
    ], "map-content-title-line");
    if (summary.locationText) {
      addModelLine(item, [
        { text: capitalizeFirst(summary.locationText), className: "map-content-location-text" }
      ], "map-content-location");
    }
    return item;
  }

  function buildModel(mapContent, helpers, options) {
    setTranslator(helpers);
    const resolved = normalizeOptions(options);
    const entries = collectWayGroups(mapContent, resolved);
    const itemEntries = [];
    const unnamedEntries = [];
    const model = [];

    entries.forEach(function(entry){
      if (wayName(entry.group) || showUnnamedAsItem(entry)) {
        itemEntries.push(entry);
      } else {
        unnamedEntries.push(entry);
      }
    });

    const connectionTextsByKey = buildNamedConnectionTextsMap(
      itemEntries.filter(function(entry){
        return showConnectionsForEntry(entry) && !!wayName(entry.group);
      })
    );

    const unnamedWaterwayBucketsByKey = {};
    const unnamedWaterwayKeyByIndex = {};
    itemEntries.forEach(function(entry, index){
      if (!isUnnamedWaterwayEntry(entry)) {
        return;
      }
      const locationText = unnamedWaterwayLocationText(entry);
      const locationKey = unnamedWaterwayLocationKey(locationText);
      if (!locationKey) {
        return;
      }
      unnamedWaterwayKeyByIndex[index] = locationKey;
      if (!unnamedWaterwayBucketsByKey[locationKey]) {
        unnamedWaterwayBucketsByKey[locationKey] = {
          count: 0,
          totalLength: 0,
          locationText: locationText,
          firstIndex: index
        };
      }
      const bucket = unnamedWaterwayBucketsByKey[locationKey];
      bucket.count += 1;
      bucket.totalLength += wayLengthValue(entry.group);
      if (index < bucket.firstIndex) {
        bucket.firstIndex = index;
      }
    });

    itemEntries.forEach(function(entry, index){
      const locationKey = unnamedWaterwayKeyByIndex[index];
      if (locationKey) {
        const bucket = unnamedWaterwayBucketsByKey[locationKey];
        if (bucket && bucket.count > 1) {
          if (bucket.firstIndex === index) {
            const mergedItem = buildMergedUnnamedWaterwayModel(bucket);
            if (mergedItem) {
              model.push(mergedItem);
            }
          }
          return;
        }
      }

      const item = buildWayItemModel(entry, connectionTextsByKey);
      if (item) {
        model.push(item);
      }
    });

    const unnamedRoadEntries = unnamedEntries.filter(function(entry){
      return entry.sectionKey === "roads";
    });
    const unnamedPathEntries = unnamedEntries.filter(function(entry){
      return entry.sectionKey === "paths";
    });

    const unnamedRoadSummaries = summarizeUnnamedWays(unnamedRoadEntries);
    unnamedRoadSummaries.forEach(function(summary){
      const item = buildUnnamedWaySummaryModel(summary);
      if (item) {
        model.push(item);
      }
    });

    const unnamedNonRoadSummaries = summarizeUnnamedNonRoadWays(unnamedPathEntries);
    unnamedNonRoadSummaries.forEach(function(summary){
      const item = buildUnnamedNonRoadSummaryModel(summary);
      if (item) {
        model.push(item);
      }
    });

    return model;
  }

  function renderFromModel(model, listElem) {
    if (!listElem || !listElem.length) {
      return 0;
    }
    const items = Array.isArray(model) ? model : [];
    listElem.empty();
    items.forEach(function(item){
      renderItemFromModel(item, listElem);
    });
    return items.length;
  }

  function render(mapContent, listElem, helpers, options) {
    if (!listElem || !listElem.length) {
      return 0;
    }
    const model = buildModel(mapContent, helpers, options);
    return renderFromModel(model, listElem);
  }

  function emptyMessage(helpers, options) {
    setTranslator(helpers);
    const resolved = normalizeOptions(options);
    if (resolved.section === "roads") {
      return t("map_content_no_roads", "No roads listed for this map.");
    }
    if (resolved.section === "paths") {
      return t("map_content_no_paths", "No paths listed for this map.");
    }
    if (resolved.section === "railways") {
      return t("map_content_no_railways", "No railways listed for this map.");
    }
    if (resolved.section === "waterways") {
      return t("map_content_no_waterways", "No waterways listed for this map.");
    }
    if (resolved.section === "otherLinear") {
      return t("map_content_no_other_linear", "No other linear features listed for this map.");
    }
    return t("map_content_no_roads", "No roads listed for this map.");
  }

  window.TM = window.TM || {};
  window.TM.mapDescWays = {
    buildModel: buildModel,
    renderFromModel: renderFromModel,
    render: render,
    emptyMessage: emptyMessage
  };
})();
