/* global $ */
/* eslint quotes:0, space-unary-ops:0, no-alert:0, no-unused-vars:0, no-shadow:0, no-extend-native:0, no-trailing-spaces:0, space-infix-ops:0, camelcase:0, dot-notation:0 */

(function(){
  'use strict';

  const TRANSPORT_TYPES = {
    "station": true,
    "stop position": true,
    "platform": true,
    "stop area": true,
    "stop area group": true,
    "halt": true,
    "tram stop": true,
    "subway entrance": true,
    "bus station": true,
    "ferry terminal": true,
    "taxi": true
  };

  const DAILY_TYPES = {
    "pharmacy": true,
    "hospital": true,
    "clinic": true,
    "doctors": true,
    "toilets": true,
    "post office": true,
    "bank": true,
    "atm": true,
    "fuel": true,
    "supermarket": true,
    "convenience": true,
    "kiosk": true,
    "restaurant": true,
    "cafe": true,
    "fast food": true,
    "bar": true,
    "pub": true,
    "marketplace": true,
    "mall": true,
    "department store": true
  };

  const FAMILIAR_TYPES = {
    "library": true,
    "place of worship": true,
    "townhall": true,
    "courthouse": true,
    "community centre": true,
    "university": true,
    "college": true,
    "museum": true,
    "gallery": true,
    "attraction": true,
    "viewpoint": true,
    "zoo": true,
    "theme park": true,
    "aquarium": true,
    "park": true,
    "arts centre": true,
    "mall": true,
    "department store": true
  };

  const LOW_SALIENCE_TYPES = {
    "bench": true,
    "waste basket": true,
    "vending machine": true,
    "bicycle parking": true,
    "street lamp": true,
    "outdoor seating": true
  };
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

  function normalizeTypeLabel(typeLabel) {
    if (!typeLabel || typeof typeLabel !== 'string') {
      return t("map_content_poi_unknown_type", "Unknown place type");
    }
    const trimmed = typeLabel.trim();
    if (!trimmed || trimmed.toLowerCase() === "poi") {
      return t("map_content_poi_unknown_type", "Unknown place type");
    }
    const translated = translatedOsmValue(trimmed);
    return translated || trimmed;
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

  function locationPhraseFromLoc(loc, form) {
    if (!loc || typeof loc !== 'object') {
      return null;
    }
    const phraseForm = form || "clause";
    const kind = loc.kind;
    const dirLabel = loc.dir ? directionLabel(loc.dir) : null;
    const corner = loc.dir ? cornerLabel(loc.dir) : null;

    if (kind === "center") {
      if (phraseForm === "endpoint") {
        return t("map_content_loc_endpoint_center", "the center");
      }
      return t("map_content_loc_full_center", "in the center");
    }
    if (kind === "part") {
      if (!dirLabel) {
        return t("map_content_loc_full_center", "in the center");
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
        if (phraseForm === "endpoint") {
          return interpolate(t("map_content_loc_endpoint_corner", "the __corner__"), { corner: corner });
        }
        return interpolate(t("map_content_loc_full_near_corner", "in the __corner__"), { corner: corner });
      }
      if (!dirLabel) {
        return null;
      }
      const key = phraseForm === "endpoint"
        ? "map_content_loc_endpoint_near_edge"
        : "map_content_loc_full_near_edge";
      return interpolate(t(key, "near the __dir__ edge"), { dir: dirLabel });
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

  function locationValue(entry) {
    const group = entry && entry.group ? entry.group : null;
    const item = entry && entry.item ? entry.item : null;
    if (item && item.location && item.location.point) {
      return item.location.point;
    }
    if (group && group.location && group.location.point) {
      return group.location.point;
    }
    if (item && item.location && item.location.center) {
      return item.location.center;
    }
    if (group && group.location && group.location.center) {
      return group.location.center;
    }
    return null;
  }

  function locationKey(entry) {
    const value = locationValue(entry);
    if (!value || !value.loc) {
      return "";
    }
    const kind = value.loc.kind || "";
    const dir = value.loc.dir || "";
    return String(kind) + ":" + String(dir);
  }

  function locationRank(entry) {
    const value = locationValue(entry);
    const loc = value && value.loc ? value.loc : null;
    if (!loc) {
      return 0;
    }
    if (loc.kind === "center") {
      return 3;
    }
    if (loc.kind === "part") {
      return 2;
    }
    if (loc.kind === "near_edge") {
      return 1;
    }
    return 0;
  }

  function parseTypeAndName(group, item) {
    const displayLabel = group && typeof group.displayLabel === 'string'
      ? group.displayLabel
      : (item && typeof item.displayLabel === 'string' ? item.displayLabel : "");
    const label = group && typeof group.label === 'string'
      ? group.label
      : (item && typeof item.label === 'string' ? item.label : null);
    const parts = displayLabel ? displayLabel.split(":") : [];
    if (parts.length >= 2) {
      return {
        typeLabel: parts[0].trim(),
        name: label ? label.trim() : parts.slice(1).join(":").trim()
      };
    }
    return {
      typeLabel: displayLabel ? displayLabel.trim() : "",
      name: label ? label.trim() : null
    };
  }

  function normalizedLower(value) {
    if (!value || typeof value !== 'string') {
      return "";
    }
    return value.trim().toLowerCase();
  }

  function sectionForEntry(entry) {
    const typeNorm = normalizedLower(entry.typeLabel);
    if (TRANSPORT_TYPES[typeNorm]) {
      return "transport_points";
    }
    if (DAILY_TYPES[typeNorm]) {
      return "daily_essentials";
    }
    if (FAMILIAR_TYPES[typeNorm]) {
      return "familiar_places";
    }
    if (entry.subClass === "D1_transport") {
      return "transport_points";
    }
    if (entry.subClass === "D3_commercial") {
      return "daily_essentials";
    }
    if (entry.subClass === "D2_civic" || entry.subClass === "D4_leisure_cultural") {
      return "familiar_places";
    }
    if (entry.hasName) {
      return "familiar_places";
    }
    return "daily_essentials";
  }

  function salienceScore(entry) {
    let score = 0;
    if (entry.subClass === "D1_transport") score += 80;
    if (entry.subClass === "D2_civic") score += 90;
    if (entry.subClass === "D3_commercial") score += 65;
    if (entry.subClass === "D4_leisure_cultural") score += 85;
    if (entry.hasName) score += 18;
    const typeNorm = normalizedLower(entry.typeLabel);
    if (FAMILIAR_TYPES[typeNorm]) score += 26;
    if (DAILY_TYPES[typeNorm]) score += 18;
    if (TRANSPORT_TYPES[typeNorm]) score += 24;
    if (LOW_SALIENCE_TYPES[typeNorm]) score -= 30;
    score += locationRank(entry) * 3;
    return score;
  }

  function listItems(group) {
    if (!group) {
      return [];
    }
    if (Array.isArray(group.items)) {
      return group.items;
    }
    if (Array.isArray(group.ways)) {
      return group.ways;
    }
    return [];
  }

  function isSafeExternalUrl(url) {
    return typeof url === "string" && /^https?:\/\/\S+$/i.test(url);
  }

  function normalizedExternalLink(link) {
    if (!link || typeof link !== "object") {
      return null;
    }
    if (!isSafeExternalUrl(link.url)) {
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
    const items = listItems(group);
    let best = null;
    let bestPriority = Number.MAX_SAFE_INTEGER;
    items.forEach(function(item){
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
    const componentKeys = Object.keys(importanceScore).filter(function(key){
      return key !== "final";
    });
    if (!componentKeys.length) {
      return null;
    }
    const parts = ["final=" + String(importanceScore.final)];
    componentKeys.forEach(function(key){
      const valueText = JSON.stringify(importanceScore[key]);
      if (valueText !== undefined) {
        parts.push(key + "=" + valueText);
      }
    });
    return "importanceScore: " + parts.join("; ");
  }

  function collectPoiEntries(mapContent) {
    const output = [];
    const classD = mapContent && typeof mapContent === "object" ? mapContent.D : null;
    const subclasses = classD && Array.isArray(classD.subclasses) ? classD.subclasses : [];
    subclasses.forEach(function(subclass){
      if (!subclass || subclass.kind !== "poi" || !Array.isArray(subclass.groups)) {
        return;
      }
      subclass.groups.forEach(function(group){
        const items = listItems(group);
        if (!items.length) {
          return;
        }
        const item = items[0];
        const parsed = parseTypeAndName(group, item);
        const name = parsed.name && parsed.name.trim() ? parsed.name.trim() : null;
        const typeLabel = parsed.typeLabel && parsed.typeLabel.trim() ? parsed.typeLabel.trim() : "";
        const entry = {
          subClass: subclass.key,
          group: group,
          item: item,
          typeLabel: typeLabel,
          name: name,
          hasName: !!name,
          itemCount: items.length,
          importanceScore: groupImportanceScore(group)
        };
        entry.section = sectionForEntry(entry);
        entry.score = salienceScore(entry);
        output.push(entry);
      });
    });

    const deduped = {};
    output.forEach(function(entry){
      const typeNorm = normalizedLower(entry.typeLabel || "poi");
      const nameNorm = normalizedLower(entry.name || "");
      const key = entry.section + "|" + typeNorm + "|" + nameNorm + "|" + locationKey(entry);
      if (!deduped[key]) {
        deduped[key] = entry;
        return;
      }
      deduped[key].itemCount += entry.itemCount;
      if (entry.importanceScore > deduped[key].importanceScore) {
        deduped[key] = entry;
      } else if (entry.importanceScore === deduped[key].importanceScore && entry.score > deduped[key].score) {
        deduped[key] = entry;
      }
    });

    return Object.keys(deduped).map(function(key){ return deduped[key]; });
  }

  function sortEntries(entries) {
    return entries.slice().sort(function(a, b){
      if (a.importanceScore !== b.importanceScore) {
        return b.importanceScore - a.importanceScore;
      }
      if (a.hasName !== b.hasName) {
        return a.hasName ? -1 : 1;
      }
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      const locDiff = locationRank(b) - locationRank(a);
      if (locDiff !== 0) {
        return locDiff;
      }
      const aType = normalizeTypeLabel(a.typeLabel).toLowerCase();
      const bType = normalizeTypeLabel(b.typeLabel).toLowerCase();
      if (aType !== bType) {
        return aType.localeCompare(bType);
      }
      const aName = (a.name || "").toLowerCase();
      const bName = (b.name || "").toLowerCase();
      return aName.localeCompare(bName);
    });
  }

  function lineModel(text, className, titleText, link) {
    return {
      className: className || null,
      parts: [{ text: text }],
      title: titleText || null,
      link: link || null
    };
  }

  function entryToModelItem(entry) {
    const normalizedType = normalizeTypeLabel(entry.typeLabel);
    const location = locationTextFromValue(locationValue(entry), "clause");
    const scoreTooltip = importanceScoreTooltip(entry && entry.group ? entry.group.importanceScore : null);
    const titleLink = bestGroupExternalLink(entry && entry.group ? entry.group : null);
    const lines = [];
    if (entry.hasName) {
      lines.push(lineModel(entry.name + ", " + normalizedType, "map-content-title-line", scoreTooltip, titleLink));
    } else if (entry.itemCount > 1) {
      lines.push(lineModel(interpolate(
        t("map_content_poi_unnamed_many", "__count__ unnamed __type__"),
        { count: entry.itemCount, type: normalizedType }
      ), "map-content-title-line", scoreTooltip, titleLink));
    } else {
      lines.push(lineModel(interpolate(
        t("map_content_poi_unnamed", "Unnamed __type__"),
        { type: normalizedType }
      ), "map-content-title-line", scoreTooltip, titleLink));
    }
    if (location) {
      lines.push(lineModel(capitalizeFirst(location), "map-content-location"));
    }
    return {
      type: "poi",
      attrs: {
        dataOsmId: entry.item && entry.item.osmId !== undefined && entry.item.osmId !== null
          ? String(entry.item.osmId)
          : null
      },
      lines: lines
    };
  }

  function collectAllFeatureItems(mapContent) {
    const items = [];
    if (!mapContent || typeof mapContent !== "object") {
      return items;
    }
    Object.keys(mapContent).forEach(function(mainKey){
      const mainEntry = mapContent[mainKey];
      if (!mainEntry || !Array.isArray(mainEntry.subclasses)) {
        return;
      }
      mainEntry.subclasses.forEach(function(subclass){
        if (!subclass || !Array.isArray(subclass.groups)) {
          return;
        }
        subclass.groups.forEach(function(group){
          listItems(group).forEach(function(item){
            if (!item || typeof item !== "object") {
              return;
            }
            items.push({
              mainKey: mainKey,
              subClass: subclass.key,
              group: group,
              item: item,
              semantics: item.semantics || null
            });
          });
        });
      });
    });
    return items;
  }

  function featureLabel(feature) {
    const item = feature && feature.item ? feature.item : null;
    if (!item) {
      return null;
    }
    const name = typeof item.label === "string" && item.label.trim() ? item.label.trim() : null;
    if (name) {
      if (name === "(unnamed)" || /\(unnamed\)/i.test(name)) {
        return null;
      }
      return name;
    }
    if (typeof item.displayLabel === "string" && item.displayLabel.trim()) {
      const display = item.displayLabel.trim();
      if (display === "(unnamed)" || /\(unnamed\)/i.test(display)) {
        return null;
      }
      return display;
    }
    return null;
  }

  function featureLocation(feature) {
    const item = feature && feature.item ? feature.item : null;
    if (!item || !item.location) {
      return null;
    }
    return locationTextFromValue(item.location.point || item.location.center, "clause");
  }

  function cueSummaryItems(mapContent) {
    const all = collectAllFeatureItems(mapContent);
    const withSemantics = all.filter(function(feature){
      return !!(feature && feature.semantics && typeof feature.semantics === "object");
    });

    const crossingSignals = [];
    let tactileYes = 0;
    let tactileNo = 0;
    const kerbCounts = { lowered: 0, flush: 0, raised: 0 };
    let stepsCount = 0;
    let maxStepCount = 0;
    let inclineUp = 0;
    let inclineDown = 0;
    let wheelchairYes = 0;
    let wheelchairLimited = 0;
    let wheelchairNo = 0;

    withSemantics.forEach(function(feature){
      const sem = feature.semantics;
      if (sem.crossing && sem.crossing.type === "traffic_signals") {
        crossingSignals.push(feature);
      }
      if (sem.crossing && sem.crossing.tactile_paving === "yes") {
        tactileYes += 1;
      } else if (sem.crossing && sem.crossing.tactile_paving === "no") {
        tactileNo += 1;
      }
      const kerb = sem.kerb && sem.kerb.value;
      if (kerbCounts[kerb] !== undefined) {
        kerbCounts[kerb] += 1;
      }
      const stepCount = sem.steps && sem.steps.step_count;
      if (stepCount !== undefined && stepCount !== null && !isNaN(stepCount)) {
        stepsCount += 1;
        maxStepCount = Math.max(maxStepCount, Number(stepCount));
      }
      const incline = sem.incline && sem.incline.value;
      if (incline === "up") {
        inclineUp += 1;
      } else if (incline === "down") {
        inclineDown += 1;
      }
      const wheelchair = sem.wheelchair && sem.wheelchair.value;
      if (wheelchair === "yes") wheelchairYes += 1;
      if (wheelchair === "limited") wheelchairLimited += 1;
      if (wheelchair === "no") wheelchairNo += 1;
    });

    const items = [];
    if (crossingSignals.length) {
      const key = crossingSignals.length === 1
        ? "map_content_poi_access_crossings_signals_one"
        : "map_content_poi_access_crossings_signals_many";
      const title = interpolate(
        t(key, "__count__ places with signalized crossings"),
        { count: crossingSignals.length }
      );
      const lines = [lineModel(capitalizeFirst(title), "map-content-title-line")];
      const exampleFeature = crossingSignals.find(function(feature){
        return !!featureLabel(feature);
      }) || null;
      const exampleLabel = exampleFeature ? featureLabel(exampleFeature) : null;
      const exampleLoc = exampleFeature ? featureLocation(exampleFeature) : null;
      if (exampleLabel) {
        const example = exampleLoc ? (exampleLabel + ", " + exampleLoc) : exampleLabel;
        lines.push(lineModel(
          interpolate(t("map_content_poi_example", "Example: __example__"), { example: example }),
          "map-content-location"
        ));
      }
      items.push({ type: "poi_cue", attrs: {}, lines: lines });
    }
    if (tactileYes > 0 || tactileNo > 0) {
      items.push({
        type: "poi_cue",
        attrs: {},
        lines: [lineModel(interpolate(
          t("map_content_poi_access_tactile_summary", "Tactile paving tags: __yes__ yes, __no__ no"),
          { yes: tactileYes, no: tactileNo }
        ), "map-content-title-line")]
      });
    }
    if (kerbCounts.lowered > 0 || kerbCounts.flush > 0 || kerbCounts.raised > 0) {
      items.push({
        type: "poi_cue",
        attrs: {},
        lines: [lineModel(interpolate(
          t("map_content_poi_access_kerb_summary", "Kerb tags: lowered __lowered__, flush __flush__, raised __raised__"),
          {
            lowered: kerbCounts.lowered,
            flush: kerbCounts.flush,
            raised: kerbCounts.raised
          }
        ), "map-content-title-line")]
      });
    }
    if (stepsCount > 0) {
      items.push({
        type: "poi_cue",
        attrs: {},
        lines: [lineModel(interpolate(
          t("map_content_poi_access_steps_summary", "Steps tagged at __count__ places (largest step count __max__)"),
          { count: stepsCount, max: maxStepCount }
        ), "map-content-title-line")]
      });
    }
    if (inclineUp > 0 || inclineDown > 0) {
      items.push({
        type: "poi_cue",
        attrs: {},
        lines: [lineModel(interpolate(
          t("map_content_poi_access_incline_summary", "Incline tags: up __up__, down __down__"),
          { up: inclineUp, down: inclineDown }
        ), "map-content-title-line")]
      });
    }
    if (wheelchairYes > 0 || wheelchairLimited > 0 || wheelchairNo > 0) {
      items.push({
        type: "poi_cue",
        attrs: {},
        lines: [lineModel(interpolate(
          t("map_content_poi_access_wheelchair_summary", "Wheelchair tags: yes __yes__, limited __limited__, no __no__"),
          { yes: wheelchairYes, limited: wheelchairLimited, no: wheelchairNo }
        ), "map-content-title-line")]
      });
    }
    return items;
  }

  function normalizedOptions(options) {
    return {
      section: options && typeof options.section === "string" ? options.section : "familiar_places",
      includeSparseNote: !!(options && options.includeSparseNote)
    };
  }

  function sectionEntriesByKey(mapContent) {
    const entries = collectPoiEntries(mapContent);
    const sections = {
      familiar_places: [],
      daily_essentials: [],
      transport_points: []
    };
    entries.forEach(function(entry){
      if (!sections[entry.section]) {
        return;
      }
      sections[entry.section].push(entry);
    });
    sections.familiar_places = sortEntries(sections.familiar_places);
    sections.daily_essentials = sortEntries(sections.daily_essentials);
    sections.transport_points = sortEntries(sections.transport_points);
    return sections;
  }

  function buildModel(mapContent, helpers, options) {
    setTranslator(helpers);
    const resolved = normalizedOptions(options);
    if (resolved.section === "accessibility_cues") {
      return cueSummaryItems(mapContent);
    }
    const bySection = sectionEntriesByKey(mapContent);
    const selected = bySection[resolved.section] || [];
    const model = selected.map(entryToModelItem);
    if (resolved.section === "familiar_places" && resolved.includeSparseNote) {
      const total = bySection.familiar_places.length + bySection.daily_essentials.length + bySection.transport_points.length;
      if (total > 0 && total <= 2) {
        model.push({
          type: "poi_note",
          attrs: {},
          lines: [lineModel(
            t(
              "map_content_poi_sparse_note",
              "Only a few POIs are tagged in this area; missing places may be due to OpenStreetMap data coverage."
            ),
            "map-content-message"
          )]
        });
      }
    }
    return model;
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
      target.append($("<span>").text(String(part.text)));
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
    if (lineModel.title) {
      line.attr("title", lineModel.title);
    }
    const titleLink = lineModel.className === "map-content-title-line"
      ? normalizedExternalLink(lineModel.link)
      : null;
    if (titleLink) {
      const anchor = $("<a>")
        .addClass("map-content-title-link")
        .attr("href", titleLink.url)
        .attr("target", "_blank")
        .attr("rel", "noopener noreferrer");
      appendLineParts(anchor, lineModel.parts);
      anchor.append($("<span>").addClass("map-content-external-indicator").attr("aria-hidden", "true").text("↗"));
      anchor.append($("<span>").addClass("visuallyhidden").text(
        " " + t("map_content_external_link_aria", "External link, opens in a new tab")
      ));
      line.append(anchor);
    } else {
      appendLineParts(line, lineModel.parts);
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
    const listItem = $("<li>").addClass("map-content-poi");
    applyItemAttrs(listItem, item.attrs);
    const lines = Array.isArray(item.lines) ? item.lines : [];
    lines.forEach(function(lineModel){
      renderLineFromModel(listItem, lineModel);
    });
    listElem.append(listItem);
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

  function emptyMessage(helpers, options) {
    setTranslator(helpers);
    const resolved = normalizedOptions(options);
    if (resolved.section === "familiar_places") {
      return t("map_content_no_poi_familiar", "No familiar places listed for this map.");
    }
    if (resolved.section === "daily_essentials") {
      return t("map_content_no_poi_daily", "No daily essentials listed for this map.");
    }
    if (resolved.section === "transport_points") {
      return t("map_content_no_poi_transport", "No transport points listed for this map.");
    }
    return t("map_content_no_poi_accessibility", "No accessibility cues are tagged for this map.");
  }

  window.TM = window.TM || {};
  window.TM.mapDescPois = {
    buildModel: buildModel,
    renderFromModel: renderFromModel,
    emptyMessage: emptyMessage
  };
})();
