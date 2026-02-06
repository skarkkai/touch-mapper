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

  function showMoreBuildingsLabel(hiddenCount) {
    if (hiddenCount === 1) {
      return t("map_content_show_more_buildings_one", "Show 1 more building");
    }
    return interpolate(
      t("map_content_show_more_buildings_many", "Show __count__ more buildings"),
      { count: hiddenCount }
    );
  }

  function applyBuildingsListLimit(listElem, maxVisible) {
    if (!listElem || !listElem.length) {
      return;
    }
    const row = listElem.closest(".map-content-buildings-row");
    row.find(".map-content-buildings-toggle").remove();

    const buildingItems = listElem.children("li.map-content-building");
    if (buildingItems.length <= maxVisible) {
      return;
    }

    const hiddenItems = buildingItems.slice(maxVisible);
    hiddenItems.hide();

    const button = $("<button>")
      .attr("type", "button")
      .addClass("map-content-buildings-toggle")
      .attr("aria-expanded", "false")
      .text(showMoreBuildingsLabel(hiddenItems.length));

    button.on("click", function(){
      const isExpanded = button.attr("aria-expanded") === "true";
      if (isExpanded) {
        hiddenItems.hide();
        button
          .attr("aria-expanded", "false")
          .text(showMoreBuildingsLabel(hiddenItems.length));
        return;
      }
      hiddenItems.show();
      button
        .attr("aria-expanded", "true")
        .text(t("map_content_show_less_buildings", "Show fewer buildings"));
    });

    listElem.after(button);
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
    if (typeof window.TM[name].render !== 'function') {
      return null;
    }
    return window.TM[name];
  }

  function renderSection(listElem, renderer, mapContent, helpers, fallbackKey, fallbackText) {
    if (!listElem || !listElem.length) {
      return 0;
    }
    if (!renderer) {
      showMessage(listElem, t("map_content_unavailable", "Map content is not available."));
      return 0;
    }

    listElem.empty();
    const renderedCount = renderer.render(mapContent, listElem, helpers);
    const count = (typeof renderedCount === "number" && isFinite(renderedCount))
      ? renderedCount
      : (parseInt(renderedCount, 10) || 0);
    if (count > 0) {
      return count;
    }
    if (typeof renderer.emptyMessage === 'function') {
      showMessage(listElem, renderer.emptyMessage(helpers));
      return 0;
    }
    showMessage(listElem, t(fallbackKey, fallbackText));
    return 0;
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

    const waysRenderer = getRenderer("mapDescWays");
    const buildingsRenderer = getRenderer("mapDescAreas");

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
      const mapContent = parseMapContent(payload);
      const helpers = { t: t };
      if (waysListElem.length) {
        renderSection(
          waysListElem,
          waysRenderer,
          mapContent,
          helpers,
          "map_content_no_ways",
          "No ways listed for this map."
        );
      }
      if (buildingsListElem.length) {
        renderSection(
          buildingsListElem,
          buildingsRenderer,
          mapContent,
          helpers,
          "map_content_no_buildings",
          "No buildings listed for this map."
        );
        applyBuildingsListLimit(buildingsListElem, MAX_VISIBLE_BUILDINGS);
      }
    }).fail(function(){
      if (waysListElem.length) {
        showMessage(waysListElem, t("map_content_unavailable", "Map content is not available."));
      }
      if (buildingsListElem.length) {
        showMessage(buildingsListElem, t("map_content_unavailable", "Map content is not available."));
      }
    });
  }

  window.insertMapDescription = insertMapDescription;
})();
