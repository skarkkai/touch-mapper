#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const inspect = require("./inspect-map-description.js");

function parseArgs(argv) {
  const args = {
    osm: null,
    locale: "en"
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--osm") {
      args.osm = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (arg === "--locale") {
      args.locale = argv[i + 1] || "en";
      i += 1;
      continue;
    }
    throw new Error("Unknown argument: " + arg + "\nUsage: check-railway-modes.js --osm <path> [--locale en]");
  }
  if (!args.osm) {
    throw new Error("--osm is required\nUsage: check-railway-modes.js --osm <path> [--locale en]");
  }
  return args;
}

const NON_TRACK_RAILWAY_VALUES = {
  platform: true,
  platform_edge: true,
  station: true,
  halt: true,
  tram_stop: true,
  subway_entrance: true,
  crossing: true,
  level_crossing: true,
  signal: true,
  switch: true,
  buffer_stop: true
};
const TRACK_RAILWAY_VALUES = {
  rail: true,
  narrow_gauge: true,
  tram: true,
  light_rail: true,
  subway: true,
  metro: true,
  yard: true,
  siding: true
};

function sectionCount(model, key) {
  if (!model || typeof model !== "object") {
    return 0;
  }
  const section = model[key];
  if (!section || typeof section !== "object") {
    return 0;
  }
  const count = Number(section.count);
  return Number.isFinite(count) ? count : 0;
}

function lineText(line) {
  if (!line || !Array.isArray(line.parts)) {
    return "";
  }
  return line.parts.map(function(part) {
    return part && part.text ? String(part.text) : "";
  }).join("");
}

function collectConnectionSentences(model) {
  const hits = [];
  ["roads", "paths", "railways", "waterways", "otherLinear"].forEach(function(sectionKey) {
    const section = model && model[sectionKey];
    const items = section && Array.isArray(section.items) ? section.items : [];
    items.forEach(function(item) {
      const lines = item && Array.isArray(item.lines) ? item.lines : [];
      lines.forEach(function(line) {
        const text = lineText(line);
        if (/^connects to\b/i.test(text.trim())) {
          hits.push({ section: sectionKey, text: text.trim() });
        }
      });
    });
  });
  return hits;
}

function findRailwayConnectionSentences(connectionHits) {
  return connectionHits.filter(function(hit) {
    const text = (hit && hit.text ? String(hit.text) : "").toLowerCase();
    return /\brail(?:way|ways|line|lines)?\b/.test(text) ||
      /\btram\b/.test(text) ||
      /\blight rail\b/.test(text) ||
      /\bsubway\b/.test(text) ||
      /\bmetro\b/.test(text);
  });
}

function countTrackRailwayWaysInOsm(osmText) {
  const wayBlocks = String(osmText).match(/<way\b[\s\S]*?<\/way>/g) || [];
  let count = 0;
  wayBlocks.forEach(function(block) {
    const match = block.match(/<tag\s+k="railway"\s+v="([^"]+)"\s*\/?>/i);
    if (!match) {
      return;
    }
    const normalized = String(match[1]).trim().toLowerCase();
    if (!normalized) {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(NON_TRACK_RAILWAY_VALUES, normalized)) {
      return;
    }
    count += 1;
  });
  return count;
}

function readWayRailwayValueById(osmText) {
  const map = {};
  const wayBlocks = String(osmText).match(/<way\b[\s\S]*?<\/way>/g) || [];
  wayBlocks.forEach(function(block) {
    const idMatch = block.match(/\sid="([^"]+)"/i);
    if (!idMatch || !idMatch[1]) {
      return;
    }
    const railMatch = block.match(/<tag\s+k="railway"\s+v="([^"]+)"\s*\/?>/i);
    if (!railMatch || !railMatch[1]) {
      return;
    }
    map[String(idMatch[1])] = String(railMatch[1]).trim().toLowerCase();
  });
  return map;
}

