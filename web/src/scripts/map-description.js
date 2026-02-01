/* global $ mapCalc Backbone isNan _ ol THREE performance google ga fbq TRANSLATIONS i18next */
/* eslint quotes:0, space-unary-ops:0, no-alert:0, no-unused-vars:0, no-shadow:0, no-extend-native:0, no-trailing-spaces:0, space-infix-ops:0, camelcase:0, dot-notation:0 */

/*
  * Build short, human-friendly map descriptions from map-content.json
  */
(function(){
    'use strict';

    function translations() {
      return window.TM && window.TM.translations ? window.TM.translations : {};
    }

    function t(key, fallback) {
      const dict = translations();
      if (dict[key] !== undefined && dict[key] !== null && dict[key] !== "") {
        return dict[key];
      }
      return fallback !== undefined ? fallback : key;
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
        const locationText = locationPhraseFromLoc(components[0].location.loc, "full");
        if (locationText) {
          return locationText;
        }
      }
      if (item && item.location && item.location.center) {
        if (typeof item.location.center === 'string') {
          return item.location.center;
        }
        if (item.location.center && typeof item.location.center === 'object') {
          return locationPhraseFromLoc(item.location.center.loc, "full") || null;
        }
      }
      if (group && group.location && group.location.center) {
        if (typeof group.location.center === 'string') {
          return group.location.center;
        }
        if (group.location.center && typeof group.location.center === 'object') {
          return locationPhraseFromLoc(group.location.center.loc, "full") || null;
        }
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
      if (direction === "northwest") return t("map_content_corner_northwest", "top-left corner");
      if (direction === "northeast") return t("map_content_corner_northeast", "top-right corner");
      if (direction === "southwest") return t("map_content_corner_southwest", "bottom-left corner");
      if (direction === "southeast") return t("map_content_corner_southeast", "bottom-right corner");
      return direction;
    }

    function locationPhraseFromLoc(loc, mode) {
      if (!loc || typeof loc !== 'object') {
        return null;
      }
      const kind = loc.kind;
      const dirLabel = loc.dir ? directionLabel(loc.dir) : null;
      const corner = loc.dir ? cornerLabel(loc.dir) : null;
      const isFull = mode === "full";
      if (kind === "center") {
        return t(
          isFull ? "map_content_loc_full_center" : "map_content_loc_center",
          isFull ? "near the center of the map" : "center"
        );
      }
      if (kind === "offset_center") {
        if (!dirLabel) {
          return t(
            isFull ? "map_content_loc_full_center" : "map_content_loc_center",
            isFull ? "near the center of the map" : "center"
          );
        }
        return interpolate(
          t(
            isFull ? "map_content_loc_full_offset_center" : "map_content_loc_offset_center",
            isFull ? "a little __dir__ of the center of the map" : "__dir__ of the center"
          ),
          { dir: dirLabel }
        );
      }
      if (kind === "part") {
        if (!dirLabel) {
          return t(
            isFull ? "map_content_loc_full_center" : "map_content_loc_center",
            isFull ? "near the center of the map" : "center"
          );
        }
        return interpolate(
          t(
            isFull ? "map_content_loc_full_part" : "map_content_loc_part",
            isFull ? "in the __dir__ part of the map" : "__dir__ part"
          ),
          { dir: dirLabel }
        );
      }
      if (kind === "edge") {
        if (!dirLabel) {
          return null;
        }
        return interpolate(
          t(
            isFull ? "map_content_loc_full_edge" : "map_content_loc_edge",
            isFull ? "near the __dir__ edge of the map" : "__dir__ edge"
          ),
          { dir: dirLabel }
        );
      }
      if (kind === "corner") {
        if (!corner) {
          return null;
        }
        return interpolate(
          t(
            isFull ? "map_content_loc_full_corner" : "map_content_loc_corner",
            isFull ? "near the __corner__ of the map" : "__corner__"
          ),
          { corner: corner }
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

    function parseEdgeTouches(edgesTouched) {
      if (!edgesTouched || !edgesTouched.length) {
        return [];
      }
      const touches = [];
      edgesTouched.forEach(function(entry){
        if (typeof entry === 'string') {
          touches.push({ edge: entry, percent: null });
          return;
        }
        if (entry && typeof entry === 'object') {
          Object.keys(entry).forEach(function(edge){
            touches.push({ edge: edge, percent: entry[edge] });
          });
        }
      });
      return touches;
    }

    function edgesText(edgesTouched) {
      const touches = parseEdgeTouches(edgesTouched);
      if (!touches.length) {
        return null;
      }
      const parts = touches.map(function(touch){
        const edge = edgeLabel(touch.edge);
        if (!edge) {
          return null;
        }
        if (touch.percent !== null && touch.percent !== undefined && !isNaN(touch.percent)) {
          return interpolate(t("map_content_touches_edge_percent", "touches __percent__% of __edge__ edge"), {
            edge: edge,
            percent: formatPercent(touch.percent)
          });
        }
        return interpolate(t("map_content_touches_edge", "Touches __edge__ edge"), { edge: edge });
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

    function formatDegrees(value) {
      if (value === null || value === undefined || isNaN(value)) {
        return null;
      }
      const num = Number(value);
      if (!isFinite(num)) {
        return null;
      }
      if (Math.abs(num - Math.round(num)) < 0.01) {
        return Math.round(num).toFixed(0) + " deg";
      }
      return num.toFixed(1) + " deg";
    }

    function orientationAbbrev(label) {
      if (!label || typeof label !== 'string') {
        return null;
      }
      const map = {
        "east-west": "E-W",
        "east-northeast to west-southwest": "ENE-WSW",
        "northeast-southwest": "NE-SW",
        "north-northeast to south-southwest": "NNE-SSW"
      };
      return map[label] || label;
    }

    function shapeTypeLabel(shapeType) {
      if (!shapeType || typeof shapeType !== 'string') {
        return null;
      }
      if (shapeType === "complex") {
        return t("map_content_shape_irregular", "Irregular shape");
      }
      if (shapeType === "thin" || shapeType === "regular") {
        return null;
      }
      return capitalizeFirst(shapeType) + " shape";
    }

    function coverageBreakdown(coverage) {
      if (!coverage || !Array.isArray(coverage.segments) || !coverage.segments.length) {
        return null;
      }
      const segments = coverage.segments.filter(function(segment){
        return segment && typeof segment.insideCount === 'number';
      }).slice();
      if (!segments.length) {
        return null;
      }
      segments.sort(function(a, b){
        return b.insideCount - a.insideCount;
      });
      let total = 0;
      segments.forEach(function(segment){
        total += segment.insideCount;
      });
      if (total <= 0) {
        return null;
      }
      const phrases = segments.map(function(segment){
        const ratio = segment.insideCount / total;
        let qualifierKey = "map_content_coverage_little";
        if (ratio >= 0.5) {
          qualifierKey = "map_content_coverage_much";
        } else if (ratio >= 0.2) {
          qualifierKey = "map_content_coverage_some";
        }
        const segmentText = locationPhraseFromLoc(segment.loc, "segment") || "";
        if (!segmentText) {
          return "";
        }
        return interpolate(t(qualifierKey, "some of __segment__"), { segment: segmentText });
      });
      const cleanedPhrases = phrases.filter(Boolean);
      let coverageText = "";
      if (cleanedPhrases.length === 1) {
        coverageText = cleanedPhrases[0];
      } else if (cleanedPhrases.length === 2) {
        coverageText = cleanedPhrases[0] + " and " + cleanedPhrases[1];
      } else {
        coverageText = cleanedPhrases.slice(0, -1).join(", ") + ", and " + cleanedPhrases[cleanedPhrases.length - 1];
      }
      if (!coverageText) {
        return null;
      }
      return coverageText;
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

    function appendTextLine(listItem, text, className, spanClassName) {
      if (!text) {
        return;
      }
      appendLine(listItem, [{ text: text, className: spanClassName }], className);
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
      let labelSource = group && (group.displayLabel || group.label);
      if (!labelSource && primary) {
        labelSource = primary.displayLabel || primary.label;
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

    function renderBuilding(group, listElem) {
      const primary = pickPrimaryItem(group);
      let labelSource = group && (group.displayLabel || group.label);
      if (!labelSource && primary) {
        labelSource = primary.displayLabel || primary.label;
      }
      const nameParts = splitLabel(labelSource);
      const location = locationPhrase(group, primary);
      const visibleGeometry = primary && primary.visibleGeometry ? primary.visibleGeometry : null;
      const edges = visibleGeometry && Array.isArray(visibleGeometry.edgesTouched)
        ? visibleGeometry.edgesTouched
        : [];
      const touches = edgesText(edges);

      const listItem = $("<li>").addClass("map-content-building");
      if (primary && primary.osmId !== undefined && primary.osmId !== null) {
        listItem.attr("data-osm-id", String(primary.osmId));
      }
      const titleParts = [{ text: nameParts.title, className: "map-content-title" }];
      if (nameParts.subtitle) {
        titleParts.push({ text: " at ", className: "map-content-title-sep", wrap: false });
        titleParts.push({ text: nameParts.subtitle, className: "map-content-subtitle" });
      }
      appendLine(listItem, titleParts, "map-content-title-line");

      const locationLine = [];
      if (location) {
        locationLine.push({ text: capitalizeFirst(location), className: "map-content-location-text" });
      }
      if (touches) {
        if (locationLine.length) {
          locationLine.push({ text: " (", className: "map-content-location-paren", wrap: false });
          locationLine.push({ text: touches, className: "map-content-touches" });
          locationLine.push({ text: ")", className: "map-content-location-paren", wrap: false });
        } else {
          locationLine.push({ text: touches, className: "map-content-touches" });
        }
      }
      if (locationLine.length) {
        appendLine(listItem, locationLine, "map-content-location");
      }

      const components = visibleGeometry && Array.isArray(visibleGeometry.components)
        ? visibleGeometry.components
        : [];
      const coverage = visibleGeometry && visibleGeometry.coverage ? visibleGeometry.coverage : null;
      const partsLine = [];
      let coveragePercentText = null;
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
          coveragePercentText = interpolate(
            t("map_content_total_area", "Covers __percent__% of map"),
            { percent: percentText }
          );
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
      if (shape && shape.type && shape.type !== "regular") {
        const shapeLineParts = [];
        const aspectRatio = shape.aspectRatio;
        const aspectText = formatAspect(aspectRatio);
        let descriptor = null;
        if (aspectRatio >= 3.5) {
          descriptor = t("map_content_shape_long_thin", "Very thin");
        } else if (aspectRatio >= 2.5) {
          descriptor = t("map_content_shape_elongated", "Thin");
        }
        if (descriptor) {
          if (aspectText) {
            shapeLineParts.push({ text: descriptor, className: "map-content-shape-aspect" });
            shapeLineParts.push({ text: " (", className: "map-content-shape-paren", wrap: false });
            shapeLineParts.push.apply(shapeLineParts, interpolatedParts(
              t("map_content_aspect_label", "aspect __ratio__"),
              { ratio: aspectText },
              "map-content-shape-aspect"
            ));
            shapeLineParts.push({ text: ")", className: "map-content-shape-paren", wrap: false });
          } else {
            shapeLineParts.push({ text: descriptor, className: "map-content-shape-aspect" });
          }
        }
        if (aspectRatio > 2 && shape.orientationLabel) {
          const orientationLabel = orientationAbbrev(shape.orientationLabel);
          const degrees = formatDegrees(shape.orientationDeg);
          if (orientationLabel && degrees) {
            if (shapeLineParts.length) {
              shapeLineParts.push({ text: ", ", className: "map-content-shape-sep", wrap: false });
            }
            shapeLineParts.push.apply(shapeLineParts, interpolatedParts(
              t("map_content_orientation", "orientation __label__ (__deg__)"),
              { label: orientationLabel, deg: degrees },
              "map-content-shape-orientation"
            ));
          }
        }
        const shapeType = shapeTypeLabel(shape.type);
        if (shapeType) {
          if (shapeLineParts.length) {
            shapeLineParts.push({ text: ", ", className: "map-content-shape-sep", wrap: false });
          }
          shapeLineParts.push({ text: shapeType, className: "map-content-shape-type" });
        }
        if (shapeLineParts.length) {
          appendLine(listItem, shapeLineParts, "map-content-shape");
        }
      }

      const coverageLine = coverageBreakdown(coverage);
      if (coverageLine && coveragePercentText && partsLine.length) {
        partsLine.push({ text: " ", className: "map-content-coverage-space", wrap: false });
        partsLine.push({ text: "(", className: "map-content-coverage-paren", wrap: false });
        partsLine.push({ text: coverageLine, className: "map-content-coverage-segments" });
        partsLine.push({ text: ")", className: "map-content-coverage-paren", wrap: false });
      } else if (coverageLine) {
        appendLine(listItem, [
          { text: t("map_content_coverage_label", "Covers:"), className: "map-content-coverage-label", wrap: false },
          { text: " ", className: "map-content-coverage-sep", wrap: false },
          { text: coverageLine, className: "map-content-coverage-segments" }
        ], "map-content-coverage");
      }
      if (partsLine.length) {
        appendLine(listItem, partsLine, "map-content-parts");
      }

      listElem.append(listItem);
    }

    function parseMapContent(payload) {
      if (!payload) {
        return null;
      }
      if (typeof payload === 'string') {
        try {
          return JSON.parse(payload);
        } catch (err) {
          return null;
        }
      }
      return payload;
    }

    function loadMapContent(requestId) {
      if (!requestId || typeof makeCloudFrontMapContentUrl !== 'function') {
        return null;
      }
      const retryCount = 20;
      const retryDelayMs = 500;
      const deferred = $.Deferred();
      let attemptsLeft = retryCount;

      function attempt() {
        const request = $.ajax({
          url: makeCloudFrontMapContentUrl(requestId)
        });
        request.done(function(payload){
          deferred.resolve(payload);
        }).fail(function(){
          if (attemptsLeft > 0) {
            attemptsLeft -= 1;
            setTimeout(attempt, retryDelayMs);
          } else {
            deferred.reject.apply(deferred, arguments);
          }
        });
      }

      attempt();
      return deferred.promise();
    }

    function showMessage(listElem, message) {
      listElem.empty();
      listElem.append($("<li>").text(message));
    }

    // Entry point: read map-content.json and populate "Map content" block
    function insertMapDescription(info, container) {
      if (!container || !container.length) {
        return;
      }
      const listElem = container.find(".map-content-buildings");
      if (!listElem.length) {
        return;
      }
      listElem.empty();
      const requestId = info ? info.requestId : null;
      const request = loadMapContent(requestId);
      if (!request) {
        showMessage(listElem, t("map_content_unavailable", "Map content is not available."));
        return;
      }
      request.done(function(payload){
        const mapContent = parseMapContent(payload);
        const groups = collectBuildingGroups(mapContent);
        if (!groups.length) {
          showMessage(listElem, t("map_content_no_buildings", "No buildings listed for this map."));
          return;
        }
        listElem.empty();
        groups.forEach(function(group){
          renderBuilding(group, listElem);
        });
      }).fail(function(){
        showMessage(listElem, t("map_content_unavailable", "Map content is not available."));
      });
    }

    window.insertMapDescription = insertMapDescription;
})();
