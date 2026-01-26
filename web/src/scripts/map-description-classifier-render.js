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

  const MAX_ITEMS_PER_SUBCLASS = 10;

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

  function locationPhrase(location) {
    if (!location || !location.phrase) return null;
    return location.phrase;
  }

  function normalizeLabel(value) {
    if (!value) return null;
    return String(value).replace(/_/g, " ");
  }

  function formatMeters(lengthMeters) {
    if (lengthMeters === null || lengthMeters === undefined || !isFinite(lengthMeters)) return null;
    const length = Math.max(0, lengthMeters);
    let rounded;
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
    const area = Math.max(0, areaSqM);
    if (area >= 10000) {
      const ha = area / 10000;
      const digits = ha >= 10 ? 0 : 1;
      return "~" + ha.toFixed(digits) + " ha";
    }
    return "~" + Math.round(area) + " m^2";
  }

  function coordKey(coord) {
    return Number(coord[0]).toFixed(3) + "," + Number(coord[1]).toFixed(3);
  }

  function buildRoadNamesByCoord(mapData) {
    const map = new Map();
    const ways = mapData.ways || [];
    for (let i = 0; i < ways.length; i += 1) {
      const way = ways[i];
      const coords = way.geometry && way.geometry.coordinates;
      if (!Array.isArray(coords)) continue;
      const name = getName(way.tags);
      if (!name) continue;
      for (let j = 0; j < coords.length; j += 1) {
        const key = coordKey(coords[j]);
        let set = map.get(key);
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
    const coords = geometry.coordinates;
    let length = 0;
    for (let i = 1; i < coords.length; i += 1) {
      const a = coords[i - 1];
      const b = coords[i];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      length += Math.sqrt(dx * dx + dy * dy);
    }
    return length;
  }

  function ringArea(coords) {
    if (!coords || coords.length < 3) return 0;
    let sum = 0;
    for (let i = 0; i < coords.length; i += 1) {
      const p1 = coords[i];
      const p2 = coords[(i + 1) % coords.length];
      sum += p1[0] * p2[1] - p2[0] * p1[1];
    }
    return Math.abs(sum) / 2;
  }

  function computeArea(geometry, bounds) {
    if (geometry && geometry.type === "polygon") {
      let area = 0;
      if (Array.isArray(geometry.outer)) {
        area += ringArea(geometry.outer);
      } else if (Array.isArray(geometry.coordinates) && Array.isArray(geometry.coordinates[0])) {
        area += ringArea(geometry.coordinates);
      }
      if (Array.isArray(geometry.holes)) {
        for (let i = 0; i < geometry.holes.length; i += 1) {
          area -= ringArea(geometry.holes[i]);
        }
      }
      return Math.abs(area);
    }
    if (bounds) {
      const width = Math.abs(bounds.maxX - bounds.minX);
      const height = Math.abs(bounds.maxY - bounds.minY);
      if (isFinite(width) && isFinite(height)) return width * height;
    }
    return null;
  }

  function modifiersSuffix(modifiers) {
    if (!modifiers || !modifiers.length) return "";
    const labels = modifiers.map(function(mod) {
      if (mod.value !== undefined && mod.value !== null) {
        return mod.name + "=" + mod.value;
      }
      return mod.name;
    });
    return " [" + labels.join(", ") + "]";
  }

  function summarizeLinearBase(item) {
    const name = getName(item.tags) || "(unnamed)";
    const modSuffix = modifiersSuffix(item._classification && item._classification.modifiers);
    const cls = item._classification || {};
    const startPhrase = locationPhrase(cls.locationStart);
    const endPhrase = locationPhrase(cls.locationEnd);
    const centerPhrase = locationPhrase(cls.locationCenter);
    let locationText = null;
    if (startPhrase || endPhrase || centerPhrase) {
      if (startPhrase && endPhrase && startPhrase === endPhrase) {
        locationText = startPhrase;
        if (centerPhrase && centerPhrase !== startPhrase) {
          locationText += " (center: " + centerPhrase + ")";
        } else if (centerPhrase && centerPhrase === startPhrase) {
          locationText += " (center: " + centerPhrase + ")";
        }
      } else {
        locationText = (startPhrase && endPhrase) ? (startPhrase + " -> " + endPhrase) : (startPhrase || endPhrase);
        if (centerPhrase) locationText += " (center: " + centerPhrase + ")";
      }
    }
    return {
      label: name + modSuffix,
      locationText: locationText,
      length: computeLineLength(item.geometry),
      hasName: name !== "(unnamed)"
    };
  }

  function connectedRoadNames(item, roadNamesByCoord) {
    if (!item.geometry || !Array.isArray(item.geometry.coordinates)) return [];
    const key = coordKey(item.geometry.coordinates);
    const set = roadNamesByCoord.get(key);
    if (!set) return [];
    return Array.from(set);
  }

  function summarizeConnectivityBase(item, roadNamesByCoord) {
    const role = (item._classification && item._classification.role) || "node";
    const names = connectedRoadNames(item, roadNamesByCoord);
    const label = names.length ? (role + ": " + names.join(" x ")) : (role + ": (unnamed)");
    return {
      label: label,
      hasName: names.length > 0
    };
  }

  function summarizeBuildingBase(item) {
    const tags = item.tags || {};
    const amenity = normalizeLabel(tags.amenity);
    const buildingUse = normalizeLabel(tags["building:use"]);
    const building = normalizeLabel(tags.building);
    const subtype = item._classification && item._classification.subClass;
    let typeLabel = null;
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

    const name = getName(tags);
    const street = tags["addr:street"];
    const number = tags["addr:housenumber"];
    const address = street && number ? street + " " + number : null;

    const parts = [typeLabel];
    if (name) parts.push(name);
    if (address) parts.push(address);
    return {
      label: parts.join(", "),
      locationText: locationPhrase(item._classification && item._classification.locationCenter),
      hasName: !!name
    };
  }

  function summarizePoiBase(item) {
    const tags = item.tags || {};
    const subtype = item._classification && item._classification.subClass;
    let category = "poi";
    if (subtype === "D1_transport") category = "transport";
    else if (subtype === "D2_civic") category = "civic";
    else if (subtype === "D3_commercial") category = "commercial";
    else if (subtype === "D4_leisure_cultural") category = "leisure";

    const qualifier = normalizeLabel(tags.public_transport) ||
      normalizeLabel(tags.railway) ||
      normalizeLabel(tags.amenity) ||
      normalizeLabel(tags.shop) ||
      normalizeLabel(tags.tourism) ||
      normalizeLabel(tags.leisure);

    const name = getName(tags);
    const label = qualifier || category;
    if (name) {
      return {
        label: label + ": " + name,
        locationText: locationPhrase(item._classification && item._classification.location),
        hasName: true
      };
    }
    return {
      label: label,
      locationText: locationPhrase(item._classification && item._classification.location),
      hasName: false
    };
  }

  function areaTypeLabel(subClass) {
    const map = {
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

  function summarizeAreaBase(item) {
    const subtype = item._classification && item._classification.subClass;
    const label = areaTypeLabel(subtype);
    const name = getName(item.tags);
    const base = name ? label + ": " + name : label + " (unnamed)";
    return {
      label: base,
      locationText: locationPhrase(item._classification && item._classification.locationCenter),
      area: computeArea(item.geometry, item.bounds),
      hasName: !!name
    };
  }

  function summarizeBoundaryBase(item) {
    const subtype = item._classification && item._classification.subClass;
    const label = areaTypeLabel(subtype);
    const name = getName(item.tags);
    const summary = name ? label + ": " + name : label;
    return {
      label: summary,
      locationText: locationPhrase(item._classification && item._classification.locationCenter),
      length: computeLineLength(item.geometry),
      hasName: !!name
    };
  }

  function sortGroups(groups, kind) {
    return groups.sort(function(a, b) {
      if (a.hasName !== b.hasName) return a.hasName ? -1 : 1;
      if (kind === "linear" || kind === "boundary") {
        if (a.totalLength !== b.totalLength) return b.totalLength - a.totalLength;
      } else if (kind === "area") {
        if (a.totalArea !== b.totalArea) return b.totalArea - a.totalArea;
      } else if (kind === "connectivity") {
        if (a.count !== b.count) return b.count - a.count;
      }
      if (a.label < b.label) return -1;
      if (a.label > b.label) return 1;
      return 0;
    });
  }

  function buildGroups(items, kind, roadNamesByCoord) {
    const map = new Map();
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      let base;
      if (kind === "connectivity") base = summarizeConnectivityBase(item, roadNamesByCoord);
      else if (kind === "building") base = summarizeBuildingBase(item);
      else if (kind === "poi") base = summarizePoiBase(item);
      else if (kind === "area") base = summarizeAreaBase(item);
      else if (kind === "boundary") base = summarizeBoundaryBase(item);
      else base = summarizeLinearBase(item);

      const key = base.label + "||" + (base.locationText || "");
      let group = map.get(key);
      if (!group) {
        group = {
          label: base.label,
          locationText: base.locationText || null,
          count: 0,
          hasName: base.hasName,
          totalLength: 0,
          totalArea: 0
        };
        map.set(key, group);
      }
      group.count += 1;
      group.hasName = group.hasName || base.hasName;
      if (base.length) group.totalLength += base.length;
      if (base.area) group.totalArea += base.area;
    }
    return Array.from(map.values());
  }

  function renderGroupLine(group, kind) {
    if (group.count === 1) {
      if (kind === "linear") {
        const len = formatMeters(group.totalLength);
        if (len && group.locationText) return group.label + " — " + len + " — " + group.locationText;
        if (len) return group.label + " — " + len;
        return group.locationText ? (group.label + " — " + group.locationText) : group.label;
      }
      if (kind === "boundary") {
        const bLen = formatMeters(group.totalLength);
        if (bLen && group.locationText) return group.label + " — " + bLen + " — " + group.locationText;
        if (bLen) return group.label + " — " + bLen;
        return group.locationText ? (group.label + " — " + group.locationText) : group.label;
      }
      if (kind === "area") {
        const area = formatArea(group.totalArea);
        if (area && group.locationText) return group.label + ", " + area + " — " + group.locationText;
        if (area) return group.label + ", " + area;
        return group.locationText ? (group.label + " — " + group.locationText) : group.label;
      }
      return group.locationText ? (group.label + " — " + group.locationText) : group.label;
    }

    const prefix = group.count + " x " + group.label;
    if (kind === "linear" || kind === "boundary") {
      const totalLen = formatMeters(group.totalLength);
      if (totalLen && group.locationText) return prefix + " — total " + totalLen + " — " + group.locationText;
      if (totalLen) return prefix + " — total " + totalLen;
      return group.locationText ? (prefix + " — " + group.locationText) : prefix;
    }
    if (kind === "area") {
      const totalArea = formatArea(group.totalArea);
      if (totalArea && group.locationText) return prefix + " — total " + totalArea + " — " + group.locationText;
      if (totalArea) return prefix + " — total " + totalArea;
      return group.locationText ? (prefix + " — " + group.locationText) : prefix;
    }
    return group.locationText ? (prefix + " — " + group.locationText) : prefix;
  }

  function renderGrouped(grouped, spec, mapData) {
    const lines = [];
    const roadNamesByCoord = buildRoadNamesByCoord(mapData);
    const classes = spec.classes || {};
    const mainKeys = Object.keys(classes).sort();

    mainKeys.forEach(function(mainKey) {
      const mainName = classes[mainKey] && classes[mainKey].name ? classes[mainKey].name : mainKey;
      lines.push(mainKey + " — " + mainName);

      const subGroups = grouped[mainKey] || {};
      const subOrder = classes[mainKey] && classes[mainKey].subclasses ? Object.keys(classes[mainKey].subclasses) : [];
      const subKeys = subOrder.filter(function(k) { return subGroups[k] && subGroups[k].length; });
      Object.keys(subGroups).forEach(function(k) {
        if (subKeys.indexOf(k) === -1 && subGroups[k] && subGroups[k].length) subKeys.push(k);
      });

      if (!subKeys.length) {
        lines.push("  (no items)");
        lines.push("");
        return;
      }

      subKeys.forEach(function(subKey) {
        const items = subGroups[subKey] || [];
        if (!items.length) return;
        const subName = (classes[mainKey] && classes[mainKey].subclasses && classes[mainKey].subclasses[subKey]) || subKey;
        lines.push("  " + subKey + " — " + subName + " (" + items.length + ")");

        let kind = "linear";
        if (mainKey === "A" && subKey === "A5_connectivity_nodes") kind = "connectivity";
        else if (mainKey === "C") kind = "building";
        else if (mainKey === "D") kind = "poi";
        else if (mainKey === "B") kind = "area";
        else if (mainKey === "E") {
          const geom = items[0] && items[0].geometry && items[0].geometry.type;
          kind = geom === "polygon" ? "area" : "linear";
        }

        const groupedItems = buildGroups(items, kind, roadNamesByCoord);
        const sortedGroups = sortGroups(groupedItems, kind === "linear" && mainKey === "E" ? "boundary" : kind);
        const display = sortedGroups.slice(0, MAX_ITEMS_PER_SUBCLASS);
        display.forEach(function(group) {
          lines.push("    - " + renderGroupLine(group, kind === "linear" && mainKey === "E" ? "boundary" : kind));
        });
        if (sortedGroups.length > MAX_ITEMS_PER_SUBCLASS) {
          lines.push("    - ... (+" + (sortedGroups.length - MAX_ITEMS_PER_SUBCLASS) + " more)");
        }
      });

      lines.push("");
    });

    return lines.join("\n").trim();
  }

  function runStandalone(args) {
    const fs = require("fs");
    const path = require("path");
    const classifier = require("./map-description-classifier");
    const specPath = path.join(__dirname, "map-description-classifications.json");
    const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
    let inputPath = args[0] || path.join(process.cwd(), "map-meta.json");
    if (!fs.existsSync(inputPath)) {
      inputPath = path.join(process.cwd(), "test/data/map-meta.indented.json");
    }
    const mapData = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    const grouped = classifier.groupMapData(mapData, spec, null);
    const output = renderGrouped(grouped, spec, mapData);
    console.log(output);
    return output;
  }

  return {
    renderGrouped: renderGrouped,
    runStandalone: runStandalone
  };
});

if (typeof module === "object" && module.exports && require.main === module) {
  const args = process.argv.slice(2);
  module.exports.runStandalone(args);
}
