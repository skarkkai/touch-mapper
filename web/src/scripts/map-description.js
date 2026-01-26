/* global $ mapCalc Backbone isNan _ ol THREE performance google ga fbq TRANSLATIONS i18next */
/* eslint quotes:0, space-unary-ops:0, no-alert:0, no-unused-vars:0, no-shadow:0, no-extend-native:0, no-trailing-spaces:0, space-infix-ops:0, camelcase:0, dot-notation:0 */

/*
  * Build short, human-friendly map descriptions from map-meta.json
  */
(function(){
    'use strict';

    /* TODO:
     * - roads/rivers/rails edge crossings, intersections
     * - building locations
     * - water locations
     * - road/river/rail total meters
     * - building coverage %
     * - water coverage %
     */

    // Entry point: read map-meta.json and populate "Map content" block
    function insertMapDescription(info, container) {
      if (! info.objectInfos) {
        info.objectInfos = {};
      }
      var bounds = (info.meta && info.meta.boundary) ? info.meta.boundary : info.bounds;
      if (! bounds) {
        return;
      }
      insertRoads(info, container, bounds);
      insertPois(info, container, bounds);
      if (! info.excludeBuildings && 'buildingCount' in info && info.buildingCount === 0) {
        container.find('.warning-no-buildings').show();
      }
      $(".map-content-row .show-more").click(function(){
        $(".map-content").toggleClass("initial-state");
        $(".map-content-row").focus();
      });
    }

    window.insertMapDescription = insertMapDescription;
})();
