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
        return { title: t("map_content_building_fallback", "Building") };
      }
      const parts = label.split(",");
      let title = parts[0] ? parts[0].trim() : label.trim();
      title = title ? capitalizeFirst(title) : t("map_content_building_fallback", "Building");
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
      if (components && components.length && components[0].location && components[0].location.phrase) {
        return components[0].location.phrase;
      }
      if (item && item.location && item.location.center) {
        return item.location.center;
      }
      if (group && group.location && group.location.center) {
        return group.location.center;
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

    function edgesText(edgesTouched) {
      if (!edgesTouched || !edgesTouched.length) {
        return null;
      }
      const labels = edgesTouched.map(edgeLabel).filter(Boolean);
      if (!labels.length) {
        return null;
      }
      const joined = labels.join(", ");
      if (labels.length === 1) {
        return interpolate(t("map_content_touches_edge", "Touches __edge__ edge"), { edge: joined });
      }
      return interpolate(t("map_content_touches_edges", "Touches __edges__ edges"), { edges: joined });
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
      return num.toFixed(2);
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
      if (shapeType === "thin") {
        return t("map_content_shape_thin", "Thin shape");
      }
      return capitalizeFirst(shapeType) + " shape";
    }

    function tidySegmentPhrase(phrase) {
      if (!phrase || typeof phrase !== 'string') {
        return "";
      }
      let cleaned = phrase.trim();
      cleaned = cleaned.replace(/^near the /i, "");
      cleaned = cleaned.replace(/^in the /i, "");
      cleaned = cleaned.replace(/^a little /i, "");
      cleaned = cleaned.replace(/ of the map$/i, "");
      return cleaned;
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
        const rawPhrase = segment.phrase || segment.dir || segment.zone || "";
        const segmentText = tidySegmentPhrase(rawPhrase);
        return interpolate(t(qualifierKey, "some of __segment__"), { segment: segmentText || rawPhrase });
      });
      const coverageText = phrases.filter(Boolean).join(", ");
      if (!coverageText) {
        return null;
      }
      return interpolate(t("map_content_coverage_label", "Coverage: __segments__"), { segments: coverageText });
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
      return groups;
    }

    function appendLine(listItem, text, className) {
      if (!text) {
        return;
      }
      const line = $("<div>").text(text);
      if (className) {
        line.addClass(className);
      }
      listItem.append(line);
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
      appendLine(listItem, nameParts.title, "map-content-title");
      if (nameParts.subtitle) {
        appendLine(listItem, nameParts.subtitle, "map-content-subtitle");
      }

      const locationLine = [];
      if (location) {
        locationLine.push(capitalizeFirst(location));
      }
      if (touches) {
        locationLine.push(touches);
      }
      if (locationLine.length) {
        appendLine(listItem, locationLine.join(" - "), "map-content-location");
      }

      const components = visibleGeometry && Array.isArray(visibleGeometry.components)
        ? visibleGeometry.components
        : [];
      const coverage = visibleGeometry && visibleGeometry.coverage ? visibleGeometry.coverage : null;
      const partsLine = [];
      if (components && components.length > 1) {
        partsLine.push(interpolate(t("map_content_parts_many", "__count__ parts"), { count: components.length }));
      }
      if (coverage && coverage.coveragePercent !== undefined) {
        const percentText = formatPercent(coverage.coveragePercent);
        if (percentText !== null) {
          partsLine.push(interpolate(t("map_content_total_area", "total ~__percent__% of map"), {
            percent: percentText
          }));
        }
      }
      if (partsLine.length) {
        appendLine(listItem, partsLine.join(", "), "map-content-parts");
      }

      const shape = visibleGeometry && visibleGeometry.shape ? visibleGeometry.shape : null;
      if (shape && shape.type && shape.type !== "regular") {
        const shapeLineParts = [];
        const aspectRatio = shape.aspectRatio;
        const aspectText = formatAspect(aspectRatio);
        let descriptor = null;
        if (aspectRatio >= 3.5) {
          descriptor = t("map_content_shape_long_thin", "Long & thin");
        } else if (aspectRatio >= 2) {
          descriptor = t("map_content_shape_elongated", "Elongated");
        }
        if (descriptor) {
          if (aspectText) {
            const aspectLabel = interpolate(t("map_content_aspect_label", "aspect __ratio__"), { ratio: aspectText });
            shapeLineParts.push(descriptor + " (" + aspectLabel + ")");
          } else {
            shapeLineParts.push(descriptor);
          }
        }
        if (aspectRatio > 2 && shape.orientationLabel) {
          const orientationLabel = orientationAbbrev(shape.orientationLabel);
          const degrees = formatDegrees(shape.orientationDeg);
          if (orientationLabel && degrees) {
            shapeLineParts.push(interpolate(t("map_content_orientation", "orientation __label__ (__deg__)"), {
              label: orientationLabel,
              deg: degrees
            }));
          }
        }
        const shapeType = shapeTypeLabel(shape.type);
        if (shapeType) {
          shapeLineParts.push(shapeType);
        }
        if (shapeLineParts.length) {
          appendLine(listItem, shapeLineParts.join(", "), "map-content-shape");
        }
      }

      const coverageLine = coverageBreakdown(coverage);
      if (coverageLine) {
        appendLine(listItem, coverageLine, "map-content-coverage");
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
      return $.ajax({
        url: makeCloudFrontMapContentUrl(requestId)
      });
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
