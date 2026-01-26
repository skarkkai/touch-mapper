/* global window */
/*
Usage (CLI):
  node web/src/scripts/map-description-classifier-render.js /path/to/map-meta.json

If no path is provided, it tries:
  1) ./map-meta.json
  2) ./test/data/map-meta.indented.json

Output:
  Prints a compact, human-readable classification summary to stdout.
*/
/* eslint no-console:0 */

(function(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TM = root.TM || {};
    root.TM.mapDescriptionClassifierRender = factory();
  }
})(typeof self !== "undefined" ? self : this, function() {
  "use strict";

  var MAX_ITEMS_PER_SUBCLASS = 10;

  function getName(tags) {
    if (!tags) return null;
    return (
      tags.name ||
      tags["name:en"] ||
      tags["name:fi"] ||
      tags["name:sv"] ||
      tags.loc_name ||
      tags.short_name ||
      null
    );
  }

  function normalizeLabel(value) {
    if (!value) return null;
    return String(value).replace(/_/g, " ");
  }

  function formatMeters(lengthMeters) {
    if (lengthMeters === null || lengthMeters === undefined || !isFinite(lengthMeters)) return null;
    var length = Math.max(0, lengthMeters);
    var rounded;
    if (length >= 1000) {
      rounded = Math.round(length / 10) * 10;
    } else if (length >= 100) {
      rounded = Math.round(length / 5) * 5;
    } else {
      rounded = Math.round(length);
    }
    return rounded + " m";
  }

  function formatArea(areaSqM) {
    if (areaSqM === null || areaSqM === undefined || !isFinite(areaSqM)) return null;
    var area = Math.max(0, areaSqM);
    if (area >= 10000) {
      var ha = area / 10000;
      var digits = ha >= 10 ? 0 : 1;
      return "~" + ha.toFixed(digits) + " ha";
    }
    return "~" + Math.round(area) + " m^2";
  }

  function coordKey(coord) {
    return Number(coord[0]).toFixed(3) + "," + Number(coord[1]).toFixed(3);
  }

  function buildRoadNamesByCoord(mapData) {
    var map = new Map();
    var ways = mapData.ways || [];
    for (var i = 0; i < ways.length; i += 1) {
      var way = ways[i];
      var coords = way.geometry && way.geometry.coordinates;
      if (!Array.isArray(coords)) continue;
      var name = getName(way.tags);
      if (!name) continue;
      for (var j = 0; j < coords.length; j += 1) {
        var key = coordKey(coords[j]);
        var set = map.get(key);
        if (!set) {
          set = new Set();
          map.set(key, set);
        }
        set.add(name);
      }
    }
    return map;
  }

  function computeLineLength(geometry) {
    if (!geometry || geometry.type !== "line_string" || !Array.isArray(geometry.coordinates)) return null;
    var coords = geometry.coordinates;
    var length = 0;
    for (var i = 1; i < coords.length; i += 1) {
      var a = coords[i - 1];
      var b = coords[i];
      var dx = b[0] - a[0];
      var dy = b[1] - a[1];
      length += Math.sqrt(dx * dx + dy * dy);
    }
    return length;
  }

  function ringArea(coords) {
    if (!coords || coords.length < 3) return 0;
    var sum = 0;
    for (var i = 0; i < coords.length; i += 1) {
      var p1 = coords[i];
      var p2 = coords[(i + 1) % coords.length];
      sum += p1[0] * p2[1] - p2[0] * p1[1];
    }
    return Math.abs(sum) / 2;
  }

  function computeArea(geometry, bounds) {
    if (geometry && geometry.type === "polygon") {
      var area = 0;
      if (Array.isArray(geometry.outer)) {
        area += ringArea(geometry.outer);
      } else if (Array.isArray(geometry.coordinates) && Array.isArray(geometry.coordinates[0])) {
        area += ringArea(geometry.coordinates);
      }
      if (Array.isArray(geometry.holes)) {
        for (var i = 0; i < geometry.holes.length; i += 1) {
          area -= ringArea(geometry.holes[i]);
        }
      }
      return Math.abs(area);
    }
    if (bounds) {
      var width = Math.abs(bounds.maxX - bounds.minX);
      var height = Math.abs(bounds.maxY - bounds.minY);
      if (isFinite(width) && isFinite(height)) return width * height;
    }
    return null;
  }

  function modifiersSuffix(modifiers) {
    if (!modifiers || !modifiers.length) return "";
    var labels = modifiers.map(function(mod) {
      if (mod.value !== undefined && mod.value !== null) {
        return mod.name + "=" + mod.value;
      }
      return mod.name;
    });
    return " [" + labels.join(", ") + "]";
  }

  function summarizeLinear(item) {
    var name = getName(item.tags) || "(unnamed)";
    var length = formatMeters(computeLineLength(item.geometry));
    var modSuffix = modifiersSuffix(item._classification && item._classification.modifiers);
    if (length) return name + " — " + length + modSuffix;
    return name + modSuffix;
  }

  function connectedRoadNames(item, roadNamesByCoord) {
    if (!item.geometry || !Array.isArray(item.geometry.coordinates)) return [];
    var key = coordKey(item.geometry.coordinates);
    var set = roadNamesByCoord.get(key);
    if (!set) return [];
    return Array.from(set);
  }

  function summarizeConnectivity(item, roadNamesByCoord) {
    var role = (item._classification && item._classification.role) || "node";
    var names = connectedRoadNames(item, roadNamesByCoord);
    if (!names.length) return role + ": (unnamed)";
    return role + ": " + names.join(" x ");
  }

  function summarizeBuilding(item) {
    var tags = item.tags || {};
    var amenity = normalizeLabel(tags.amenity);
    var buildingUse = normalizeLabel(tags["building:use"]);
    var building = normalizeLabel(tags.building);
    var subtype = item._classification && item._classification.subClass;
    var typeLabel = null;
    if (amenity) {
      typeLabel = amenity;
    } else if (buildingUse) {
      typeLabel = buildingUse;
    } else if (building && building !== "yes") {
      typeLabel = building + " building";
    } else if (subtype === "C1_landmark") {
      typeLabel = "landmark building";
    } else if (subtype === "C2_public") {
      typeLabel = "public building";
    } else {
      typeLabel = "building";
    }

    var name = getName(tags);
    var street = tags["addr:street"];
    var number = tags["addr:housenumber"];
    var address = street && number ? street + " " + number : null;

    var parts = [typeLabel];
    if (name) parts.push(name);
    if (address) parts.push(address);
    return parts.join(", ");
  }

  function summarizePoi(item) {
    var tags = item.tags || {};
    var subtype = item._classification && item._classification.subClass;
    var category = "poi";
    if (subtype === "D1_transport") category = "transport";
    else if (subtype === "D2_civic") category = "civic";
    else if (subtype === "D3_commercial") category = "commercial";
    else if (subtype === "D4_leisure_cultural") category = "leisure";

    var qualifier = normalizeLabel(tags.public_transport) ||
      normalizeLabel(tags.railway) ||
      normalizeLabel(tags.amenity) ||
      normalizeLabel(tags.shop) ||
      normalizeLabel(tags.tourism) ||
      normalizeLabel(tags.leisure);

    var name = getName(tags);
    var label = qualifier || category;
    if (name) return label + ": " + name;
    return label;
  }

  function areaTypeLabel(subClass) {
    var map = {
      B1_lakes: "lake",
      B1_ponds: "pond",
      B1_reservoirs: "reservoir",
      B1_sea_coast: "sea",
      B1_riverbanks: "riverbank",
      B1_other_water: "water",
      B2_parks_recreation: "park",
      B2_forests: "forest",
      B2_fields_open: "open land",
      B3_residential: "residential area",
      B3_commercial: "commercial area",
      B3_industrial: "industrial area",
      B_other_areas: "area",
      E1_admin_boundaries: "admin boundary",
      E2_coastlines: "coastline",
      E3_fences_walls: "fence/wall"
    };
    return map[subClass] || "area";
  }

  function summarizeArea(item) {
    var subtype = item._classification && item._classification.subClass;
    var label = areaTypeLabel(subtype);
    var name = getName(item.tags);
    var size = formatArea(computeArea(item.geometry, item.bounds));
    var base = name ? label + ": " + name : label + " (unnamed)";
    if (size) return base + ", " + size;
    return base;
  }

  function summarizeBoundary(item) {
    var subtype = item._classification && item._classification.subClass;
    var label = areaTypeLabel(subtype);
    var name = getName(item.tags);
    var length = formatMeters(computeLineLength(item.geometry));
    var summary = name ? label + ": " + name : label;
    if (length) summary += " — " + length;
    return summary;
  }

  function sortItems(items, kind, roadNamesByCoord) {
    return items.slice().sort(function(a, b) {
      var nameA = getName(a.tags);
      var nameB = getName(b.tags);
      var namedA = !!nameA;
      var namedB = !!nameB;
      if (namedA !== namedB) return namedA ? -1 : 1;

      if (kind === "linear") {
        var lenA = computeLineLength(a.geometry) || 0;
        var lenB = computeLineLength(b.geometry) || 0;
        if (lenA !== lenB) return lenB - lenA;
      } else if (kind === "area") {
        var areaA = computeArea(a.geometry, a.bounds) || 0;
        var areaB = computeArea(b.geometry, b.bounds) || 0;
        if (areaA !== areaB) return areaB - areaA;
      } else if (kind === "connectivity") {
        var countA = connectedRoadNames(a, roadNamesByCoord).length;
        var countB = connectedRoadNames(b, roadNamesByCoord).length;
        if (countA !== countB) return countB - countA;
      }

      var labelA = nameA || "";
      var labelB = nameB || "";
      if (labelA < labelB) return -1;
      if (labelA > labelB) return 1;
      return 0;
    });
  }

  function renderGrouped(grouped, spec, mapData) {
    var lines = [];
    var roadNamesByCoord = buildRoadNamesByCoord(mapData);
    var classes = spec.classes || {};
    var mainKeys = Object.keys(classes).sort();

    mainKeys.forEach(function(mainKey) {
      var mainName = classes[mainKey] && classes[mainKey].name ? classes[mainKey].name : mainKey;
      lines.push(mainKey + " — " + mainName);

      var subGroups = grouped[mainKey] || {};
      var subOrder = classes[mainKey] && classes[mainKey].subclasses ? Object.keys(classes[mainKey].subclasses) : [];
      var subKeys = subOrder.filter(function(k) { return subGroups[k] && subGroups[k].length; });
      Object.keys(subGroups).forEach(function(k) {
        if (subKeys.indexOf(k) === -1 && subGroups[k] && subGroups[k].length) subKeys.push(k);
      });

      if (!subKeys.length) {
        lines.push("  (no items)");
        lines.push("");
        return;
      }

      subKeys.forEach(function(subKey) {
        var items = subGroups[subKey] || [];
        if (!items.length) return;
        var subName = (classes[mainKey] && classes[mainKey].subclasses && classes[mainKey].subclasses[subKey]) || subKey;
        lines.push("  " + subKey + " — " + subName + " (" + items.length + ")");

        var kind = "linear";
        if (mainKey === "A" && subKey === "A5_connectivity_nodes") kind = "connectivity";
        else if (mainKey === "C") kind = "building";
        else if (mainKey === "D") kind = "poi";
        else if (mainKey === "B") kind = "area";
        else if (mainKey === "E") {
          var geom = items[0] && items[0].geometry && items[0].geometry.type;
          kind = geom === "polygon" ? "area" : "linear";
        }

        var sorted = sortItems(items, kind, roadNamesByCoord);
        var display = sorted.slice(0, MAX_ITEMS_PER_SUBCLASS);
        display.forEach(function(item) {
          var summary;
          if (kind === "connectivity") summary = summarizeConnectivity(item, roadNamesByCoord);
          else if (kind === "building") summary = summarizeBuilding(item);
          else if (kind === "poi") summary = summarizePoi(item);
          else if (kind === "area") summary = summarizeArea(item);
          else if (mainKey === "E") summary = summarizeBoundary(item);
          else summary = summarizeLinear(item);
          lines.push("    - " + summary);
        });
        if (sorted.length > MAX_ITEMS_PER_SUBCLASS) {
          lines.push("    - ... (+" + (sorted.length - MAX_ITEMS_PER_SUBCLASS) + " more)");
        }
      });

      lines.push("");
    });

    return lines.join("\n").trim();
  }

  function runStandalone(args) {
    var fs = require("fs");
    var path = require("path");
    var classifier = require("./map-description-classifier");
    var specPath = path.join(__dirname, "map-description-classifications.json");
    var spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
    var inputPath = args[0] || path.join(process.cwd(), "map-meta.json");
    if (!fs.existsSync(inputPath)) {
      inputPath = path.join(process.cwd(), "test/data/map-meta.indented.json");
    }
    var mapData = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    var grouped = classifier.groupMapData(mapData, spec, null);
    var output = renderGrouped(grouped, spec, mapData);
    console.log(output);
    return output;
  }

  return {
    renderGrouped: renderGrouped,
    runStandalone: runStandalone
  };
});

if (typeof module === "object" && module.exports && require.main === module) {
  var args = process.argv.slice(2);
  module.exports.runStandalone(args);
}
