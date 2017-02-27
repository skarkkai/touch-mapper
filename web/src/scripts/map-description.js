/* global $ mapCalc Backbone isNan _ ol THREE performance google ga fbq TRANSLATIONS i18next */
/* eslint quotes:0, space-unary-ops:0, no-alert:0, no-unused-vars:0, no-shadow:0, no-extend-native:0, no-trailing-spaces:0, space-infix-ops:0 */

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

    function pointClasses(posX, posY) {
      var classes = {};

      var x2 = posX < 0.5 ? 'l' : 'r';
      var y2 = posY < 0.5 ? 't' : 'b';
      classes[x2 + y2 + '2'] = true;

      var x3, y3;
      if (posX < 1/3) {
        x3 = 'l';
      } else {
        x3 = posX < 2/3 ? 'c' : 'r';
      }
      if (posY < 1/3) {
        y3 = 't';
      } else {
        y3 = posY < 2/3 ? 'm' : 'b';
      }
      classes[x3 + y3 + '3'] = true;
      return classes;
    }

    function classifyRoadLocations(roads, bounds) {
      console.log(bounds);
      var width = bounds.maxX - bounds.minX;
      var height = bounds.maxY - bounds.minY;
      $.each(roads, function(name, road){
        $.each(road.points, function(i, point){
          var posX = (point.x - bounds.minX) / width;
          var posY = (point.y - bounds.minY) / height;
          if (posX < 0.1 || posX > 1.1 || posY < 0.1 || posY > 1.1) {
            return;
          }
          point.classes = pointClasses(posX, posY);
          point.pos = [posX, posY];
          console.log(point);
        });
      });
    }

    function insertMapDescription(info, container) {
      var roads = (info.objectInfos || {}).ways || {};
      classifyRoadLocations(roads, info.bounds);
      var roadNames = [];
      $.each(roads, function(name){
        roadNames.push(name);
      });
      if (roadNames.length > 0) {
        roadNames = roadNames.sort(function(a, b){ return roads[b].totalLength - roads[a].totalLength; });
        console.log(roadNames);
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
