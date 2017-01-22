'use strict';
/* eslint camelcase:0, quotes:0, space-unary-ops:0, no-alert:0, no-unused-vars:0, no-shadow:0, no-extend-native:0, no-trailing-spaces:0 */

function createCookie(name, value, days) {
    var expires;
    if (days) {
        var date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        expires = "; expires=" + date.toGMTString();
    } else {
        expires = "";
    }
    document.cookie = name + "=" + value + expires + "; path=/";
}

function readCookie(name) {
    var nameEQ = name + "=";
    var ca = document.cookie.split(';');
    for (var i = 0; i < ca.length; i++) {
        var c = ca[i];
        while (c.charAt(0) === ' ') {
            c = c.substring(1, c.length);
        }
        if (c.indexOf(nameEQ) === 0) {
            return c.substring(nameEQ.length, c.length);
        }
    }
    return null;
}

function mapDiameter() {
  // Map diameter in meters
  return data.get("size") / 100 * data.get("scale");
}

function eraseCookie(name) {
    createCookie(name, "", -1);
}

function computeLonLat(data) {
  var metersPerDeg = mapCalc.metersPerDegree(data.get("lat"));
  return [
      data.get("lon") + (data.get("offsetX") + data.get("multipartXpc") / 100 * mapDiameter()) / metersPerDeg.lon,
      data.get("lat") + (data.get("offsetY") + data.get("multipartYpc") / 100 * mapDiameter()) / metersPerDeg.lat ];
}

function getUrlParam(name, url) {
    if (!url) {
        url = window.location.href;
    }
    name = name.replace(/[\[\]]/g, "\\$&");
    var regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)", "i"),
        results = regex.exec(url);
    if (!results) {
        return null;
    }
    if (!results[2]) {
        return '';
    }
    return decodeURIComponent(results[2].replace(/\+/g, " "));
}

function randomHex128() {
  function s4() {
    return Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  }
  return s4() + s4() + s4() + s4();
}

function uriEncodeRequestId(rid) {
  if (rid === undefined || rid === null || rid === "") {
    return rid;
  }
  var parts = rid.split('/', 2);
  return parts[0] + '/' + encodeURIComponent(parts[1]);
}

(function(){
  var TM_ENV_PREFIX = (window.TM_ENVIRONMENT === 'prod' ? '' : window.TM_ENVIRONMENT + '.');
  var TM_HOST = window.location.protocol + "//" + TM_ENV_PREFIX + "touch-mapper.org";
  var MAPS_S3_HOST = window.location.protocol + "//s3-eu-west-1.amazonaws.com/" + window.TM_ENVIRONMENT + ".maps.touch-mapper";

  window.makeS3url = function(id) {
    return MAPS_S3_HOST + "/map/" + uriEncodeRequestId(id) + '.stl';
  };

  window.makeCloudFrontUrl = function(id) {
    return TM_HOST + "/map/" + uriEncodeRequestId(id) + '.stl';
  };

  window.makeCloudFrontInfoUrl = function(id) {
    var idStart = id.split('/', 2)[0];
    return TM_HOST + "/map/" + idStart + '/info.json';
  };

  window.makeMapPageUrlRelative = function(id) {
    var idStart = id.split('/', 2)[0];
    return "map?map=" + idStart;
  };

  window.makeMapPermaUrl = function(id) {
    var idStart = id.split('/', 2)[0];
    return TM_HOST + '?map=' + idStart;
  };

  window.makeReturnUrl = function(id) {
    return TM_HOST + "/return" + "?id=" + uriEncodeRequestId(id);
  };
})();

function showError(errorMsg) {
  $("#output").append(
    $("<div>").text(errorMsg).addClass("error-msg large-row").attr("role", "alert")
  ).slideDown();
}

if (!String.prototype.startsWith) {
  String.prototype.startsWith = function(searchString, position) {
    position = position || 0;
    return this.indexOf(searchString, position) === position;
  };
}

function optionExistsInSelect($elem, value) {
  var exists = false;
  $elem.find('option').each(function(){
    if (this.value === "" + value) {
        exists = true;
    }
  });
  return exists;
}

function setLocalStorage(key, value) {
  window.localStorage[key] = value;
}

function getLocalStorageStr(key, defaultValue) {
  return window.localStorage[key] || defaultValue;
}
function getLocalStorageInt(key, defaultValue) {
  var str = getLocalStorageStr(key);
  return str ? parseInt(str, 10) : defaultValue;
}
