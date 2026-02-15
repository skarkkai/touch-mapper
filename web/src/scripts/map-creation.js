/* global $ mapCalc Backbone isNan _ ol THREE performance google ga fbq TRANSLATIONS i18next mapDiameter */
/* eslint quotes:0, space-unary-ops:0, no-alert:0, no-unused-vars:0, no-shadow:0, no-extend-native:0, no-trailing-spaces:0 */

(function(){
  var MAX_WAIT = 10 * 60; // time out after this many seconds

  function pollProgress(startTime, requestId) {
      var pollAgain = function(){
        setTimeout(function(){
          pollProgress(startTime, requestId);
        }, 1000);
      };
      var progressLabelKeyByValue = {
        20: "progress__reading_osm",
        60: "progress__converting",
        80: "progress__uploading"
      };

      // Timeout
      if (new Date().getTime() / 1000 - startTime > MAX_WAIT) {
        showError("Processing took too long");
        return;
      }

      // Check for processing status
      $.ajax({
          type: "GET",
          url: makeS3InfoUrl(requestId), // CloudFront caches 404 responses, so can't poll through it
          cache: false
      }).fail(function(jqXHR, textStatus, errorThrown){
        if (jqXHR.status === 404) {
            pollAgain();
        } else {
            showError("Error: " + textStatus);
        }
      }).done(function(d, textStatus, jqXHR){
        var payload = d;
        if (typeof payload === "string") {
          try {
            payload = JSON.parse(payload);
          } catch (e) {
            pollAgain();
            return;
          }
        }
        var status = payload && payload.status ? payload.status : null;
        if (!status) {
          pollAgain();
          return;
        }

        if (status.errorCode) {
          var translationKey = "conversion_error_" + status.errorCode;
          var localized = window.TM.translations[translationKey] || translationKey;
          showError(localized);
          if (status.errorDescription && window.console && window.console.error) {
            window.console.error("Map conversion failed (" + status.errorCode + "): " + status.errorDescription);
          }
          return;
        }

        var progress = parseInt(status.progress, 10);
        if (isNaN(progress)) {
          pollAgain();
          return;
        }
        if (progress >= 100) {
          location.href = makeMapPageUrlRelative(requestId);
        } else {
          var progressKey = progressLabelKeyByValue[progress];
          var desc = progressKey ? (window.TM.translations[progressKey] || progressKey) : (progress + "%");
          $("#submit-button").val(desc);
          pollAgain();
        }
      });
  }

  function sqsSendDone(requestId){
    var startTime = new Date().getTime() / 1000;
    pollProgress(startTime, requestId);
  }

  function sendSqsRequest(msg) {
    var body = encodeURIComponent(JSON.stringify(msg));
    $.ajax({
        type: "GET",
        url: window.TM_MAP_REQUEST_SQS_QUEUE + "?Action=SendMessage&MessageBody=" + body + "&Version=2012-11-05"
    }).done(function(d, textStatus, jqXHR){
      sqsSendDone(msg.requestId);
    }).fail(function(jqXHR, textStatus, errorThrown) {
      showError("can't access SQS queue: " + textStatus + ": " + errorThrown);
    });
  }

  function withBrowserIp(msg, done) {
    $.ajax({
      type: "GET",
      url: "https://api.ipify.org?format=json",
      dataType: "json",
      timeout: 1500
    }).done(function(response) {
      if (response && typeof response.ip === "string" && response.ip.length > 0) {
        msg.browserIp = response.ip;
      }
    }).always(function() {
      done();
    });
  }

  function hashStringFNV1a(text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return ("00000000" + (hash >>> 0).toString(16)).slice(-8);
  }

  function buildBrowserFingerprint() {
    var timezone = "";
    try {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch (e) {
      timezone = "";
    }
    var parts = [
      navigator.userAgent || "",
      navigator.language || "",
      (navigator.languages || []).join(","),
      navigator.platform || "",
      timezone,
      String(screen.width || ""),
      String(screen.height || ""),
      String(screen.colorDepth || ""),
      String(window.devicePixelRatio || ""),
      String(navigator.hardwareConcurrency || ""),
      String(navigator.deviceMemory || ""),
      String(navigator.maxTouchPoints || "")
    ];
    return "fp1-" + hashStringFNV1a(parts.join("|"));
  }

  window.submitMapCreation = function() {
    var radius = mapDiameter() / 2;
    if (Math.abs(data.get("offsetX")) >= radius || Math.abs(data.get("offsetY")) >= radius) {
      alert("Area adjustment offset can't be greater than map radius.");
      return;
    }

    $("#submit-button").attr("disabled", true);
    $("#output").slideUp().empty();
    var msg = {
      addrShort: data.get("selected_addr_short"),
      addrLong: data.get("selected_addr_full"),
      printingTech: data.get("printing-tech"),
      offsetX: data.get("offsetX"),
      offsetY: data.get("offsetY"),
      size: data.get("size"),
      contentMode: data.get("content-mode") || "normal",
      hideLocationMarker: data.get("hide-location-marker") || false,
      lon: data.get("lon"),
      lat: data.get("lat"),
      effectiveArea: (function(){
        var metersPerDeg = mapCalc.metersPerDegree(data.get("lat"));
        var degreesLon = 1 / metersPerDeg.lon * radius;
        var degreesLat = 1 / metersPerDeg.lat * radius;
        var posLonLat = computeLonLat(data);
        return {
          lonMin: posLonLat[0] - degreesLon,
          lonMax: posLonLat[0] + degreesLon,
          latMin: posLonLat[1] - degreesLat,
          latMax: posLonLat[1] + degreesLat
        };
      })(),
      scale: parseInt(data.get("scale"), 10),
      diameter: Math.round(radius * 2), // larger of x and y diameter in meters
      multipartMode: data.get("multipartMode") || false,
      noBorders: data.get("multipartMode"),
      multipartXpc: data.get("multipartXpc"),
      multipartYpc: data.get("multipartYpc"),
      advancedMode: data.get("advancedMode") || false,
      browserFingerprint: buildBrowserFingerprint(),
      requestId: (function(){
          var id = newMapId() + "/" + data.get("selected_addr_short").replace(/[\x00-\x1F\x80-\x9F/]/g, '_');
          var xpc = data.get("multipartXpc");
          var ypc = data.get("multipartYpc");
          if (data.get("multipartMode")) {
              id += "-" + (xpc < 0 ? "m" : "p") + Math.abs(xpc) + "X";
              id += "-" + (ypc < 0 ? "m" : "p") + Math.abs(ypc) + "Y";
          }
          return id;
      })()
    };
    if (! msg.hideLocationMarker) {
      msg.marker1 = {
        lat: parseFloat(data.get("lat")),
        lon: parseFloat(data.get("lon"))
      };
    }
    $("#submit-button").val(window.TM.translations.progress__connecting);
    withBrowserIp(msg, function() {
      sendSqsRequest(msg);
    });
    //fbq('track', 'ViewContent');
  };

})();
