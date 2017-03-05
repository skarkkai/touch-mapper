/* global $ mapCalc Backbone isNan _ ol THREE performance google ga fbq TRANSLATIONS i18next */
/* eslint quotes:0, space-unary-ops:0, no-alert:0, no-unused-vars:0, no-shadow:0, no-extend-native:0, no-trailing-spaces:0, space-infix-ops:0, camelcase:0, dot-notation:0 */

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


    var locMap2specs = {
      base:
         " tl tr bl br place_name" +
         " x  .  .  .  top_left" +
         " x  x  .  .  top_row" +
         "",
      locRotation: {
        tl: 'tr',
        tr: 'br',
        br: 'bl',
        bl: 'tl'
      },
      placeRotation: {
        top_left: 'top_right',
        top_row: 'right_column',
        top_right: 'bottom_right',
        right_column: 'bottom_row',
        bottom_right: 'bottom_left',
        bottom_row: 'left_column',
        bottom_left: 'top_left',
        left_column: 'top_row'
      }
    };

    var locMap3specs = {
      base:
         " tl tc tr   ml mc mr   bl bc br  place_name" +
         " .  .  .    .  x  .    .  .  .   middle_center" +
         " .  x  .    .  .  .    .  .  .   top_center" +
         " x  .  .    .  .  .    .  .  .   top_left" +
         " x  x  x    .  .  .    .  .  .   top_row" +
         " x  x  x    x  .  .    .  .  .   mostly_top_row" +
         " x  x  x    .  x  .    .  .  .   mostly_top_row" +
         " x  x  x    .  .  x    .  .  .   mostly_top_row" +
         " x  x  x    .  .  .    x  .  .   mostly_top_row" +
         " x  x  x    .  .  .    .  x  .   mostly_top_row" +
         " x  x  x    .  .  .    .  .  x   mostly_top_row" +
         " .  .  .    x  x  x    .  .  .   middle_row" +
         " x  .  .    x  x  x    .  .  .   middle_row" +
         " .  x  .    x  x  x    .  .  .   middle_row" +
         " .  .  x    x  x  x    .  .  .   middle_row" +
         " .  .  .    x  x  x    x  .  .   middle_row" +
         " .  .  .    x  x  x    .  x  .   middle_row" +
         " .  .  .    x  x  x    .  .  x   middle_row" +
         " x  .  .    x  x  x    x  .  .   middle_row" +
         " x  .  .    .  x  .    .  .  x   top_left_diagonal" +
         " x  x  .    .  x  .    .  .  x   top_left_diagonal" +
         " x  .  .    x  x  .    .  .  x   top_left_diagonal" +
         " x  .  .    .  x  x    .  .  x   top_left_diagonal" +
         " x  .  .    .  x  .    .  x  x   top_left_diagonal" +
         " x  x  .    .  x  x    .  .  x   top_left_diagonal" +
         " x  x  .    .  x  .    .  x  x   top_left_diagonal" +
         " x  .  .    x  x  .    .  x  x   top_left_diagonal" +
         " x  .  .    x  x  x    .  .  x   top_left_diagonal" +
         " x  x  .    x  x  .    .  .  x   top_left_diagonal" +
         " x  x  .    x  x  x    .  .  x   top_left_diagonal" +
         " x  x  .    x  x  .    .  x  x   top_left_diagonal" +
         " x  x  .    x  x  x    .  x  x   top_left_diagonal" +
         " x  .  .    .  x  .    .  .  .   top_left_to_mc" +
         " x  x  .    .  x  .    .  .  .   top_left_to_mc" +
         " x  .  .    x  x  .    .  .  .   top_left_to_mc" +
         " x  x  .    x  x  .    .  .  .   top_left_to_mc" +
         " x  x  .    .  .  .    .  .  .   top_left_and_center" +
         " .  x  x    .  .  .    .  .  .   top_right_and_center" +
         " .  .  x    x  x  .    .  x  x   top_right_and_center" +
         " x  x  .    .  x  x    .  .  .   top_left_to_middle_right" +
         " x  x  .    x  x  x    .  .  .   top_left_to_middle_right" +
         " x  x  x    .  x  x    .  .  .   top_left_to_middle_right" +
         " x  .  x    .  x  x    .  .  .   top_left_to_middle_right" +
         " .  x  x    x  x  .    .  .  .   top_right_to_middle_left" +
         " .  x  x    x  x  x    .  .  .   top_right_to_middle_left" +
         " x  x  x    x  x  .    .  .  .   top_right_to_middle_left" +
         " x  .  x    x  x  .    .  .  .   top_right_to_middle_left" +
         " x  x  .    x  .  .    .  .  .   near_top_left" +
         " .  x  .    x  x  .    .  .  .   top_center_to_middle_left" +
         //tl tc tr   ml mc mr   bl bc br  place_name" +
         "",
         // mr+tc+tr
              //  .  x  .
              //  x  x  .
              //  .  .  .
      // Loc name mapping is center point symmetric, so only top portion combinations (and the center) are
      // defined above. The rest are generated according to this rotation spec.
      locRotation: {
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
      placeRotation: {
        // orig
        top_left: 'top_right',
        top_row: 'right_column',
        mostly_top_row: 'mostly_right_column',
        top_left_to_mc: 'top_right_to_mc',
        top_left_and_center: 'top_right_and_middle',
        top_right_and_center: 'bottom_right_and_middle',
        top_left_to_middle_right: 'top_right_to_bottom_center',
        top_right_to_middle_left: 'bottom_right_to_top_center',
        near_top_left: 'near_top_right',
        top_center_to_middle_left: 'top_center_to_middle_right',
        top_center: 'middle_right',

        // 1. rotation
        top_right: 'bottom_right',
        right_column: 'bottom_row',
        mostly_right_column: 'mostly_bottom_row',
        top_right_to_mc: 'bottom_right_to_mc',
        top_right_and_middle: 'bottom_right_and_center',
        bottom_right_and_middle: 'bottom_left_and_center',
        top_right_to_bottom_center: 'bottom_right_to_middle_left',
        bottom_right_to_top_center: 'bottom_left_to_middle_right',
        near_top_right: 'near_bottom_right',
        top_center_to_middle_right: 'middle_right_to_bottom_center',
        middle_right: 'bottom_center',

        // 2. rotation
        bottom_right: 'bottom_left',
        bottom_row: 'left_column',
        mostly_bottom_row: 'mostly_left_column',
        bottom_right_to_mc: 'bottom_left_to_mc',
        bottom_right_and_center: 'bottom_left_and_middle',
        bottom_left_and_center: 'top_left_and_middle',
        bottom_right_to_middle_left: 'bottom_left_to_top_center',
        bottom_left_to_middle_right: 'top_left_to_bottom_center',
        near_bottom_right: 'near_bottom_left',
        middle_right_to_bottom_center: 'middle_left_to_bottom_center',
        bottom_center: 'middle_left',

        // 3. rotation
        bottom_left: 'top_left',
        left_column: 'top_row',
        mostly_left_column: 'mostly_top_row',
        bottom_left_to_mc: 'top_left_to_mc',
        bottom_left_and_middle: 'top_left_and_center',
        top_left_and_middle: 'top_right_and_center',
        bottom_left_to_top_center: 'top_left_to_middle_right',
        top_left_to_bottom_center: 'top_right_to_middle_left',
        near_bottom_left: 'near_top_left',
        middle_left_to_bottom_center: 'top_center_to_middle_left',
        middle_left: 'top_center',

        // Two states only
        middle_row: 'center_column',
        center_column: 'middle_row',
        top_left_diagonal: 'top_right_diagonal',
        top_right_diagonal: 'top_left_diagonal',

        // One state only
        middle_center: 'middle_center'
      }
    };

    function areEqualShallow(a, b) {
      for(var key in a) {
          if(!(key in b) || a[key] !== b[key]) { return false; }
      }
      for(var key in b) {
          if(!(key in a) || a[key] !== b[key]) { return false; }
      }
      return true;
    }

    function rotateLocs(source, specs) {
      var locMap = specs.locRotation;
      var placeMap = specs.placeRotation;
      var out = {};
      $.each(source, function(locStr, place){
        var locs = locStr.split("+");
        var newLocs = $.map(locs, function(loc){ return locMap[loc]; });
        if (locs.length !== newLocs.length) {
          console.log("locs:", locs, "newLocs:", newLocs);
          throw "loc rotation mismatch";
        }
        var newPlace = placeMap[place];
        if (! newPlace) {
          throw "no rotation place name for " + place;
        }
        out[newLocs.sort().join("+")] = newPlace;
      });
      return out;
    }

    // Convert locMap2specs.base to { "tl+tr" => "top", ... } and add 3 rotations
    function buildLocMap(specs) {
      var names = specs.base.trim().split(/ +/);
      var rowSize = Object.keys(specs.locRotation).length + 1;
      if (names.length % rowSize !== 0) {
        throw "locnames size " + names.length + " is not divisible by " + rowSize;
      }
      var places = names.splice(0, rowSize);
      var baseMap = {}; // eg "tl tr" => "top"
      while (names.length > 0) {
        var row = names.splice(0, rowSize);
        var name = row.splice(-1, 1)[0];
        var rowLocs = {};
        for (var i = 0; i < rowSize - 1; i++) {
          if (row[i] === 'x') {
            rowLocs[places[i]] = true;
          }
        }
        var str = Object.keys(rowLocs).sort().join("+");
        if (baseMap[str]) {
          throw "duplicate: " + str;
        }
        baseMap[str] = name;
      }

      // Rotate 3 times
      var out = {};
      $.extend(out, baseMap);
      var curMap = $.extend({}, baseMap);
      $.each([1, 2, 3], function(i){
        curMap = rotateLocs(curMap, specs);
        //console.log("curMap", curMap);
        $.extend(out, curMap);
      });
      curMap = rotateLocs(curMap, specs);
      //console.log("curMap4", curMap);
      if (! areEqualShallow(curMap, baseMap)) {
        console.log("original locMap:", baseMap, "final:", curMap);
        throw "locNames map with " + divCount + " changed after 4 rotations";
      }
      return out;
    }

    var LOC_2_MAP = buildLocMap(locMap2specs);
    var LOC_3_MAP = buildLocMap(locMap3specs);

    function uniqueSorted(a) {
      var sorted = a.sort();
      return $.grep(sorted, function(value, index, array) {
          return (index === 0) || (value !== sorted[index-1]);
      });
    }

    // Print out a translation injector string that can be pasted into HTML
    function printPlaceTranslationLines(locMap, category) {
      var list = [];
      var placeNames = $.map(locMap, function(val, key) { return val; });
      var prefix = 'location' + category + '_';
      $.each(uniqueSorted(placeNames), function(i, placeName){
        list.push('  "' + prefix + placeName + '": "{{ ' + prefix + placeName + ' }}",\n');
      });
      console.log(list.join(""));
    }

    function classesToPlaceName(classes, placeNames) {
      var str = Object.keys(classes).sort().join("+");
      //console.log(str, placeNames[str]);
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
      //printPlaceTranslationLines(LOC_2_MAP, 2);
      //printPlaceTranslationLines(LOC_3_MAP, 3);
      $.each(roads, function(name, road){
        var place = classesToPlaceName(road.classes3, LOC_3_MAP);
        if (place) {
          road.place = '3_' + place;
        } else {
          place = classesToPlaceName(road.classes2, LOC_2_MAP);
          if (place) {
            road.place = '2_' + place;
          } else {
            road.place = '_general';
          }
        }
        //console.log(road.name, road.place, road.classes2, road.classes3); // XXXXXXXXXXXXXXXXXX uncomment to debug location => place assignments
      });
    }

    function pointPlace(point, bounds) {
      var width = bounds.maxX - bounds.minX;
      var height = bounds.maxY - bounds.minY;
      var posX = (point.x - bounds.minX) / width;
      var posY = (point.y - bounds.minY) / height;
      if (posX < -0.1 || posX > 1.1 || posY < -0.1 || posY > 1.1) {
        return null;
      }
      var classes = {};
      classes[pointClass3(posX, posY)] = true;
      var place = classesToPlaceName(classes, LOC_3_MAP);
      if (place) {
        return '3_' + place;
      } else {
        return null; // shouldn't happen
      }
    }

    // TODO: show other categories than restaurants too
    function insertPois(info, container) {
      var pois = info.objectInfos.pois.restaurant || {};
      //var names = Object.keys(pois).sort(function(a, b) { return pois[b].center.x - pois[b].center.x; });
      var names = Object.keys(pois).sort(function(a, b) {
        if (pois[a].street && ! pois[b].street) {
          return -1;
        } else if (pois[b].street && ! pois[a].street) {
          return 1;
        } else {
          return a.localeCompare(b, {'sensitivity': 'base'});
        }
      });
      if (names.length > 0) {
        var lis = [];
        $.each(names, function(i, name){
          var poi = pois[name];
          var where = [];
          if (poi.street) {
            where.push(poi.houseNumber ? poi.street + ' ' + poi.houseNumber : poi.street);
          }
          var place = pointPlace(poi.center, info.bounds);
          if (place) {
            where.push(window.TM.translations["location" + place]);
          }
          //console.log(name, poi.center, place);
          var li = $("<li>").text(name + ' (' + where.join(', ') + ')');
          lis.push(li);
        });
        container.find(".row.restaurant ul").append(lis);
      } else {

      }

    }

    function insertRoads(info, container) {
      var roads = info.objectInfos.ways || {};
      function roadPlaceTranslation(roadName) {
        return window.TM.translations["location" + roads[roadName].place];
      }
      nameRoadPlaces(roads, info.bounds);
      var roadNames = [];
      var roadsLen = 0;
      var unnamedRoadsLen = 0;
      $.each(roads, function(name){
        if (Object.keys(roads[name].classes2).length === 0) {
          // If there are no location classes, it means all of the road's points are outside of the map
          return;
        }
        roadsLen += roads[name].totalLength;
        if (name === '_unnamed_roads') {
          unnamedRoadsLen = roads[name].totalLength;
        } else {
          roadNames.push(name);
        }
      });
      if (roadsLen > 0) {
        roadNames = roadNames.sort(function(a, b){ return roads[b].totalLength - roads[a].totalLength; });
        var lis = [];
        $.each(roadNames, function(i, roadName){
          var li = $("<li>").text(roadName + ' (' + window.TM.translations["location" + roads[roadName].place] + ')');
          if (i >= 4) {
            li.addClass("initially-hidden");
          }
          lis.push(li);
        });
        container.find(".row.road").show().find("ul").prepend(lis);
        if (unnamedRoadsLen > 0) {
          if (roadNames.length === 0) {
            container.find(".unnamed-roads.percentage").remove();
            var text = container.find(".unnamed-roads.meters").text();
            text = text.replace("%LOCATION%", roadPlaceTranslation('_unnamed_roads'));
            text = text.replace("%METERS%", Number(unnamedRoadsLen.toPrecision(2)).toFixed());
            text = text.replace("%YARDS%", Number((unnamedRoadsLen / 1.0936133).toPrecision(2)).toFixed());
          } else {
            container.find(".unnamed-roads.meters").remove();
            var text = container.find(".unnamed-roads.percentage").text();
            text = text.replace("%LOCATION%", roadPlaceTranslation('_unnamed_roads'));
            text = text.replace("%PERCENTAGE%", (unnamedRoadsLen / roadsLen * 100).toPrecision(2));
          }
          container.find(".unnamed-roads").text(text);
        }
        container.find("ul").show();
      } else {
        container.find(".no-roads").show();
      }
    }

    function insertMapDescription(info, container) {
      if (! info.objectInfos) {
        info.info.objectInfos = {};
      }
      insertRoads(info, container);
      insertPois(info, container);
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
