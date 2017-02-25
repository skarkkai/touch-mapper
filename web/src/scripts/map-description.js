/* global $ mapCalc Backbone isNan _ ol THREE performance google ga fbq TRANSLATIONS i18next */
/* eslint quotes:0, space-unary-ops:0, no-alert:0, no-unused-vars:0, no-shadow:0, no-extend-native:0, no-trailing-spaces:0 */

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

    function insertMapDescription(info, container) {
      var roads = info.objectInfos;
      var roadNames = [];
      $.each(roads, function(name){
        roadNames.push(name);
      });
      if (roadNames.length > 0) {
        container.find(".row.roads").show().find(".text").text(roadNames.join(", "));
      } else {
        container.find(".row.nothing").show();
      }
      if (! info.excludeBuildings && 'buildingCount' in info && info.buildingCount === 0) {
        container.find('.warning-no-buildings').show();
      }
    }

    window.insertMapDescription = insertMapDescription;
})();
