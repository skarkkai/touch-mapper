/* global $ mapCalc Backbone isNan _ ol THREE performance google ga fbq TRANSLATIONS i18next */
/* eslint quotes:0, space-unary-ops:0, no-alert:0, no-unused-vars:0, no-shadow:0, no-extend-native:0, no-trailing-spaces:0, space-infix-ops:0 camelcase:0 */

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


     var locNames2 =
       " tl tr bl br place_name" +
       " x  .  .  .  top_left" +
       " .  x  .  .  top_right" +
       " .  .  x  .  bottom_left" +
       " .  .  .  x  bottom_right" +
       " x  x  .  .  top" +
       " .  .  x  x  bottom" +
       " x  .  x  .  left" +
       " .  x  .  x  right";

     var locNames3 =
       " tl tc tr   ml mc mr   bl bc br  place_name" +
       " x  .  .    .  .  .    .  .  .   top_left" +
       " x  x  x    .  .  .    .  .  .   top_row" +
       " x  .  .    x  x  x    .  .  .   middle_row" +
       " .  x  .    x  x  x    .  .  .   middle_row" +
       " .  .  x    x  x  x    .  .  .   middle_row" +
       " .  .  .    x  x  x    x  .  .   middle_row" +
       " .  .  .    x  x  x    .  x  .   middle_row" +
       " .  .  .    x  x  x    .  .  x   middle_row"
       ;

    // locNames is center point symmetric, so only top portion combinations (and the center) are
    // defined above. The rest are generated according to this mapping.
    var loc3rotation = {
      loc: {
        tl: 'tr',
        tc: 'mr',
        tr: 'br',
        mr: 'bc',
        br: 'bl',
        bc: 'ml',
        bl: 'tl',
        ml: 'tc',
        mc: 'mc'
      },
      label: {
        top_left: 'top_right',
        top_row: 'right_column',

        top_right: 'bottom_right',
        right_column: 'bottom_column',

        bottom_right: 'bottom_left',
        bottom_column: 'left_column',

        bottom_left: 'top_left',
        left_column: 'top_row',

        // Two states only
        middle_row: 'center_column',
        center_column: 'middle_row',

        // One state only
        middle_center: 'middle_center'
      }
    };

    function areEqualShallow(a, b) {
      for(var key in a) {
          if(!(key in b) || a[key] !== b[key]) {
              return false;
          }
      }
      for(var key in b) {
          if(!(key in a) || a[key] !== b[key]) {
              return false;
          }
      }
      return true;
    }

    function rotateLocNames(source, locRotation) {
      var locMap = locRotation.loc;
      var labelMap = locRotation.label;
      var out = {};
      $.each(source, function(locStr, label){
        var locs = locStr.split("+");
        var newLocs = $.map(locs, function(loc){ return locMap[loc]; });
        if (locs.length !== newLocs.length) {
          console.log("locs:", locs, "newLocs:", newLocs);
          throw "loc rotation mismatch";
        }
        var newLabel = labelMap[label];
        if (! newLabel) {
          throw "no rotation label for " + label;
        }
        out[newLocs.sort().join("+")] = newLabel;
      });
      return out;
    }

    // Parse locNames to { "tl+tr" => "top", ... }
    function parseLocNames(divCount, _names) {
      var names = _names.trim().split(/ +/);
      var rowSize = divCount*divCount + 1;
      if (names.length % rowSize !== 0) {
        throw "locnames size " + names.length + " is not divisible by " + rowSize;
      }
      var labels = names.splice(0, rowSize);
      var baseMap = {}; // eg "tl tr" => "top"
      while (names.length > 0) {
        var row = names.splice(0, rowSize);
        var name = row.splice(-1, 1)[0];
        var rowLocs = {};
        for (var i = 0; i < rowSize - 1; i++) {
          if (row[i] === 'x') {
            rowLocs[labels[i]] = true;
          }
        }
        baseMap[ Object.keys(rowLocs).sort().join("+") ] = name;
      }

      // Rotate 3 times
      var out = {};
      $.extend(out, baseMap);
      if (divCount === 3) {
        var curMap = $.extend({}, baseMap);
        $.each([1, 2, 3], function(i){
          curMap = rotateLocNames(curMap, loc3rotation);
          console.log("curMap", curMap);
          $.extend(out, curMap);
        });
        curMap = rotateLocNames(curMap, loc3rotation);
        console.log("curMap4", curMap);
        if (! areEqualShallow(curMap, baseMap)) {
          console.log("original locMap:", baseMap, "final:", curMap);
          throw "locNames map with divCount " + divCount + " changed after 4 rotations";
        }
      }
      return out;
    }

    function classesToPlaceName(classes, placeNames) {
      var str = Object.keys(classes).sort().join("+");
      console.log(str, placeNames[str]);
      return placeNames[str];
    }

    function pointClass2(posX, posY) {
      var classes = {};
      var y = posY > 0.5 ? 't' : 'b';
      var x = posX < 0.5 ? 'l' : 'r';
      return y + x;
    }

    function pointClass3(posX, posY) {
      var y, x;
      if (posY > 2/3) {
        y = 't';
      } else {
        y = posY > 1/3 ? 'm' : 'b';
      }
      if (posX < 1/3) {
        x = 'l';
      } else {
        x = posX < 2/3 ? 'c' : 'r';
      }
      return y + x;
    }

    function classifyRoadLocations(roads, bounds) {
      var width = bounds.maxX - bounds.minX;
      var height = bounds.maxY - bounds.minY;
      $.each(roads, function(name, road){
        var classes2 = {};
        var classes3 = {};
        var pos = [];
        $.each(road.points, function(i, point){
          var posX = (point.x - bounds.minX) / width;
          var posY = (point.y - bounds.minY) / height;
          if (posX < -0.1 || posX > 1.1 || posY < -0.1 || posY > 1.1) {
            return;
          }
          classes2[pointClass2(posX, posY)] = true;
          classes3[pointClass3(posX, posY)] = true;
          pos.push("x: " + Math.round(posX*100)/100 + ", y:" + Math.round(posY*100)/100);
        });
        road.classes2 = classes2;
        road.classes3 = classes3;
        road.pos = pos;
      });
    }

    function nameRoadPlaces(roads, bounds) {
      classifyRoadLocations(roads, bounds);
      var locNames2map = parseLocNames(2, locNames2);
      var locNames3map = parseLocNames(3, locNames3);
      console.log(locNames3map);
      $.each(roads, function(name, road){
        road.place2 = classesToPlaceName(road.classes2, locNames2map);
        road.place3 = classesToPlaceName(road.classes3, locNames3map);
        console.log(road);
      });
    }

    function insertMapDescription(info, container) {
      var roads = (info.objectInfos || {}).ways || {};
      nameRoadPlaces(roads, info.bounds);
      var roadNames = [];
      $.each(roads, function(name){
        if (Object.keys(roads[name].classes2).length === 0) {
          // If there are no location classes, it means all of the road's points are outside of the map
          return;
        }
        roadNames.push(name);
      });
      if (roadNames.length > 0) {
        roadNames = roadNames.sort(function(a, b){ return roads[b].totalLength - roads[a].totalLength; });
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
