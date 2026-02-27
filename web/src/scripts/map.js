'use strict';
/* global $ mapCalc Backbone isNan _ ol THREE performance google ga fbq TRANSLATIONS i18next show3dPreview */
/* eslint quotes:0, space-unary-ops:0, no-alert:0, no-unused-vars:0, no-shadow:0, no-extend-native:0, no-trailing-spaces:0 */

(function(){
  function showMapDescriptionError(error) {
    var errMsg = error && error.message ? error.message : String(error || "Unknown error");
    var row = $(".map-content-row");
    if (!row.length) {
      return;
    }
    row.show();
    row.find(".map-content")
      .removeClass("initial-state")
      .empty()
      .append($("<p>").addClass("error-msg").text(errMsg));
    row.find(".show-more").hide();
  }

  function initPrintingMethod() {

    $("#printing-method-order").change(function(){
      setData("printing-method", "order");
      $(".hidden-for-order").hide();
      $(".hidden-for-self-print").show();
    });

    $("#printing-method-self").change(function(){
      setData("printing-method", "self");
      $(".hidden-for-order").show();
      $(".hidden-for-self-print").hide();
    });
    if (getLocalStorageStr('printing-method', 'order') === 'order') {
      $("#printing-method-order").prop('checked', true).change();
    } else {
      $("#printing-method-self").prop('checked', true).change();
    }
  }

  function checkDataAvailability(url) {
    $.ajax({
        type: "HEAD",
        url: url
    }).fail(function(jqXHR, textStatus, errorThrown){
      if (jqXHR.status === 404) {
          $(".hidden-for-3d, .hidden-for-2d").hide();
          $(".no-data-available-msg").attr().show();
      }
    });
  }

  function initPrintingTech(printingTech, requestId) {
    if (printingTech === '3d') {
      $(".hidden-for-3d").hide();
      initPrintingMethod();
      checkDataAvailability(makeS3url(requestId));
    } else {
      $(".hidden-for-2d").hide();
      checkDataAvailability(makeS3urlSvg(requestId));
    }
  }

  function infoLoadHandler(info, textStatus, jqXHR){
    storeMapSettingsFromInfo(info);

    $(".map-address").text(info.addrLong);

    var meta = {
        size: info.size,
        address: info.addrLong,
        returnUrl: makeReturnUrl(info.requestId),
        permaUrl: makeMapPermaUrl(info.requestId),
    };

    try {
      insertMapDescription(info, $(".map-content")); // from map-description.js
    } catch (error) {
      if (window.console && window.console.error) {
        window.console.error("Failed to render map description", error);
      }
      showMapDescriptionError(error);
    }

    //$("#order-map").attr("href", PLAYFUL_PIXELS_URL
    //  + "?touchMapFileUrl=" + encodeURIComponent(makeMapPermaUrl(info.requestId))
    //  + "&mapMeta=" + encodeURIComponent(JSON.stringify(meta)));
    $("#order-map")
      .attr("href", "https://www.hekeytech.com/contact"
        + "?touchMapFileUrl=" + encodeURIComponent(makeMapPermaUrl(info.requestId))
        + "&mapMeta=" + encodeURIComponent(JSON.stringify(meta)))
      .attr("target", "_blank")
      .attr("rel", "noopener noreferrer");

    // Keep in sync with the email-sending lambda
    initEmailSending($('.email-sending'), meta);

    $("#download-map").attr("href", makeCloudFrontUrl(info.requestId)); // STL
    $("#download-stl-ways").attr("href", makeCloudFrontUrlWays(info.requestId));
    $("#download-stl-rest").attr("href", makeCloudFrontUrlRest(info.requestId));
    $("#download-svg").attr("href", makeCloudFrontUrlSvg(info.requestId));
    $("#download-svg-embossers").attr("href", makeCloudFrontUrlSvg(info.requestId));
    $("#download-pdf").attr("href", makeCloudFrontUrlPdf(info.requestId));
    $("#download-pdf-embossers").attr("href", makeCloudFrontUrlPdf(info.requestId));
    $("#download-blender").attr("href", makeCloudFrontUrlBlend(info.requestId));
    $("#download-map-content").attr("href", makeCloudFrontMapContentUrl(info.requestId));
    $("#svg-preview").attr("src", makeCloudFrontUrlSvg(info.requestId));

    // Only show download links for chosen map type.
    var printingTech = info.printingTech || '3d';
    initPrintingTech(printingTech, info.requestId);

    $(".show-on-load").show();

    if (printingTech === '3d') {
      // Only works after the containing HTML is visible
      show3dPreview($('.preview-3d'), makeCloudFrontUrl(info.requestId));
    }
  };

  $(window).ready(function(){
    var id = getUrlParam("map");
    if (! id) {
      alert("Query parameter 'map' required");
      return;
    }

    $(".back-to-previous-page").attr("href", "area?map=" + id);

    loadInfoJson(id).done(infoLoadHandler);
  });
})();
