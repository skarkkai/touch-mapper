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

  function splitLabel(label) {
    if (!label || typeof label !== 'string') {
      return { title: t("map_content_building_unnamed", "Unnamed building") };
    }
    const parts = label.split(",");
    let title = parts[0] ? parts[0].trim() : label.trim();
    if (!title) {
      return { title: t("map_content_building_unnamed", "Unnamed building") };
    }
    title = capitalizeFirst(title);
    if (parts.length <= 1) {
      return { title: title };
    }
    const subtitle = parts.slice(1).join(",").trim();
    return { title: title, subtitle: subtitle || null };
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
          touches.push({ edge: edge, percent: entry[edge] });
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
    const parts = touches.map(function(touch){
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

  /**
   * Coverage phrase selection:
   * - meaningful bucket threshold: share >= 0.15
   * - distributed if:
   *   a) >= 3 meaningful buckets, or
   *   b) top share < 0.55, or
   *   c) top + second < 0.80
   * Non-distributed uses single / equal / mostly-extending templates.
   * Distributed uses explicit "In several areas, mostly ..." templates.
   */
  function coverageBreakdown(coverage) {
    const buckets = normalizedCoverageBuckets(coverage);
    if (!buckets.length) {
      return null;
    }
    const top = buckets[0];
    const second = buckets.length > 1 ? buckets[1] : null;
    const meaningful = buckets.filter(function(bucket){
      return bucket.share >= 0.15;
    });

    const topShare = top ? top.share : 0;
    const secondShare = second ? second.share : 0;
    const moreDistributed = meaningful.length >= 3 ||
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

  function addModelLine(item, parts, className) {
    if (!item || !Array.isArray(item.lines)) {
      return;
    }
    const lineParts = normalizeLineParts(parts);
    if (!lineParts.length) {
      return;
    }
    item.lines.push({
      className: className || null,
      parts: lineParts
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

  function renderLineFromModel(listItem, lineModel) {
    if (!lineModel || !Array.isArray(lineModel.parts) || !lineModel.parts.length) {
      return;
    }
    const tagName = lineModel.className === "map-content-title-line" ? "h5" : "div";
    const line = $("<" + tagName + ">");
    if (lineModel.className) {
      line.addClass(lineModel.className);
    }
    lineModel.parts.forEach(function(part){
      if (!part || part.text === undefined || part.text === null || part.text === "") {
        return;
      }
      if (part.wrap === false) {
        line.append(String(part.text));
        return;
      }
      const span = $("<span>").text(String(part.text));
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
    const nameParts = splitLabel(labelSource);
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
      attrs: {},
      lines: []
    };
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
    addModelLine(item, titleParts, "map-content-title-line");

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

  function buildModel(mapContent, helpers) {
    setTranslator(helpers);
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

  function render(mapContent, listElem, helpers) {
    if (!listElem || !listElem.length) {
      return 0;
    }
    const model = buildModel(mapContent, helpers);
    return renderFromModel(model, listElem);
  }

  function emptyMessage(helpers) {
    setTranslator(helpers);
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
