/* global $ */
/* eslint quotes:0, space-unary-ops:0, no-alert:0, no-unused-vars:0, no-shadow:0, no-extend-native:0, no-trailing-spaces:0, space-infix-ops:0, camelcase:0, dot-notation:0 */

/*
 * Build short, human-friendly map descriptions from map-content.json.
 */
(function(){
  'use strict';

  const MAX_VISIBLE_BUILDINGS = 10;

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

  function buildSectionModel(renderer, mapContent, helpers, fallbackKey, fallbackText) {
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

    const builtItems = renderer.buildModel(mapContent, helpers);
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
      ? renderer.emptyMessage(helpers)
      : translateWithHelpers(helpers, fallbackKey, fallbackText);
    return {
      items: [messageItem(emptyText)],
      emptyMessage: emptyText,
      count: 0
    };
  }

  function applyBuildingsLimitToModel(section, maxVisible, helpers) {
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
        collapsedLabel: showMoreBuildingsLabel(hiddenCount, function(key, fallback){
          return translateWithHelpers(helpers, key, fallback);
        }),
        expandedLabel: translateWithHelpers(
          helpers,
          "map_content_show_less_buildings",
          "Show fewer buildings"
        )
      }
    };
  }

  function buildModel(mapContent, helpers, options) {
    const payload = parseMapContent(mapContent);
    const waysRenderer = getRenderer("mapDescWays");
    const buildingsRenderer = getRenderer("mapDescAreas");
    const ways = buildSectionModel(
      waysRenderer,
      payload,
      helpers,
      "map_content_no_ways",
      "No ways listed for this map."
    );
    const buildings = buildSectionModel(
      buildingsRenderer,
      payload,
      helpers,
      "map_content_no_buildings",
      "No buildings listed for this map."
    );
    const requestedMaxVisible = options && isFinite(Number(options.maxVisibleBuildings))
      ? Number(options.maxVisibleBuildings)
      : MAX_VISIBLE_BUILDINGS;
    const buildingsResult = applyBuildingsLimitToModel(buildings, requestedMaxVisible, helpers);
    return {
      ways: ways,
      buildings: buildingsResult.section,
      ui: {
        buildingsToggle: buildingsResult.toggle
      }
    };
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

  function applyBuildingsToggleFromModel(listElem, toggleModel) {
    if (!listElem || !listElem.length) {
      return;
    }
    const row = listElem.closest(".map-content-buildings-row");
    row.find(".map-content-buildings-toggle").remove();
    if (!toggleModel || !toggleModel.hiddenCount) {
      return;
    }

    const hiddenItems = listElem.children("li.map-content-building[data-initially-hidden='true']");
    if (!hiddenItems.length) {
      return;
    }
    hiddenItems.hide();

    const button = $("<button>")
      .attr("type", "button")
      .addClass("map-content-buildings-toggle")
      .attr("aria-expanded", "false")
      .text(toggleModel.collapsedLabel || showMoreBuildingsLabel(toggleModel.hiddenCount));

    button.on("click", function(){
      const isExpanded = button.attr("aria-expanded") === "true";
      if (isExpanded) {
        hiddenItems.hide();
        button
          .attr("aria-expanded", "false")
          .text(toggleModel.collapsedLabel || showMoreBuildingsLabel(toggleModel.hiddenCount));
        return;
      }
      hiddenItems.show();
      button
        .attr("aria-expanded", "true")
        .text(toggleModel.expandedLabel || t("map_content_show_less_buildings", "Show fewer buildings"));
    });

    listElem.after(button);
  }

  function renderFromModel(model, container) {
    if (!container || !container.length) {
      return { ways: 0, buildings: 0 };
    }
    const waysListElem = container.find(".map-content-ways");
    const buildingsListElem = container.find(".map-content-buildings");
    if (!waysListElem.length && !buildingsListElem.length) {
      return { ways: 0, buildings: 0 };
    }
    const waysRenderer = getRenderer("mapDescWays");
    const buildingsRenderer = getRenderer("mapDescAreas");
    const wayCount = waysListElem.length
      ? renderSectionFromModel(waysListElem, model ? model.ways : null, waysRenderer)
      : 0;
    const buildingCount = buildingsListElem.length
      ? renderSectionFromModel(buildingsListElem, model ? model.buildings : null, buildingsRenderer)
      : 0;
    if (buildingsListElem.length) {
      applyBuildingsToggleFromModel(
        buildingsListElem,
        model && model.ui ? model.ui.buildingsToggle : null
      );
    }
    return {
      ways: wayCount,
      buildings: buildingCount
    };
  }

  // Entry point: read map-content.json and populate "Map content" block.
  function insertMapDescription(info, container) {
    if (!container || !container.length) {
      return;
    }
    const waysListElem = container.find(".map-content-ways");
    const buildingsListElem = container.find(".map-content-buildings");
    if (!waysListElem.length && !buildingsListElem.length) {
      return;
    }
    waysListElem.empty();
    buildingsListElem.empty();

    const requestId = info ? info.requestId : null;
    const request = loadMapContent(requestId);
    if (!request) {
      if (waysListElem.length) {
        showMessage(waysListElem, t("map_content_unavailable", "Map content is not available."));
      }
      if (buildingsListElem.length) {
        showMessage(buildingsListElem, t("map_content_unavailable", "Map content is not available."));
      }
      return;
    }

    request.done(function(payload){
      const helpers = { t: t };
      const model = buildModel(payload, helpers, { maxVisibleBuildings: MAX_VISIBLE_BUILDINGS });
      renderFromModel(model, container);
    }).fail(function(){
      if (waysListElem.length) {
        showMessage(waysListElem, t("map_content_unavailable", "Map content is not available."));
      }
      if (buildingsListElem.length) {
        showMessage(buildingsListElem, t("map_content_unavailable", "Map content is not available."));
      }
    });
  }

  window.TM = window.TM || {};
  window.TM.mapDescription = {
    buildModel: buildModel,
    renderFromModel: renderFromModel
  };
  window.insertMapDescription = insertMapDescription;
})();
