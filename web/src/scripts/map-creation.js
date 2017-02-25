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

      // Timeout
      if (new Date().getTime() / 1000 - startTime > MAX_WAIT) {
        showError("Processing took too long");
        return;
      }

      // Check for processing stage
      $.ajax({
          type: "HEAD",
          url: makeS3url(requestId) // CloudFront caches 404 responses, so can't poll through it
      }).fail(function(jqXHR, textStatus, errorThrown){
        if (jqXHR.status === 404) {
            pollAgain();
        } else {
            showError("Error: " + textStatus);
        }
      }).done(function(d, textStatus, jqXHR){
        // Error
        var errorMsg = jqXHR.getResponseHeader('x-amz-meta-error-msg');
        if (errorMsg) {
          showError("Error: " + errorMsg);
          return;
        }

        var stage = jqXHR.getResponseHeader('x-amz-meta-processing-stage');
        if (stage) {

          // Progress update
          var desc = {
             "start": "Initializing...",
             "reading_osm": "Reading map data...",
             "converting": "Creating 3D model...",
             "uploading": "Finishing..."
          }[stage];
          if (desc) {
            $("#submit-button").val(desc);
          }
          pollAgain();
        } else {

          // Completed
          location.href = makeMapPageUrlRelative(requestId);
        }
      });
  }

  function sqsSendDone(requestId){
    var startTime = new Date().getTime() / 1000;
    pollProgress(startTime, requestId);
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
      marker1: {
        lat: parseFloat(data.get("lat")),
        lon: parseFloat(data.get("lon"))
      },
      advancedMode: data.get("advancedMode") || false,
      requestId: (function(){
          var id = randomHex128() + "/" + data.get("selected_addr_short").replace(/[\x00-\x1F\x80-\x9F/]/g, '_');
          var xpc = data.get("multipartXpc");
          var ypc = data.get("multipartYpc");
          if (data.get("multipartMode")) {
              id += "-" + (xpc < 0 ? "m" : "p") + Math.abs(xpc) + "X";
              id += "-" + (ypc < 0 ? "m" : "p") + Math.abs(ypc) + "Y";
          }
          return id;
      })()
    };
    var body = encodeURIComponent(JSON.stringify(msg));
    $("#submit-button").val("Connecting...");
    $.ajax({
        type: "GET",
        url: window.TM_MAP_REQUEST_SQS_QUEUE + "?Action=SendMessage&MessageBody=" + body + "&Version=2012-11-05"
    }).done(function(d, textStatus, jqXHR){
      $("#submit-button").val("Waiting for server...");
      $("#submit-button")[0].focus();
      sqsSendDone(msg.requestId);
    }).fail(function(jqXHR, textStatus, errorThrown) {
      showError("can't access SQS queue: " + textStatus + ": " + errorThrown);
    });
    //fbq('track', 'ViewContent');
  };

})();
