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
  const WATER_AREA_SUBCLASS_LABELS = {
    B1_lakes: "lake",
    B1_ponds: "pond",
    B1_reservoirs: "reservoir",
    B1_sea_coast: "sea",
    B1_riverbanks: "riverbank",
    B1_other_water: "water area"
  };
  const COVERAGE_COMPASS_DIRECTIONS = [
    "north",
    "northeast",
    "east",
    "southeast",
    "south",
    "southwest",
    "west",
    "northwest"
  ];

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

  function normalizeOptions(options) {
    const section = options && typeof options.section === "string" ? options.section : "buildings";
    return {
      section: section
    };
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

  function splitLabelWithFallback(label, fallbackTitle) {
    const fallback = fallbackTitle || t("map_content_building_unnamed", "Unnamed building");
    if (!label || typeof label !== 'string') {
      return { title: fallback };
    }
    const parts = label.split(",");
    let title = parts[0] ? parts[0].trim() : label.trim();
    if (!title) {
      return { title: fallback };
    }
    title = capitalizeFirst(title);
    if (parts.length <= 1) {
      return { title: title };
    }
    const subtitle = parts.slice(1).join(",").trim();
    return { title: title, subtitle: subtitle || null };
  }

  function splitLabel(label) {
    return splitLabelWithFallback(label, t("map_content_building_unnamed", "Unnamed building"));
  }

  function trimString(value) {
    if (typeof value !== "string") {
      return "";
    }
    return value.trim();
  }

  function isUnnamedText(text) {
    if (!text || typeof text !== "string") {
      return true;
    }
    const normalized = text.trim().toLowerCase();
    return !normalized ||
      normalized === "(unnamed)" ||
      normalized.indexOf("(unnamed)") === 0 ||
      normalized.indexOf("(unnamed)") >= 0 ||
      normalized.indexOf("unnamed") === 0;
  }

  function slugifyOsmValue(value) {
    if (!value || typeof value !== 'string') {
      return "";
    }
    const normalized = value.normalize
      ? value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      : value;
    return normalized
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  function translatedOsmValue(value) {
    const slug = slugifyOsmValue(value);
    if (!slug) {
      return null;
    }
    const key = "map_content_osm_value_" + slug;
    const translated = t(key, key);
    if (translated === key) {
      return null;
    }
    return translated;
  }

  function localizeBuildingTitle(title) {
    if (!title || typeof title !== 'string') {
      return title;
    }
    const exact = translatedOsmValue(title);
    if (exact) {
      return exact;
    }
    const match = title.match(/^(.*)\s+building$/i);
    if (match) {
      const translatedValue = translatedOsmValue(match[1].trim());
      if (translatedValue) {
        return interpolate(
          t("map_content_building_type_from_value", "__value__ building"),
          { value: translatedValue }
        );
      }
    }
    return title;
  }

  function pickPrimaryItem(group) {
    if (!group || !group.items || !group.items.length) {
      return null;
    }
    return group.items[0];
  }

  function locationPhrase(group, item) {
    const components = item && item.visibleGeometry && Array.isArray(item.visibleGeometry.components)
      ? item.visibleGeometry.components
      : null;
    if (components && components.length && components[0].location) {
      const locationText = locationPhraseFromLoc(components[0].location.loc, "clause");
      if (locationText) {
        return locationText;
      }
    }
    if (item && item.location && item.location.center) {
      return locationTextFromValue(item.location.center, "clause");
    }
    if (group && group.location && group.location.center) {
      return locationTextFromValue(group.location.center, "clause");
    }
    return null;
  }

  function edgeLabel(edge) {
    if (edge === "north") return t("map_content_edge_north", "north");
    if (edge === "south") return t("map_content_edge_south", "south");
    if (edge === "east") return t("map_content_edge_east", "east");
    if (edge === "west") return t("map_content_edge_west", "west");
    return edge;
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

  /**
   * Location phrase grammar (distance classification only):
   * 1) center, 2) part + dir, 3) near_edge + dir (diagonal near_edge means corner).
   * Forms:
   * - atom: "center", "east part", "north edge", "north-east corner"
   * - clause: "in the center", "in the east part", "near the north edge", "in the north-east corner"
   * - endpoint: "the center", "the east part", "near the north edge", "the north-east corner"
   * Rules:
   * - avoid duplicated prepositions by selecting form by context.
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
      if (loc.dir === "northwest" || loc.dir === "northeast" ||
          loc.dir === "southwest" || loc.dir === "southeast") {
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

  function locationTextFromValue(value, form) {
    if (value && typeof value === 'object') {
      const loc = value.loc && typeof value.loc === 'object' ? value.loc : value;
      return locationPhraseFromLoc(loc, form);
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

  function parseEdgeTouches(edgesTouched) {
    if (!edgesTouched || !edgesTouched.length) {
      return [];
    }
    const touches = [];
    edgesTouched.forEach(function(entry){
      if (entry && typeof entry === 'object') {
        Object.keys(entry).forEach(function(edge){
          touches.push({ edge: edge, percent: entry[edge], order: touches.length });
        });
      }
    });
    return touches;
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

  function edgePositionFromCoverage(coverage, edge) {
    const segments = coverage && Array.isArray(coverage.segments) ? coverage.segments : [];
    if (!segments.length) {
      return null;
    }
    const buckets = { north: 0, center: 0, south: 0, east: 0, west: 0 };
    let matchedSegments = 0;
    segments.forEach(function(segment){
      if (!segment || !segment.loc || segment.loc.kind !== "near_edge") {
        return;
      }
      const direction = segment.loc.dir;
      const bucket = edgePositionBucketFromDirection(edge, direction);
      if (!bucket) {
        return;
      }
      matchedSegments += 1;
      const count = Number(segment.insideCount);
      if (!isFinite(count) || count <= 0) {
        return;
      }
      buckets[bucket] += count;
    });
    if (matchedSegments <= 1) {
      return null;
    }

    const present = Object.keys(buckets).filter(function(bucket){ return buckets[bucket] > 0; });
    if (present.length === 0) {
      return null;
    }
    if (present.length > 1) {
      return "multiple";
    }
    return present[0];
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

  function edgesText(edgesTouched, coverage) {
    const touches = parseEdgeTouches(edgesTouched);
    if (!touches.length) {
      return null;
    }
    const orderedTouches = touches.slice().sort(function(a, b){
      const aValue = Number(a.percent);
      const bValue = Number(b.percent);
      const aHasPercent = isFinite(aValue);
      const bHasPercent = isFinite(bValue);
      if (aHasPercent && bHasPercent) {
        if (Math.abs(bValue - aValue) > 1e-9) {
          return bValue - aValue;
        }
        return a.order - b.order;
      }
      if (aHasPercent !== bHasPercent) {
        return aHasPercent ? -1 : 1;
      }
      return a.order - b.order;
    });
    const parts = orderedTouches.map(function(touch){
      const edge = edgeLabel(touch.edge);
      if (!edge) {
        return null;
      }
      let base = null;
      if (touch.percent !== null && touch.percent !== undefined && !isNaN(touch.percent)) {
        base = interpolate(t("map_content_touches_edge_percent", "touches __percent__% of __edge__ edge"), {
          edge: edge,
          percent: formatPercent(touch.percent)
        });
      } else {
        base = interpolate(t("map_content_touches_edge", "Touches __edge__ edge"), { edge: edge });
      }
      const position = edgePositionFromCoverage(coverage, touch.edge);
      const qualifier = edgePositionQualifier(position);
      return qualifier ? base + " " + qualifier : base;
    }).filter(Boolean);
    return joinWithAnd(parts);
  }

  function formatPercent(value) {
    if (value === null || value === undefined || isNaN(value)) {
      return null;
    }
    const num = Number(value);
    if (!isFinite(num)) {
      return null;
    }
    if (num < 10) {
      return num.toFixed(1);
    }
    return Math.round(num).toFixed(0);
  }

  function formatAspect(value) {
    if (value === null || value === undefined || isNaN(value)) {
      return null;
    }
    const num = Number(value);
    if (!isFinite(num)) {
      return null;
    }
    return num.toFixed(1);
  }

  function orientationLabel(label) {
    if (!label || typeof label !== 'string') {
      return null;
    }
    if (label === "east-west") {
      return t("map_content_orientation_label_east_west", "east-west");
    }
    if (label === "north-south") {
      return t("map_content_orientation_label_north_south", "north-south");
    }
    if (label === "northeast-southwest") {
      return t("map_content_orientation_label_northeast_southwest", "north-east to south-west");
    }
    if (label === "east-northeast to west-southwest") {
      return t(
        "map_content_orientation_label_east_northeast_to_west_southwest",
        "east-north-east to west-south-west"
      );
    }
    if (label === "north-northeast to south-southwest") {
      return t(
        "map_content_orientation_label_north_northeast_to_south_southwest",
        "north-north-east to south-south-west"
      );
    }
    return label;
  }

  function shapeTypeLabel(shapeType) {
    if (!shapeType || typeof shapeType !== 'string') {
      return null;
    }
    if (shapeType === "regular") {
      return null;
    }
    if (shapeType === "complex") {
      return t("map_content_shape_irregular", "Irregular shape");
    }
    if (shapeType === "thin") {
      return t("map_content_shape_elongated", "Thin");
    }
    return interpolate(
      t("map_content_shape_generic", "__shape__ shape"),
      { shape: capitalizeFirst(shapeType) }
    );
  }

  function isDiagonalDirection(direction) {
    return direction === "northwest" ||
      direction === "northeast" ||
      direction === "southwest" ||
      direction === "southeast";
  }

  function normalizeCoverageLoc(loc) {
    if (!loc || typeof loc !== 'object') {
      return null;
    }
    const direction = loc.dir || null;
    if (loc.kind === "center") {
      return { kind: "center", dir: null };
    }
    if (loc.kind === "part") {
      return direction ? { kind: "part", dir: direction } : { kind: "center", dir: null };
    }
    if (loc.kind === "near_edge") {
      return direction ? { kind: "near_edge", dir: direction } : null;
    }
    return null;
  }

  function coverageBucketKey(bucket) {
    if (!bucket) {
      return "";
    }
    return bucket.kind + ":" + (bucket.dir || "");
  }

  function normalizedCoverageBuckets(coverage) {
    if (!coverage || !Array.isArray(coverage.segments) || !coverage.segments.length) {
      return [];
    }
    const bucketMap = {};
    let total = 0;
    coverage.segments.forEach(function(segment){
      if (!segment || typeof segment.insideCount !== 'number' || segment.insideCount <= 0) {
        return;
      }
      const bucket = normalizeCoverageLoc(segment.loc);
      if (!bucket) {
        return;
      }
      const key = coverageBucketKey(bucket);
      if (!key) {
        return;
      }
      if (!bucketMap[key]) {
        bucketMap[key] = { kind: bucket.kind, dir: bucket.dir, insideCount: 0 };
      }
      bucketMap[key].insideCount += segment.insideCount;
      total += segment.insideCount;
    });
    if (total <= 0) {
      return [];
    }
    const buckets = Object.keys(bucketMap).map(function(key){
      const bucket = bucketMap[key];
      return {
        kind: bucket.kind,
        dir: bucket.dir,
        insideCount: bucket.insideCount,
        share: bucket.insideCount / total
      };
    });
    buckets.sort(function(a, b){
      return b.share - a.share;
    });
    return buckets;
  }

  function bucketClauseText(bucket) {
    if (!bucket) {
      return null;
    }
    return locationPhraseFromLoc({ kind: bucket.kind, dir: bucket.dir }, "clause");
  }

  function bucketTargetText(bucket) {
    if (!bucket) {
      return null;
    }
    return locationPhraseFromLoc({ kind: bucket.kind, dir: bucket.dir }, "atom");
  }

  function coverageSingleSentence(bucket) {
    const clause = locationPhraseFromLoc({ kind: bucket.kind, dir: bucket.dir }, "clause");
    if (!clause) {
      return null;
    }
    return capitalizeFirst(clause) + ".";
  }

  function coverageEqualSentence(first, second) {
    const firstText = bucketClauseText(first);
    const secondText = bucketClauseText(second);
    if (!firstText || !secondText) {
      return null;
    }
    return capitalizeFirst(interpolate(
      t("map_content_summary_equal_clauses", "__first__ and __second__."),
      {
        first: firstText,
        second: secondText
      }
    ));
  }

  function coverageMostlySentence(top, second) {
    const lead = bucketClauseText(top);
    const target = bucketTargetText(second);
    if (!lead || !target) {
      return null;
    }
    return interpolate(
      t("map_content_summary_mostly_extending_clauses", "Mostly __lead__, extending toward __target__."),
      {
        lead: lead,
        target: target
      }
    );
  }

  function coverageDistributedSentence(top, second) {
    const first = bucketClauseText(top);
    if (!first) {
      return null;
    }
    if (!second || second.share < 0.15) {
      return interpolate(
        t("map_content_summary_distributed_top1", "In several areas, mostly __first__."),
        { first: first }
      );
    }
    const secondText = bucketClauseText(second);
    if (!secondText) {
      return null;
    }
    return interpolate(
      t("map_content_summary_distributed_top2", "In several areas, mostly __first__ and __second__."),
      {
        first: first,
        second: secondText
      }
    );
  }

  // --- Helpers: graph + distance ------------------------------------------------

  function coverageAllDirectionNodes() {
    // 8 compass dirs + center
    return ["center"].concat(COVERAGE_COMPASS_DIRECTIONS);
  }

  function coverageDirectionNeighbors(direction) {
    if (!direction) return [];
    if (direction === "center") {
      // center adjacent to all compass directions
      return COVERAGE_COMPASS_DIRECTIONS.slice();
    }
    const idx = COVERAGE_COMPASS_DIRECTIONS.indexOf(direction);
    if (idx < 0) return [];
    const prev = (idx - 1 + COVERAGE_COMPASS_DIRECTIONS.length) % COVERAGE_COMPASS_DIRECTIONS.length;
    const next = (idx + 1) % COVERAGE_COMPASS_DIRECTIONS.length;
    // also adjacent to center (optional; but makes distance model symmetric)
    return ["center", COVERAGE_COMPASS_DIRECTIONS[prev], COVERAGE_COMPASS_DIRECTIONS[next]];
  }

  function coverageBuildDistanceMatrix() {
    const nodes = coverageAllDirectionNodes();
    const dist = {};
    for (let i = 0; i < nodes.length; i += 1) {
      const start = nodes[i];
      dist[start] = {};
      // BFS from start
      const queue = [start];
      dist[start][start] = 0;
      while (queue.length) {
        const cur = queue.shift();
        const curDist = dist[start][cur];
        const neighbors = coverageDirectionNeighbors(cur);
        for (let j = 0; j < neighbors.length; j += 1) {
          const nb = neighbors[j];
          if (dist[start][nb] !== undefined) continue;
          dist[start][nb] = curDist + 1;
          queue.push(nb);
        }
      }
    }
    return dist;
  }

  const COVERAGE_DIRECTION_DIST = coverageBuildDistanceMatrix();

  function coverageMinDistanceToCluster(direction, clusterDirs) {
    if (!direction) return Infinity;
    let best = Infinity;
    for (let i = 0; i < clusterDirs.length; i += 1) {
      const c = clusterDirs[i];
      const d = (COVERAGE_DIRECTION_DIST[c] && COVERAGE_DIRECTION_DIST[c][direction]);
      if (typeof d === "number" && d < best) best = d;
    }
    return best;
  }

  function coverageClusterIsConnected(clusterDirs) {
    if (!Array.isArray(clusterDirs) || clusterDirs.length === 0) return false;
    const set = {};
    for (let i = 0; i < clusterDirs.length; i += 1) {
      set[clusterDirs[i]] = true;
    }
    const start = clusterDirs[0];
    const visited = {};
    const stack = [start];
    visited[start] = true;

    while (stack.length) {
      const cur = stack.pop();
      const neighbors = coverageDirectionNeighbors(cur);
      for (let i = 0; i < neighbors.length; i += 1) {
        const nb = neighbors[i];
        if (!set[nb] || visited[nb]) continue;
        visited[nb] = true;
        stack.push(nb);
      }
    }

    for (let i = 0; i < clusterDirs.length; i += 1) {
      if (!visited[clusterDirs[i]]) return false;
    }
    return true;
  }

  // --- Cluster search -----------------------------------------------------------

  function coverageDirectionComponent(bucket) {
    if (!bucket || typeof bucket !== "object") {
      return null;
    }
    if (bucket.kind === "center") {
      return "center";
    }
    if (typeof bucket.dir !== "string") {
      return null;
    }
    return COVERAGE_COMPASS_DIRECTIONS.indexOf(bucket.dir) >= 0 ? bucket.dir : null;
  }

  function coverageDirectionSharesFromBuckets(buckets) {
    const shares = {};
    const nodes = coverageAllDirectionNodes();
    for (let i = 0; i < nodes.length; i += 1) shares[nodes[i]] = 0;

    for (let i = 0; i < buckets.length; i += 1) {
      const dir = coverageDirectionComponent(buckets[i]);
      if (!dir) continue;
      const s = typeof buckets[i].share === "number" ? buckets[i].share : 0;
      shares[dir] += s;
    }
    return shares;
  }

  function coverageScoreCluster(directionShares, clusterDirs) {
    // cluster share: sum of shares in cluster
    let clusterShare = 0;
    const nodes = coverageAllDirectionNodes();
    const inCluster = {};
    for (let i = 0; i < clusterDirs.length; i += 1) inCluster[clusterDirs[i]] = true;

    for (let i = 0; i < clusterDirs.length; i += 1) {
      clusterShare += directionShares[clusterDirs[i]] || 0;
    }

    // far leak: any share at distance >= 2 from cluster
    let farLeak = 0;
    for (let i = 0; i < nodes.length; i += 1) {
      const dir = nodes[i];
      if (inCluster[dir]) continue;
      const share = directionShares[dir] || 0;
      if (share <= 0) continue;
      const minDist = coverageMinDistanceToCluster(dir, clusterDirs);
      if (minDist >= 2) farLeak += share;
    }

    return { clusterShare, farLeak };
  }

  function coverageEnumerateCombinations(items, k, onCombo) {
    const combo = [];
    function rec(start, depth) {
      if (depth === k) {
        onCombo(combo.slice());
        return;
      }
      for (let i = start; i <= items.length - (k - depth); i += 1) {
        combo.push(items[i]);
        rec(i + 1, depth + 1);
        combo.pop();
      }
    }
    rec(0, 0);
  }

  function coverageFindBestCluster(buckets) {
    const directionShares = coverageDirectionSharesFromBuckets(buckets);
    const nodes = coverageAllDirectionNodes();

    let best = null;

    function consider(clusterDirs) {
      if (!coverageClusterIsConnected(clusterDirs)) return;
      const score = coverageScoreCluster(directionShares, clusterDirs);

      // basic dominance requirement first (cheap pruning)
      // (Keep thresholds here so we don't waste time comparing weak clusters)
      if (score.clusterShare < 0.75) return;

      if (!best) {
        best = { clusterDirs, clusterShare: score.clusterShare, farLeak: score.farLeak };
        return;
      }

      // Prefer higher clusterShare, then lower farLeak, then smaller cluster size (more concise)
      if (score.clusterShare > best.clusterShare + 1e-9) {
        best = { clusterDirs, clusterShare: score.clusterShare, farLeak: score.farLeak };
        return;
      }
      if (Math.abs(score.clusterShare - best.clusterShare) <= 1e-9) {
        if (score.farLeak < best.farLeak - 1e-9) {
          best = { clusterDirs, clusterShare: score.clusterShare, farLeak: score.farLeak };
          return;
        }
        if (Math.abs(score.farLeak - best.farLeak) <= 1e-9) {
          if (clusterDirs.length < best.clusterDirs.length) {
            best = { clusterDirs, clusterShare: score.clusterShare, farLeak: score.farLeak };
          }
        }
      }
    }

    // search connected clusters of size 3..5
    for (let size = 3; size <= 5; size += 1) {
      coverageEnumerateCombinations(nodes, size, consider);
    }

    return best;
  }

  // --- Phrase selection ---------------------------------------------------------

  function threeRegionsPhrase(top, second, third) {
    const firstText = bucketClauseText(top);
    const secondText = bucketClauseText(second);
    const thirdText = bucketClauseText(third);
    if (!firstText || !secondText || !thirdText) {
      return null;
    }
    return interpolate(
      t("map_content_summary_three_regions_clauses", "Mostly __first__, __second__, and __third__."),
      { first: firstText, second: secondText, third: thirdText }
    );
  }

  /**
   * Coverage phrase selection:
   * - meaningful bucket threshold: share >= 0.15
   * - cluster phrase (threeRegionsPhrase) if:
   *   a) there exists a connected cluster of 3..5 adjacent directions whose total share >= 0.75, and
   *   b) far-away leakage (distance >= 2 from that cluster) is small (<= 0.10), and
   *   c) at least 3 meaningful buckets fall inside the chosen cluster (so we can name them)
   * - distributed / single / equal / mostly-extending as before.
   */
  function coverageBreakdown(coverage) {
    const buckets = normalizedCoverageBuckets(coverage);
    if (!buckets.length) {
      return null;
    }

    const top = buckets[0];
    const second = buckets.length > 1 ? buckets[1] : null;

    const topShare = top ? top.share : 0;
    const secondShare = second ? second.share : 0;

    const meaningful = buckets.filter(function(bucket) {
      return bucket.share >= 0.15;
    });

    // clustered >=3 adjacent regions, minimal far-away spill -------------
    const bestCluster = coverageFindBestCluster(buckets);
    if (bestCluster && bestCluster.farLeak <= 0.10) {
      const inCluster = {};
      for (let i = 0; i < bestCluster.clusterDirs.length; i += 1) {
        inCluster[bestCluster.clusterDirs[i]] = true;
      }

      // Pick the top 3 meaningful buckets within the cluster to mention
      const clusterMeaningful = meaningful.filter(function(bucket) {
        const dir = coverageDirectionComponent(bucket);
        return !!(dir && inCluster[dir]);
      });

      if (clusterMeaningful.length >= 3) {
        return threeRegionsPhrase(clusterMeaningful[0], clusterMeaningful[1], clusterMeaningful[2]);
      }
    }

    // --- Existing distributed logic (unchanged, except no forced "not connected")-
    const moreDistributed =
      meaningful.length >= 4 ||
      topShare < 0.55 ||
      (topShare + secondShare) < 0.80;

    if (moreDistributed) {
      return coverageDistributedSentence(top, second);
    }
    if (!second || secondShare < 0.15 || meaningful.length <= 1 || topShare >= 0.85) {
      return coverageSingleSentence(top);
    }
    if (Math.abs(topShare - secondShare) <= 0.07) {
      return coverageEqualSentence(top, second);
    }
    return coverageMostlySentence(top, second);
  }

  function buildingGroupIsNamed(group) {
    const primary = pickPrimaryItem(group);
    const explicitName = trimString(group && group.label) || trimString(primary && primary.label);
    if (explicitName && !isUnnamedText(explicitName)) {
      return true;
    }
    let labelSource = group && group.displayLabel;
    if (!labelSource && primary) {
      labelSource = primary.displayLabel;
    }
    const nameParts = splitLabel(labelSource);
    return !!(nameParts && typeof nameParts.subtitle === "string" && nameParts.subtitle.trim());
  }

  function collectBuildingGroups(mapContent) {
    const groups = [];
    if (!mapContent || typeof mapContent !== 'object') {
      return groups;
    }
    Object.keys(mapContent).forEach(function(key){
      const entry = mapContent[key];
      if (!entry || !Array.isArray(entry.subclasses) || !entry.subclasses.length) {
        return;
      }
      entry.subclasses.forEach(function(sub){
        if (!sub || sub.kind !== "building" || !Array.isArray(sub.groups) || !sub.groups.length) {
          return;
        }
        sub.groups.forEach(function(group){
          if (group) {
            groups.push(group);
          }
        });
      });
    });
    groups.sort(function(a, b){
      const aNamed = buildingGroupIsNamed(a);
      const bNamed = buildingGroupIsNamed(b);
      if (aNamed !== bNamed) {
        return aNamed ? -1 : 1;
      }
      const importanceDiff = groupImportanceScore(b) - groupImportanceScore(a);
      if (importanceDiff !== 0) {
        return importanceDiff;
      }
      const coverageDiff = groupCoveragePercent(b) - groupCoveragePercent(a);
      if (Math.abs(coverageDiff) > 1e-9) {
        return coverageDiff;
      }
      const aTitle = groupTitleKey(a);
      const bTitle = groupTitleKey(b);
      return aTitle.localeCompare(bTitle);
    });
    return groups;
  }

  function isWaterAreaSubClass(subClass) {
    return !!(subClass && WATER_AREA_SUBCLASS_LABELS[subClass]);
  }

  function waterAreaTypeLabel(subClass) {
    if (isWaterAreaSubClass(subClass)) {
      const key = "map_content_water_area_type_" + subClass;
      return t(key, WATER_AREA_SUBCLASS_LABELS[subClass]);
    }
    return t("map_content_water_area_type_generic", "water area");
  }

  function waterAreaTypeLabelPlural() {
    return t("map_content_water_area_type_generic_plural", "water areas");
  }

  function waterAreaNameFromDisplayLabel(group, primary) {
    const sources = [
      trimString(group && group.displayLabel),
      trimString(primary && primary.displayLabel)
    ].filter(Boolean);
    for (let i = 0; i < sources.length; i += 1) {
      const source = sources[i];
      const colonIndex = source.indexOf(":");
      let candidate = colonIndex >= 0 ? source.slice(colonIndex + 1).trim() : source.trim();
      if (!candidate || isUnnamedText(candidate)) {
        continue;
      }
      const lower = candidate.toLowerCase();
      if (lower === "water area") {
        continue;
      }
      return candidate;
    }
    return null;
  }

  function waterAreaEntryName(entry) {
    if (!entry) {
      return null;
    }
    const group = entry.group;
    const primary = pickPrimaryItem(group);
    const explicit = trimString(group && group.label) || trimString(primary && primary.label);
    if (explicit && !isUnnamedText(explicit)) {
      return explicit;
    }
    return waterAreaNameFromDisplayLabel(group, primary);
  }

  function waterAreaEntryIsNamed(entry) {
    return !!waterAreaEntryName(entry);
  }

  function waterAreaEntryTitleKey(entry) {
    const name = waterAreaEntryName(entry) || "";
    const typeText = waterAreaTypeLabel(entry && entry.subClass).toLowerCase();
    return (typeText + " " + name).trim();
  }

  function collectWaterAreaEntries(mapContent) {
    const entries = [];
    const classB = mapContent && typeof mapContent === "object" ? mapContent.B : null;
    const subclasses = classB && Array.isArray(classB.subclasses) ? classB.subclasses : [];
    subclasses.forEach(function(subclass){
      if (!subclass || subclass.kind !== "area" || !isWaterAreaSubClass(subclass.key) || !Array.isArray(subclass.groups)) {
        return;
      }
      subclass.groups.forEach(function(group){
        if (!group || typeof group !== "object") {
          return;
        }
        entries.push({
          group: group,
          subClass: subclass.key
        });
      });
    });
    entries.sort(function(a, b){
      const aNamed = waterAreaEntryIsNamed(a);
      const bNamed = waterAreaEntryIsNamed(b);
      if (aNamed !== bNamed) {
        return aNamed ? -1 : 1;
      }
      const importanceDiff = groupImportanceScore(b.group) - groupImportanceScore(a.group);
      if (importanceDiff !== 0) {
        return importanceDiff;
      }
      const coverageDiff = groupCoveragePercent(b.group) - groupCoveragePercent(a.group);
      if (Math.abs(coverageDiff) > 1e-9) {
        return coverageDiff;
      }
      return waterAreaEntryTitleKey(a).localeCompare(waterAreaEntryTitleKey(b));
    });
    return entries;
  }

  function groupImportanceScore(group) {
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
    if (!group || !Array.isArray(group.items)) {
      return null;
    }
    let best = null;
    let bestPriority = Number.MAX_SAFE_INTEGER;
    group.items.forEach(function(item){
      if (!item || typeof item !== "object") {
        return;
      }
      const candidate = normalizedExternalLink(item.externalLink);
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
    const listItem = $("<li>").addClass("map-content-building");
    applyItemAttrs(listItem, item.attrs);
    const lines = Array.isArray(item.lines) ? item.lines : [];
    lines.forEach(function(lineModel){
      renderLineFromModel(listItem, lineModel);
    });
    listElem.append(listItem);
  }

  function interpolatedParts(template, replacements, varClassName) {
    if (!template || typeof template !== 'string') {
      return [];
    }
    const parts = [];
    const pattern = /__([a-zA-Z0-9_]+)__/g;
    let lastIndex = 0;
    let match = pattern.exec(template);
    while (match) {
      if (match.index > lastIndex) {
        parts.push({ text: template.slice(lastIndex, match.index), wrap: false });
      }
      const key = match[1];
      const replacement = replacements && replacements[key] !== undefined
        ? String(replacements[key])
        : match[0];
      parts.push({ text: replacement, className: varClassName });
      lastIndex = match.index + match[0].length;
      match = pattern.exec(template);
    }
    if (lastIndex < template.length) {
      parts.push({ text: template.slice(lastIndex), wrap: false });
    }
    return parts;
  }

  function groupTitleKey(group) {
    const primary = pickPrimaryItem(group);
    let labelSource = group && group.displayLabel;
    if (!labelSource && primary) {
      labelSource = primary.displayLabel;
    }
    const nameParts = splitLabel(labelSource);
    const title = nameParts.title || "";
    const subtitle = nameParts.subtitle || "";
    return (title + " " + subtitle).trim().toLowerCase();
  }

  function groupCoveragePercent(group) {
    const primary = pickPrimaryItem(group);
    if (!primary || !primary.visibleGeometry || !primary.visibleGeometry.coverage) {
      return 0;
    }
    const percent = primary.visibleGeometry.coverage.coveragePercent;
    if (percent === undefined || percent === null || isNaN(percent)) {
      return 0;
    }
    return Number(percent) || 0;
  }

  function buildBuildingModel(group) {
    const primary = pickPrimaryItem(group);
    let labelSource = group && group.displayLabel;
    if (!labelSource && primary) {
      labelSource = primary.displayLabel;
    }
    const explicitName = group && typeof group.label === "string" && group.label.trim()
      ? group.label.trim()
      : (primary && typeof primary.label === "string" && primary.label.trim() ? primary.label.trim() : "");
    const nameParts = splitLabel(labelSource);
    const hasSubtitle = !!(nameParts && typeof nameParts.subtitle === "string" && nameParts.subtitle.trim());
    const isNamedForSummary = !!explicitName || hasSubtitle;
    const visibleGeometry = primary && primary.visibleGeometry ? primary.visibleGeometry : null;
    const coverage = visibleGeometry && visibleGeometry.coverage ? visibleGeometry.coverage : null;
    const coverageLine = coverageBreakdown(coverage);
    const location = locationPhrase(group, primary);
    const edges = visibleGeometry && Array.isArray(visibleGeometry.edgesTouched)
      ? visibleGeometry.edgesTouched
      : [];
    const touches = edgesText(edges, coverage);

    const item = {
      type: "building",
      attrs: {
        dataIsNamed: isNamedForSummary
      },
      lines: []
    };
    const scoreTooltip = importanceScoreTooltip(group && group.importanceScore ? group.importanceScore : null);
    const titleLink = bestGroupExternalLink(group);
    if (primary && primary.osmId !== undefined && primary.osmId !== null) {
      item.attrs.dataOsmId = String(primary.osmId);
    }
    const localizedTitle = capitalizeFirst(localizeBuildingTitle(nameParts.title));
    const titleParts = [{ text: localizedTitle, className: "map-content-title" }];
    if (nameParts.subtitle) {
      titleParts.push({
        text: " " + t("map_content_building_join_at", "at") + " ",
        className: "map-content-title-sep",
        wrap: false
      });
      titleParts.push({ text: nameParts.subtitle, className: "map-content-subtitle" });
    }
    addModelLine(item, titleParts, "map-content-title-line", scoreTooltip, titleLink);

    const primaryLocation = coverageLine || (location ? capitalizeFirst(location) : null);
    const primaryLocationText = primaryLocation ? primaryLocation.replace(/[.]+$/, "") : null;
    if (primaryLocationText) {
      addModelLine(item, [
        { text: primaryLocationText, className: "map-content-location-text" }
      ], "map-content-location");
    }
    if (touches) {
      addModelLine(item, [
        { text: capitalizeFirst(touches), className: "map-content-touches" }
      ], "map-content-location");
    }

    const components = visibleGeometry && Array.isArray(visibleGeometry.components)
      ? visibleGeometry.components
      : [];
    const partsLine = [];
    if (components && components.length > 1) {
      partsLine.push.apply(partsLine, interpolatedParts(
        t("map_content_parts_many", "__count__ parts"),
        { count: components.length },
        "map-content-parts-count"
      ));
    }
    if (coverage && coverage.coveragePercent !== undefined) {
      const percentText = formatPercent(coverage.coveragePercent);
      if (percentText !== null) {
        if (partsLine.length) {
          partsLine.push({ text: ", ", className: "map-content-parts-sep", wrap: false });
        }
        partsLine.push.apply(partsLine, interpolatedParts(
          t("map_content_total_area", "Covers __percent__% of map"),
          { percent: percentText },
          "map-content-parts-coverage"
        ));
      }
    }
    const shape = visibleGeometry && visibleGeometry.shape ? visibleGeometry.shape : null;
    const shapeLineParts = [];
    if (shape) {
      const aspectRatio = Number(shape.aspectRatio);
      const localizedOrientation = orientationLabel(shape.orientationLabel);
      if (localizedOrientation && isFinite(aspectRatio) && aspectRatio > 2.0) {
        shapeLineParts.push.apply(shapeLineParts, interpolatedParts(
          t("map_content_orientation", "Orientation __label__"),
          { label: localizedOrientation },
          "map-content-shape-orientation"
        ));
      }

      if (shape.type && shape.type !== "regular") {
        let descriptor = null;
        if (aspectRatio >= 3.5) {
          descriptor = t("map_content_shape_long_thin", "Very thin");
        } else if (aspectRatio >= 2.5) {
          descriptor = t("map_content_shape_elongated", "Thin");
        }
        if (descriptor) {
          if (shapeLineParts.length) {
            shapeLineParts.push({ text: ", ", className: "map-content-shape-sep", wrap: false });
          }
          shapeLineParts.push({ text: descriptor, className: "map-content-shape-aspect" });
        }
        const shapeType = shapeTypeLabel(shape.type);
        if (shapeType) {
          if (shapeLineParts.length) {
            shapeLineParts.push({ text: ", ", className: "map-content-shape-sep", wrap: false });
          }
          shapeLineParts.push({ text: shapeType, className: "map-content-shape-type" });
        }
      }
    }
    if (partsLine.length) {
      addModelLine(item, partsLine, "map-content-parts");
    }
    if (shapeLineParts.length) {
      addModelLine(item, shapeLineParts, "map-content-shape");
    }

    return item;
  }

  function waterAreaCoveragePercent(entry) {
    if (!entry || !entry.group) {
      return 0;
    }
    return groupCoveragePercent(entry.group);
  }

  function waterAreaPrimaryLocationText(entry) {
    if (!entry || !entry.group) {
      return null;
    }
    const group = entry.group;
    const primary = pickPrimaryItem(group);
    const visibleGeometry = primary && primary.visibleGeometry ? primary.visibleGeometry : null;
    const coverage = visibleGeometry && visibleGeometry.coverage ? visibleGeometry.coverage : null;
    const coverageLine = coverageBreakdown(coverage);
    const location = locationPhrase(group, primary);
    const primaryLocation = coverageLine || (location ? capitalizeFirst(location) : null);
    if (!primaryLocation || typeof primaryLocation !== "string") {
      return null;
    }
    const trimmed = primaryLocation.replace(/[.]+$/, "").trim();
    return trimmed || null;
  }

  function waterAreaPrimaryLocationKey(text) {
    if (!text || typeof text !== "string") {
      return null;
    }
    const trimmed = text.trim();
    return trimmed ? trimmed.toLowerCase() : null;
  }

  function mergeWaterAreaEdgesTouched(entries) {
    const byEdge = {};
    const orderedEdges = ["north", "south", "east", "west"];
    entries.forEach(function(entry){
      const group = entry && entry.group ? entry.group : null;
      const primary = pickPrimaryItem(group);
      const visibleGeometry = primary && primary.visibleGeometry ? primary.visibleGeometry : null;
      const edges = visibleGeometry && Array.isArray(visibleGeometry.edgesTouched)
        ? visibleGeometry.edgesTouched
        : [];
      edges.forEach(function(edgeInfo){
        if (!edgeInfo || typeof edgeInfo !== "object") {
          return;
        }
        Object.keys(edgeInfo).forEach(function(edge){
          const rawValue = edgeInfo[edge];
          const numValue = Number(rawValue);
          if (!isFinite(numValue)) {
            if (!Object.prototype.hasOwnProperty.call(byEdge, edge)) {
              byEdge[edge] = null;
            }
            return;
          }
          if (!Object.prototype.hasOwnProperty.call(byEdge, edge) || byEdge[edge] === null || numValue > byEdge[edge]) {
            byEdge[edge] = numValue;
          }
        });
      });
    });
    return orderedEdges
      .filter(function(edge){ return Object.prototype.hasOwnProperty.call(byEdge, edge); })
      .map(function(edge){
        const out = {};
        out[edge] = byEdge[edge];
        return out;
      });
  }

  function buildWaterAreaModel(entry) {
    if (!entry || !entry.group) {
      return null;
    }
    const group = entry.group;
    const primary = pickPrimaryItem(group);
    const visibleGeometry = primary && primary.visibleGeometry ? primary.visibleGeometry : null;
    const coverage = visibleGeometry && visibleGeometry.coverage ? visibleGeometry.coverage : null;
    const coverageLine = coverageBreakdown(coverage);
    const location = locationPhrase(group, primary);
    const edges = visibleGeometry && Array.isArray(visibleGeometry.edgesTouched)
      ? visibleGeometry.edgesTouched
      : [];
    const touches = edgesText(edges, coverage);
    const name = waterAreaEntryName(entry);
    const typeText = waterAreaTypeLabel(entry.subClass);
    const isNamed = !!name;

    const item = {
      type: "water_area",
      attrs: {
        dataIsNamed: isNamed
      },
      lines: []
    };
    const scoreTooltip = importanceScoreTooltip(group && group.importanceScore ? group.importanceScore : null);
    const titleLink = bestGroupExternalLink(group);
    if (primary && primary.osmId !== undefined && primary.osmId !== null) {
      item.attrs.dataOsmId = String(primary.osmId);
    }

    let titleText = "";
    if (isNamed) {
      titleText = typeText + " " + name;
    } else {
      titleText = interpolate(
        t("map_content_water_area_unnamed", "Unnamed __type__"),
        { type: typeText }
      );
    }
    addModelLine(item, [
      { text: capitalizeFirst(titleText), className: "map-content-title" }
    ], "map-content-title-line", scoreTooltip, titleLink);

    const primaryLocation = coverageLine || (location ? capitalizeFirst(location) : null);
    const primaryLocationText = primaryLocation ? primaryLocation.replace(/[.]+$/, "") : null;
    if (primaryLocationText) {
      addModelLine(item, [
        { text: primaryLocationText, className: "map-content-location-text" }
      ], "map-content-location");
    }
    if (touches) {
      addModelLine(item, [
        { text: capitalizeFirst(touches), className: "map-content-touches" }
      ], "map-content-location");
    }

    if (coverage && coverage.coveragePercent !== undefined) {
      const percentText = formatPercent(coverage.coveragePercent);
      if (percentText !== null) {
        addModelLine(item, interpolatedParts(
          t("map_content_total_area", "Covers __percent__% of map"),
          { percent: percentText },
          "map-content-parts-coverage"
        ), "map-content-parts");
      }
    }
    return item;
  }

  function buildMergedUnnamedWaterAreaModel(summary) {
    if (!summary || !summary.count || summary.count < 2) {
      return null;
    }
    const item = {
      type: "water_area_summary",
      attrs: {
        dataIsNamed: false
      },
      lines: []
    };
    const key = summary.count === 1 ? "map_content_unnamed_features_one" : "map_content_unnamed_features_many";
    const typeText = summary.count === 1
      ? t("map_content_water_area_type_generic", "water area")
      : waterAreaTypeLabelPlural();
    const titleText = interpolate(
      t(key, "__count__ unnamed __type__"),
      { count: summary.count, type: typeText }
    );
    addModelLine(item, [
      { text: capitalizeFirst(titleText), className: "map-content-title" }
    ], "map-content-title-line");

    if (summary.locationText) {
      addModelLine(item, [
        { text: capitalizeFirst(summary.locationText), className: "map-content-location-text" }
      ], "map-content-location");
    }

    const touches = edgesText(summary.edgesTouched, null);
    if (touches) {
      addModelLine(item, [
        { text: capitalizeFirst(touches), className: "map-content-touches" }
      ], "map-content-location");
    }

    const percentText = formatPercent(summary.coveragePercent);
    if (percentText !== null) {
      addModelLine(item, interpolatedParts(
        t("map_content_total_area", "Covers __percent__% of map"),
        { percent: percentText },
        "map-content-parts-coverage"
      ), "map-content-parts");
    }
    return item;
  }

  function buildWaterAreasModel(mapContent) {
    const entries = collectWaterAreaEntries(mapContent);
    const namedEntries = [];
    const unnamedEntries = [];
    const model = [];
    entries.forEach(function(entry){
      if (waterAreaEntryIsNamed(entry)) {
        namedEntries.push(entry);
      } else {
        unnamedEntries.push(entry);
      }
    });

    namedEntries.forEach(function(entry){
      const item = buildWaterAreaModel(entry);
      if (item) {
        model.push(item);
      }
    });

    const unnamedBucketsByKey = {};
    const unnamedKeyByIndex = {};
    unnamedEntries.forEach(function(entry, index){
      const locationText = waterAreaPrimaryLocationText(entry);
      const locationKey = waterAreaPrimaryLocationKey(locationText);
      if (!locationKey) {
        return;
      }
      unnamedKeyByIndex[index] = locationKey;
      if (!unnamedBucketsByKey[locationKey]) {
        unnamedBucketsByKey[locationKey] = {
          count: 0,
          coveragePercent: 0,
          locationText: locationText,
          firstIndex: index,
          entries: []
        };
      }
      const bucket = unnamedBucketsByKey[locationKey];
      bucket.count += 1;
      bucket.coveragePercent += waterAreaCoveragePercent(entry);
      bucket.entries.push(entry);
      if (index < bucket.firstIndex) {
        bucket.firstIndex = index;
      }
    });

    unnamedEntries.forEach(function(entry, index){
      const locationKey = unnamedKeyByIndex[index];
      if (locationKey) {
        const bucket = unnamedBucketsByKey[locationKey];
        if (bucket && bucket.count > 1) {
          if (bucket.firstIndex === index) {
            bucket.edgesTouched = mergeWaterAreaEdgesTouched(bucket.entries);
            const mergedItem = buildMergedUnnamedWaterAreaModel(bucket);
            if (mergedItem) {
              model.push(mergedItem);
            }
          }
          return;
        }
      }
      const item = buildWaterAreaModel(entry);
      if (item) {
        model.push(item);
      }
    });

    return model;
  }

  function buildModel(mapContent, helpers, options) {
    setTranslator(helpers);
    const resolved = normalizeOptions(options);
    if (resolved.section === "water_areas") {
      return buildWaterAreasModel(mapContent);
    }
    const groups = collectBuildingGroups(mapContent);
    const model = [];
    groups.forEach(function(group){
      const item = buildBuildingModel(group);
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
    if (resolved.section === "water_areas") {
      return t("map_content_no_water_areas", "No water areas listed for this map.");
    }
    return t("map_content_no_buildings", "No buildings listed for this map.");
  }

  window.TM = window.TM || {};
  window.TM.mapDescAreas = {
    buildModel: buildModel,
    renderFromModel: renderFromModel,
    render: render,
    emptyMessage: emptyMessage
  };
})();
