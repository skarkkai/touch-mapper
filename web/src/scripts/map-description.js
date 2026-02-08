/* global $ */
/* eslint quotes:0, space-unary-ops:0, no-alert:0, no-unused-vars:0, no-shadow:0, no-extend-native:0, no-trailing-spaces:0, space-infix-ops:0, camelcase:0, dot-notation:0 */

/*
 * Build short, human-friendly map descriptions from map-content.json.
 */
(function(){
  'use strict';

  const MAX_VISIBLE_BUILDINGS = 10;
  const MAX_VISIBLE_LINEAR_ITEMS = 10;
  const MAX_VISIBLE_POI_ITEMS = 8;
  const LINEAR_SECTION_CONFIGS = [
    {
      key: "roads",
      rowSelector: ".map-content-roads-row",
      listSelector: ".map-content-roads",
      alwaysShow: true,
      maxVisible: MAX_VISIBLE_LINEAR_ITEMS,
      toggleClass: "map-content-roads-toggle"
    },
    {
      key: "paths",
      rowSelector: ".map-content-paths-row",
      listSelector: ".map-content-paths",
      alwaysShow: false,
      maxVisible: MAX_VISIBLE_LINEAR_ITEMS,
      toggleClass: "map-content-paths-toggle"
    },
    {
      key: "railways",
      rowSelector: ".map-content-railways-row",
      listSelector: ".map-content-railways",
      alwaysShow: false,
      maxVisible: MAX_VISIBLE_LINEAR_ITEMS,
      toggleClass: "map-content-railways-toggle"
    },
    {
      key: "waterways",
      rowSelector: ".map-content-waterways-row",
      listSelector: ".map-content-waterways",
      alwaysShow: false,
      maxVisible: MAX_VISIBLE_LINEAR_ITEMS,
      toggleClass: "map-content-waterways-toggle"
    },
    {
      key: "otherLinear",
      rowSelector: ".map-content-other-linear-row",
      listSelector: ".map-content-other-linear",
      alwaysShow: false,
      maxVisible: MAX_VISIBLE_LINEAR_ITEMS,
      toggleClass: "map-content-other-linear-toggle"
    }
  ];
  const POI_SECTION_CONFIGS = [
    {
      key: "poiFamiliar",
      rendererSection: "familiar_places",
      rowSelector: ".map-content-poi-familiar-row",
      listSelector: ".map-content-poi-familiar",
      alwaysShow: true,
      maxVisible: MAX_VISIBLE_POI_ITEMS,
      fallbackKey: "map_content_no_poi_familiar",
      fallbackText: "No familiar places listed for this map.",
      toggleClass: "map-content-poi-familiar-toggle",
      includeSparseNote: true
    },
    {
      key: "poiDaily",
      rendererSection: "daily_essentials",
      rowSelector: ".map-content-poi-daily-row",
      listSelector: ".map-content-poi-daily",
      alwaysShow: false,
      maxVisible: MAX_VISIBLE_POI_ITEMS,
      fallbackKey: "map_content_no_poi_daily",
      fallbackText: "No daily essentials listed for this map.",
      toggleClass: "map-content-poi-daily-toggle",
      includeSparseNote: false
    },
    {
      key: "poiTransport",
      rendererSection: "transport_points",
      rowSelector: ".map-content-poi-transport-row",
      listSelector: ".map-content-poi-transport",
      alwaysShow: false,
      maxVisible: MAX_VISIBLE_POI_ITEMS,
      fallbackKey: "map_content_no_poi_transport",
      fallbackText: "No transport points listed for this map.",
      toggleClass: "map-content-poi-transport-toggle",
      includeSparseNote: false
    },
  ];
  const SECTION_HEIGHT_DEFAULT_PROFILES = {
    roads: ["raised:0.82"],
    paths: ["raised:1.5"],
    railways: ["raised:0.81"],
    waterways: ["waved_surface"],
    otherLinear: ["varying"],
    buildings: ["raised:2.9"],
    poiFamiliar: ["text_only"],
    poiDaily: ["text_only"],
    poiTransport: ["text_only"]
  };

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

  function showMoreBuildingsLabel(hiddenCount, translateFn) {
    const tr = typeof translateFn === "function" ? translateFn : t;
    if (hiddenCount === 1) {
      return tr("map_content_show_more_buildings_one", "Show 1 more building");
    }
    return interpolate(
      tr("map_content_show_more_buildings_many", "Show __count__ more buildings"),
      { count: hiddenCount }
    );
  }

  function showMorePoisLabel(hiddenCount, translateFn) {
    const tr = typeof translateFn === "function" ? translateFn : t;
    if (hiddenCount === 1) {
      return tr("map_content_show_more_pois_one", "Show 1 more place");
    }
    return interpolate(
      tr("map_content_show_more_pois_many", "Show __count__ more places"),
      { count: hiddenCount }
    );
  }

  function showMoreFeaturesLabel(hiddenCount, translateFn) {
    const tr = typeof translateFn === "function" ? translateFn : t;
    if (hiddenCount === 1) {
      return tr("map_content_show_more_features_one", "Show 1 more feature");
    }
    return interpolate(
      tr("map_content_show_more_features_many", "Show __count__ more features"),
      { count: hiddenCount }
    );
  }

  function formatHeightMillimeters(mm) {
    const number = Number(mm);
    if (!isFinite(number)) {
      return null;
    }
    const rounded = Math.round(number * 10) / 10;
    if (Math.abs(rounded - Math.round(rounded)) < 1e-9) {
      return String(Math.round(rounded));
    }
    return String(rounded);
  }

  function sectionForLinearSubClassKey(subClassKey) {
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

  function profileForLinearSubClassKey(subClassKey) {
    const sectionKey = sectionForLinearSubClassKey(subClassKey);
    if (sectionKey === "roads") {
      return "raised:0.82";
    }
    if (sectionKey === "paths") {
      return "raised:1.5";
    }
    if (sectionKey === "railways") {
      return "raised:0.81";
    }
    if (sectionKey === "waterways") {
      return "waved_surface";
    }
    if (sectionKey === "otherLinear") {
      return "varying";
    }
    return null;
  }

  function collectSectionHeightProfiles(mapContent) {
    const profilesBySection = {};
    Object.keys(SECTION_HEIGHT_DEFAULT_PROFILES).forEach(function(sectionKey){
      profilesBySection[sectionKey] = new Set();
    });
    const payload = mapContent && typeof mapContent === "object" ? mapContent : {};
    const classA = payload.A;
    const linearSubclasses = classA && Array.isArray(classA.subclasses) ? classA.subclasses : [];
    linearSubclasses.forEach(function(subclass){
      if (!subclass || subclass.kind !== "linear") {
        return;
      }
      const groups = Array.isArray(subclass.groups) ? subclass.groups : [];
      if (!groups.length) {
        return;
      }
      const sectionKey = sectionForLinearSubClassKey(subclass.key);
      if (!sectionKey || !profilesBySection[sectionKey]) {
        return;
      }
      const profile = profileForLinearSubClassKey(subclass.key);
      if (!profile) {
        return;
      }
      profilesBySection[sectionKey].add(profile);
    });

    const classC = payload.C;
    const buildingSubclasses = classC && Array.isArray(classC.subclasses) ? classC.subclasses : [];
    buildingSubclasses.forEach(function(subclass){
      if (!subclass || subclass.kind !== "building") {
        return;
      }
      const groups = Array.isArray(subclass.groups) ? subclass.groups : [];
      if (!groups.length) {
        return;
      }
      profilesBySection.buildings.add("raised:2.9");
    });

    return profilesBySection;
  }

  function sectionHeightNoteForProfiles(profiles, helpers) {
    const profileSet = profiles instanceof Set ? profiles : new Set();
    if (!profileSet.size) {
      return translateWithHelpers(
        helpers,
        "map_content_height_note_varying",
        "Raised by varying amounts"
      );
    }
    if (profileSet.has("varying") || profileSet.size > 1) {
      return translateWithHelpers(
        helpers,
        "map_content_height_note_varying",
        "Raised by varying amounts"
      );
    }
    if (profileSet.has("waved_surface")) {
      return translateWithHelpers(
        helpers,
        "map_content_height_note_waved_surface",
        "Waved surface"
      );
    }
    if (profileSet.has("text_only")) {
      return translateWithHelpers(
        helpers,
        "map_content_height_note_text_only",
        "Textual information only"
      );
    }
    const onlyProfile = Array.from(profileSet)[0];
    if (onlyProfile && onlyProfile.indexOf("raised:") === 0) {
      const millimeters = formatHeightMillimeters(onlyProfile.slice("raised:".length));
      if (millimeters !== null) {
        return interpolate(
          translateWithHelpers(
            helpers,
            "map_content_height_note_raised_mm",
            "Raised __millimeters__ mm"
          ),
          { millimeters: millimeters }
        );
      }
    }
    return translateWithHelpers(
      helpers,
      "map_content_height_note_varying",
      "Raised by varying amounts"
    );
  }

  function buildSectionHeightNotes(mapContent, helpers) {
    const discoveredProfiles = collectSectionHeightProfiles(mapContent);
    const notes = {};
    Object.keys(SECTION_HEIGHT_DEFAULT_PROFILES).forEach(function(sectionKey){
      const defaultProfiles = new Set(SECTION_HEIGHT_DEFAULT_PROFILES[sectionKey] || []);
      const discovered = discoveredProfiles[sectionKey];
      const profiles = discovered && discovered.size ? discovered : defaultProfiles;
      notes[sectionKey] = sectionHeightNoteForProfiles(profiles, helpers);
    });
    return notes;
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

  function getRenderer(name) {
    if (!window.TM || !window.TM[name]) {
      return null;
    }
    return window.TM[name];
  }

  function translateWithHelpers(helpers, key, fallback) {
    if (helpers && typeof helpers.t === "function") {
      return helpers.t(key, fallback);
    }
    return t(key, fallback);
  }

  function normalizeCount(value) {
    if (typeof value === "number" && isFinite(value)) {
      return value;
    }
    return parseInt(value, 10) || 0;
  }

  function messageItem(message) {
    return {
      type: "message",
      attrs: {},
      lines: [
        {
          className: "map-content-message",
          parts: [{ text: message }]
        }
      ]
    };
  }

  function buildSectionModel(renderer, mapContent, helpers, fallbackKey, fallbackText, rendererOptions) {
    const unavailableMessage = translateWithHelpers(
      helpers,
      "map_content_unavailable",
      "Map content is not available."
    );
    if (!renderer || typeof renderer.buildModel !== "function") {
      return {
        items: [messageItem(unavailableMessage)],
        emptyMessage: unavailableMessage,
        count: 0
      };
    }

    const builtItems = renderer.buildModel(mapContent, helpers, rendererOptions);
    const items = Array.isArray(builtItems) ? builtItems : [];
    const count = normalizeCount(items.length);
    if (count > 0) {
      return {
        items: items,
        emptyMessage: null,
        count: count
      };
    }

    const emptyText = typeof renderer.emptyMessage === "function"
      ? renderer.emptyMessage(helpers, rendererOptions)
      : translateWithHelpers(helpers, fallbackKey, fallbackText);
    return {
      items: [messageItem(emptyText)],
      emptyMessage: emptyText,
      count: 0
    };
  }

  function applySectionLimitToModel(section, maxVisible, collapsedLabel, expandedLabel) {
    const maxCount = Number(maxVisible);
    if (!section || !Array.isArray(section.items) || !isFinite(maxCount) || maxCount < 1) {
      return { section: section, toggle: null };
    }
    if (section.count <= maxCount) {
      return { section: section, toggle: null };
    }
    const hiddenCount = section.items.length - maxCount;
    const limitedItems = section.items.map(function(item, index){
      if (index < maxCount) {
        return item;
      }
      const attrs = Object.assign({}, item && item.attrs ? item.attrs : {});
      attrs.initiallyHidden = true;
      return Object.assign({}, item, { attrs: attrs });
    });
    return {
      section: {
        items: limitedItems,
        emptyMessage: section.emptyMessage,
        count: section.count
      },
      toggle: {
        hiddenCount: hiddenCount,
        collapsedLabel: collapsedLabel,
        expandedLabel: expandedLabel
      }
    };
  }

  function buildModel(mapContent, helpers, options) {
    const payload = parseMapContent(mapContent);
    const linearRenderer = getRenderer("mapDescWays");
    const buildingsRenderer = getRenderer("mapDescAreas");
    const poiRenderer = getRenderer("mapDescPois");
    const linearSections = {};
    const linearToggles = {};
    LINEAR_SECTION_CONFIGS.forEach(function(sectionConfig){
      const fallbackKey = "map_content_no_" + (sectionConfig.key === "otherLinear" ? "other_linear" : sectionConfig.key);
      const fallbackTextByKey = {
        roads: "No roads listed for this map.",
        paths: "No paths listed for this map.",
        railways: "No railways listed for this map.",
        waterways: "No waterways listed for this map.",
        otherLinear: "No other linear features listed for this map."
      };
      const section = buildSectionModel(
        linearRenderer,
        payload,
        helpers,
        fallbackKey,
        fallbackTextByKey[sectionConfig.key] || "No features listed for this map.",
        { section: sectionConfig.key }
      );
      const limited = applySectionLimitToModel(
        section,
        sectionConfig.maxVisible,
        showMoreFeaturesLabel(section.items.length - sectionConfig.maxVisible, function(key, fallback){
          return translateWithHelpers(helpers, key, fallback);
        }),
        translateWithHelpers(helpers, "map_content_show_less_features", "Show fewer features")
      );
      linearSections[sectionConfig.key] = limited.section;
      linearToggles[sectionConfig.key] = limited.toggle;
    });
    const buildings = buildSectionModel(
      buildingsRenderer,
      payload,
      helpers,
      "map_content_no_buildings",
      "No buildings listed for this map."
    );
    const poiSections = {};
    const poiToggles = {};
    POI_SECTION_CONFIGS.forEach(function(sectionConfig){
      const section = buildSectionModel(
        poiRenderer,
        payload,
        helpers,
        sectionConfig.fallbackKey,
        sectionConfig.fallbackText,
        {
          section: sectionConfig.rendererSection,
          includeSparseNote: sectionConfig.includeSparseNote
        }
      );
      const limited = applySectionLimitToModel(
        section,
        sectionConfig.maxVisible,
        showMorePoisLabel(section.items.length - sectionConfig.maxVisible, function(key, fallback){
          return translateWithHelpers(helpers, key, fallback);
        }),
        translateWithHelpers(helpers, "map_content_show_less_pois", "Show fewer places")
      );
      poiSections[sectionConfig.key] = limited.section;
      poiToggles[sectionConfig.key] = limited.toggle;
    });
    const requestedMaxVisible = options && isFinite(Number(options.maxVisibleBuildings))
      ? Number(options.maxVisibleBuildings)
      : MAX_VISIBLE_BUILDINGS;
    const buildingsResult = applySectionLimitToModel(
      buildings,
      requestedMaxVisible,
      showMoreBuildingsLabel(buildings.items.length - requestedMaxVisible, function(key, fallback){
        return translateWithHelpers(helpers, key, fallback);
      }),
      translateWithHelpers(helpers, "map_content_show_less_buildings", "Show fewer buildings")
    );
    const sectionHeightNotes = buildSectionHeightNotes(payload, helpers);
    return {
      roads: linearSections.roads,
      paths: linearSections.paths,
      railways: linearSections.railways,
      waterways: linearSections.waterways,
      otherLinear: linearSections.otherLinear,
      poiFamiliar: poiSections.poiFamiliar,
      poiDaily: poiSections.poiDaily,
      poiTransport: poiSections.poiTransport,
      buildings: buildingsResult.section,
      ui: {
        sectionHeightNotes: sectionHeightNotes,
        linearToggles: linearToggles,
        buildingsToggle: buildingsResult.toggle,
        poiToggles: poiToggles
      }
    };
  }

  function sectionCount(section) {
    if (!section) {
      return 0;
    }
    return normalizeCount(section.count);
  }

  function renderSectionFromModel(listElem, section, renderer) {
    if (!listElem || !listElem.length) {
      return 0;
    }
    if (!section || !Array.isArray(section.items)) {
      showMessage(listElem, t("map_content_unavailable", "Map content is not available."));
      return 0;
    }
    listElem.empty();
    if (section.count > 0 && renderer && typeof renderer.renderFromModel === "function") {
      return normalizeCount(renderer.renderFromModel(section.items, listElem));
    }
    if (section.emptyMessage) {
      showMessage(listElem, section.emptyMessage);
      return 0;
    }
    showMessage(listElem, t("map_content_unavailable", "Map content is not available."));
    return 0;
  }

  function renderSectionHeightNote(row, noteText) {
    if (!row || !row.length) {
      return;
    }
    const noteElem = row.find(".map-content-section-height");
    if (!noteElem.length) {
      return;
    }
    noteElem.text(noteText || "");
  }

  function applyToggleFromModel(listElem, rowSelector, toggleClass, toggleModel, collapsedFallback, expandedFallback) {
    if (!listElem || !listElem.length) {
      return;
    }
    const row = rowSelector ? listElem.closest(rowSelector) : listElem.parent();
    row.find("." + toggleClass).remove();
    if (!toggleModel || !toggleModel.hiddenCount) {
      return;
    }

    const hiddenItems = listElem.children("li[data-initially-hidden='true']");
    if (!hiddenItems.length) {
      return;
    }
    hiddenItems.hide();

    const button = $("<button>")
      .attr("type", "button")
      .addClass("map-content-section-toggle")
      .addClass(toggleClass)
      .attr("aria-expanded", "false")
      .text(toggleModel.collapsedLabel || collapsedFallback);

    button.on("click", function(){
      const isExpanded = button.attr("aria-expanded") === "true";
      if (isExpanded) {
        hiddenItems.hide();
        button
          .attr("aria-expanded", "false")
          .text(toggleModel.collapsedLabel || collapsedFallback);
        return;
      }
      hiddenItems.show();
      button
        .attr("aria-expanded", "true")
        .text(toggleModel.expandedLabel || expandedFallback);
    });

    listElem.after(button);
  }

  function renderFromModel(model, container) {
    if (!container || !container.length) {
      return {
        roads: 0,
        paths: 0,
        railways: 0,
        waterways: 0,
        otherLinear: 0,
        poiFamiliar: 0,
        poiDaily: 0,
        poiTransport: 0,
        buildings: 0
      };
    }
    const linearRenderer = getRenderer("mapDescWays");
    const poiRenderer = getRenderer("mapDescPois");
    const buildingsListElem = container.find(".map-content-buildings");
    const counts = {
      roads: 0,
      paths: 0,
      railways: 0,
      waterways: 0,
      otherLinear: 0,
      poiFamiliar: 0,
      poiDaily: 0,
      poiTransport: 0,
      buildings: 0
    };

    LINEAR_SECTION_CONFIGS.forEach(function(sectionConfig){
      const row = container.find(sectionConfig.rowSelector);
      const listElem = container.find(sectionConfig.listSelector);
      const sectionHeightNotes = model && model.ui && model.ui.sectionHeightNotes
        ? model.ui.sectionHeightNotes
        : null;
      if (!listElem.length) {
        return;
      }
      renderSectionHeightNote(row, sectionHeightNotes ? sectionHeightNotes[sectionConfig.key] : null);
      const section = model ? model[sectionConfig.key] : null;
      const count = sectionCount(section);
      if (!sectionConfig.alwaysShow && count <= 0) {
        listElem.empty();
        row.hide();
        counts[sectionConfig.key] = 0;
        return;
      }
      row.show();
      counts[sectionConfig.key] = renderSectionFromModel(listElem, section, linearRenderer);
      const linearToggleModel = model && model.ui && model.ui.linearToggles
        ? model.ui.linearToggles[sectionConfig.key]
        : null;
      applyToggleFromModel(
        listElem,
        sectionConfig.rowSelector,
        sectionConfig.toggleClass,
        linearToggleModel,
        showMoreFeaturesLabel(
          linearToggleModel && linearToggleModel.hiddenCount ? linearToggleModel.hiddenCount : 0
        ),
        t("map_content_show_less_features", "Show fewer features")
      );
    });

    POI_SECTION_CONFIGS.forEach(function(sectionConfig){
      const row = container.find(sectionConfig.rowSelector);
      const listElem = container.find(sectionConfig.listSelector);
      const sectionHeightNotes = model && model.ui && model.ui.sectionHeightNotes
        ? model.ui.sectionHeightNotes
        : null;
      if (!listElem.length) {
        return;
      }
      renderSectionHeightNote(row, sectionHeightNotes ? sectionHeightNotes[sectionConfig.key] : null);
      const section = model ? model[sectionConfig.key] : null;
      const count = sectionCount(section);
      if (!sectionConfig.alwaysShow && count <= 0) {
        listElem.empty();
        row.hide();
        counts[sectionConfig.key] = 0;
        return;
      }
      row.show();
      counts[sectionConfig.key] = renderSectionFromModel(listElem, section, poiRenderer);
      const toggleModel = model && model.ui && model.ui.poiToggles
        ? model.ui.poiToggles[sectionConfig.key]
        : null;
      applyToggleFromModel(
        listElem,
        sectionConfig.rowSelector,
        sectionConfig.toggleClass,
        toggleModel,
        showMorePoisLabel(toggleModel && toggleModel.hiddenCount ? toggleModel.hiddenCount : 0),
        t("map_content_show_less_pois", "Show fewer places")
      );
    });

    const buildingsRenderer = getRenderer("mapDescAreas");
    const buildingRow = container.find(".map-content-buildings-row");
    const sectionHeightNotes = model && model.ui && model.ui.sectionHeightNotes
      ? model.ui.sectionHeightNotes
      : null;
    renderSectionHeightNote(buildingRow, sectionHeightNotes ? sectionHeightNotes.buildings : null);
    counts.buildings = buildingsListElem.length
      ? renderSectionFromModel(buildingsListElem, model ? model.buildings : null, buildingsRenderer)
      : 0;
    if (buildingsListElem.length) {
      applyToggleFromModel(
        buildingsListElem,
        ".map-content-buildings-row",
        "map-content-buildings-toggle",
        model && model.ui ? model.ui.buildingsToggle : null,
        showMoreBuildingsLabel(
          model && model.ui && model.ui.buildingsToggle && model.ui.buildingsToggle.hiddenCount
            ? model.ui.buildingsToggle.hiddenCount
            : 0
        ),
        t("map_content_show_less_buildings", "Show fewer buildings")
      );
    }
    return counts;
  }

  // Entry point: read map-content.json and populate "Map content" block.
  function insertMapDescription(info, container) {
    if (!container || !container.length) {
      return;
    }
    const roadsListElem = container.find(".map-content-roads");
    const buildingsListElem = container.find(".map-content-buildings");
    const familiarPoisListElem = container.find(".map-content-poi-familiar");
    if (!roadsListElem.length && !buildingsListElem.length && !familiarPoisListElem.length) {
      return;
    }
    roadsListElem.empty();
    LINEAR_SECTION_CONFIGS.forEach(function(sectionConfig){
      const row = container.find(sectionConfig.rowSelector);
      const listElem = container.find(sectionConfig.listSelector);
      if (!listElem.length) {
        return;
      }
      listElem.empty();
      renderSectionHeightNote(row, null);
      if (!sectionConfig.alwaysShow) {
        row.hide();
      } else {
        row.show();
      }
    });
    POI_SECTION_CONFIGS.forEach(function(sectionConfig){
      const row = container.find(sectionConfig.rowSelector);
      const listElem = container.find(sectionConfig.listSelector);
      if (!listElem.length) {
        return;
      }
      listElem.empty();
      renderSectionHeightNote(row, null);
      if (!sectionConfig.alwaysShow) {
        row.hide();
      } else {
        row.show();
      }
    });
    buildingsListElem.empty();
    renderSectionHeightNote(container.find(".map-content-buildings-row"), null);

    const requestId = info ? info.requestId : null;
    const request = loadMapContent(requestId);
    if (!request) {
      if (roadsListElem.length) {
        showMessage(roadsListElem, t("map_content_unavailable", "Map content is not available."));
      }
      if (buildingsListElem.length) {
        showMessage(buildingsListElem, t("map_content_unavailable", "Map content is not available."));
      }
      POI_SECTION_CONFIGS.forEach(function(sectionConfig){
        const row = container.find(sectionConfig.rowSelector);
        const listElem = container.find(sectionConfig.listSelector);
        if (!listElem.length || !sectionConfig.alwaysShow) {
          return;
        }
        row.show();
        showMessage(listElem, t("map_content_unavailable", "Map content is not available."));
      });
      return;
    }

    request.done(function(payload){
      const helpers = { t: t };
      const model = buildModel(payload, helpers, { maxVisibleBuildings: MAX_VISIBLE_BUILDINGS });
      renderFromModel(model, container);
    }).fail(function(){
      if (roadsListElem.length) {
        showMessage(roadsListElem, t("map_content_unavailable", "Map content is not available."));
      }
      if (buildingsListElem.length) {
        showMessage(buildingsListElem, t("map_content_unavailable", "Map content is not available."));
      }
      POI_SECTION_CONFIGS.forEach(function(sectionConfig){
        const row = container.find(sectionConfig.rowSelector);
        const listElem = container.find(sectionConfig.listSelector);
        if (!listElem.length || !sectionConfig.alwaysShow) {
          return;
        }
        row.show();
        showMessage(listElem, t("map_content_unavailable", "Map content is not available."));
      });
    });
  }

  window.TM = window.TM || {};
  window.TM.mapDescription = {
    buildModel: buildModel,
    renderFromModel: renderFromModel
  };
  window.insertMapDescription = insertMapDescription;
})();