function railwayWayIdsFromMapContent(mapContentPath) {
  const raw = fs.readFileSync(mapContentPath, "utf8");
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error("Failed to parse map-content.json at " + mapContentPath + ": " + error.message);
  }
  const classA = parsed && parsed.A;
  const subclasses = classA && Array.isArray(classA.subclasses) ? classA.subclasses : [];
  const ids = {};
  subclasses.forEach(function(subclass) {
    if (!subclass || typeof subclass.key !== "string" || subclass.key.indexOf("A3_") !== 0) {
      return;
    }
    const groups = Array.isArray(subclass.groups) ? subclass.groups : [];
    groups.forEach(function(group) {
      const ways = group && Array.isArray(group.ways) ? group.ways : [];
      ways.forEach(function(way) {
        if (!way || way.osmId === undefined || way.osmId === null) {
          return;
        }
        ids[String(way.osmId)] = true;
      });
    });
  });
  return Object.keys(ids);
}

function assertRailwaySectionBackedByRailwayTags(label, mapContentPath, wayRailwayValueById) {
  const railwayWayIds = railwayWayIdsFromMapContent(mapContentPath);
  const invalid = [];
  railwayWayIds.forEach(function(id) {
    const railwayValue = wayRailwayValueById[id];
    if (!railwayValue || !TRACK_RAILWAY_VALUES[railwayValue]) {
      invalid.push({ osmId: id, railway: railwayValue || null });
    }
  });
  if (invalid.length) {
    throw new Error(
      label + " map-content has non-railway way ids inside A3_* subclasses: " +
      JSON.stringify(invalid.slice(0, 8))
    );
  }
}

function runScenario(repoRoot, osmPath, locale, contentMode) {
  return inspect.inspectMapDescription({
    repoRoot: repoRoot,
    osmPath: osmPath,
    locale: locale,
    contentMode: contentMode
  });
}

function main() {
  const args = parseArgs(process.argv);
  const repoRoot = path.resolve(__dirname, "..", "..");
  const osmPath = path.resolve(args.osm);
  if (!fs.existsSync(osmPath)) {
    throw new Error("OSM file not found: " + osmPath);
  }

  const normal = runScenario(repoRoot, osmPath, args.locale, "normal");
  const onlyBigRoads = runScenario(repoRoot, osmPath, args.locale, "only-big-roads");
  const osmText = fs.readFileSync(osmPath, "utf8");
  const wayRailwayValueById = readWayRailwayValueById(osmText);
  assertRailwaySectionBackedByRailwayTags("normal", normal.mapContentPath, wayRailwayValueById);
  assertRailwaySectionBackedByRailwayTags("only-big-roads", onlyBigRoads.mapContentPath, wayRailwayValueById);

  const normalRailCount = sectionCount(normal.mapDescriptionModel, "railways");
  const onlyBigRoadsRailCount = sectionCount(onlyBigRoads.mapDescriptionModel, "railways");
  const trackRailwayWays = countTrackRailwayWaysInOsm(osmText);
  if (trackRailwayWays > 0) {
    if (normalRailCount <= 0) {
      throw new Error("Expected railways in normal mode for track-rich OSM, got count=" + normalRailCount);
    }
    if (onlyBigRoadsRailCount <= 0) {
      throw new Error("Expected railways in only-big-roads mode for track-rich OSM, got count=" + onlyBigRoadsRailCount);
    }
  }

  const normalConnections = collectConnectionSentences(normal.mapDescriptionModel);
  const onlyBigRoadsConnections = collectConnectionSentences(onlyBigRoads.mapDescriptionModel);
  const railwaySectionConnections =
    normalConnections.filter(function(hit) { return hit.section === "railways"; })
      .concat(onlyBigRoadsConnections.filter(function(hit) { return hit.section === "railways"; }));
  if (railwaySectionConnections.length) {
    throw new Error("Expected no railway-section connection narration, found: " + JSON.stringify(railwaySectionConnections.slice(0, 6)));
  }

  const railMentioningConnections = findRailwayConnectionSentences(normalConnections.concat(onlyBigRoadsConnections));
  if (railMentioningConnections.length) {
    throw new Error("Expected no rail-derived connection narration, found: " + JSON.stringify(railMentioningConnections.slice(0, 6)));
  }

  process.stdout.write(
    "railway-mode-check OK: trackWays=" + trackRailwayWays +
    ", normal.railways=" + normalRailCount +
    ", only-big-roads.railways=" + onlyBigRoadsRailCount + "\n"
  );
}

main();
