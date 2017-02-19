'use strict';
/* global $ mapCalc Backbone isNan _ ol THREE performance google ga fbq TRANSLATIONS i18next show3dPreview */
/* eslint quotes:0, space-unary-ops:0, no-alert:0, no-unused-vars:0, no-shadow:0, no-extend-native:0, no-trailing-spaces:0 */

(function(){
  var PLAYFUL_PIXELS_URL = "https://www.playfulpixels.com/en/tactile-map";

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

  function infoLoadHandler(d, textStatus, jqXHR){
    var info = JSON.parse(d);
    $(".map-address").text(info.addrLong);

    var meta = {
        size: info.size,
        address: info.addrLong,
        returnUrl: makeReturnUrl(info.requestId),
        permaUrl: makeMapPermaUrl(info.requestId),
    };
    var cloudFrontUrl = makeCloudFrontUrl(info.requestId);

    /*
     * Ordering
     */
    // Keep in sync with the email-sending lambda
    $("#order-map").attr("href", PLAYFUL_PIXELS_URL
      + "?touchMapFileUrl=" + encodeURIComponent(cloudFrontUrl)
      + "&mapMeta=" + encodeURIComponent(JSON.stringify(meta)));
    initEmailSending($('.email-sending.type-order'), 'order', cloudFrontUrl, meta);

    /*
     * Downloading
     */
    $("#download-map").attr("href", cloudFrontUrl);
    initEmailSending($('.email-sending.type-self'), 'self', cloudFrontUrl, meta);

    $("#download-svg").attr("href", makeCloudFrontUrlSvg(info.requestId));
    $("#download-pdf").attr("href", makeCloudFrontUrlPdf(info.requestId));

    if (parseInt(jqXHR.getResponseHeader('x-amz-meta-building_count'), 10) === 0) {
        $('.warning-no-buildings').show();
    }
    $(".show-on-load").show();
    show3dPreview($('.preview-3d'), cloudFrontUrl);
  };

  $(window).ready(function(){
    var id = getUrlParam("map");
    if (! id) {
      alert("Query parameter 'map' required");
      return;
    }

    $(".back-to-previous-page").attr("href", "area?map=" + id);

    initPrintingMethod();

    $.ajax({
        url: makeCloudFrontInfoUrl(id)
    }).fail(function(jqXHR, textStatus, errorThrown){
      if (jqXHR.status === 404) {
        alert("There is no map for ID " + id);
      } else {
        alert("Error: " + textStatus);
      }
    }).done(infoLoadHandler);
  });
})();
