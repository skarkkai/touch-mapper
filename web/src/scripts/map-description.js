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

    function makeMapDescription(info) {
      var roads = info.objectInfos;
      var roadNames = [];
      $.each(roads, function(name){
        roadNames.push(name);
      });
      if (roadNames.length > 0) {
        return $("<div>").text("Roads: " + roadNames.join(", "));
      }
      return "No named objects";
    }

    window.makeMapDescription = makeMapDescription;
})();
