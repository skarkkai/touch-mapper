/* global $ */
/* eslint quotes:0, space-unary-ops:0, no-alert:0, no-unused-vars:0, no-shadow:0, no-extend-native:0, no-trailing-spaces:0, space-infix-ops:0, camelcase:0, dot-notation:0 */

/*
 * Build short, human-friendly map descriptions from map-content.json.
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
      return;
    }
    if (!renderer) {
      showMessage(listElem, t("map_content_unavailable", "Map content is not available."));
      return;
    }

    listElem.empty();
    const count = renderer.render(mapContent, listElem, helpers);
    if (count > 0) {
      return;
    }
    if (typeof renderer.emptyMessage === 'function') {
      showMessage(listElem, renderer.emptyMessage(helpers));
      return;
    }
    showMessage(listElem, t(fallbackKey, fallbackText));
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
