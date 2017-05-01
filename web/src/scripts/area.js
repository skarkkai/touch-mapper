'use strict';
/* global $ mapCalc Backbone isNan _ ol THREE performance google ga fbq TRANSLATIONS i18next show3dPreview */
/* eslint quotes:0, space-unary-ops:0, no-alert:0, no-unused-vars:0, no-shadow:0, no-extend-native:0, no-trailing-spaces:0 */

function resetParameters(addr) {
  $("#lat-input").val(addr.lat).trigger('change');
  $("#lon-input").val(addr.lon).trigger('change');
  $("#x-offset-input").val("0").change();
  $("#y-offset-input").val("0").change();
  data.set("multipartXpc", 0);
  data.set("multipartYpc", 0);
}

function selectAddress(addr, index) {
  data.set("selected_addr_short", addr.addrShort);
  data.set("selected_addr_full", addr.addrLong);
  setLocalStorage("addressesSelectedIndex", index);
}

function showAllAddresses(addresses) {
  var selectedIndex = getLocalStorageInt("addressesSelectedIndex", 0);
  $(".first-address, .show-all-addresses").hide();
  _.each(addresses, function(addr, index){
    var id = "address-match-" + index;
    var input = $("<input>")
      .attr("type", "radio")
      .attr("name", "address-match")
      .attr("id", id);
    if (index === selectedIndex) {
      input.prop('checked', true);
    }
    input.change(function(ev) {
      var elem = $(ev.target);
      if (elem.attr('name') !== 'address-match') {
        return;
      }
      selectAddress(addr, index);
      resetParameters(addr);
    });
    $(".all-addresses").append(
      $("<li>")
        .append(input)
        .append($("<label>")
          .attr("for", id)
          .text(addr.addrLong)));
  });
  $(".all-addresses").slideDown(700);
  $("#search-results").focus();
}

function initInputs(outputs, osmDragPanInteraction) {
  var DEFAULT_PRINT_SIZE_2D = "27.9";
  var DEFAULT_PRINT_SIZE_3D = "17";

  var initDone = false;
  var initialPrintingTech = getLocalStorageStr('printing-tech', '3d');

  // Printing technology
  $("#printing-tech-3d").change(function(){
    setData("printing-tech", "3d");
    $(".hidden-for-3d").hide();
    $(".hidden-for-2d").show();
    $("#map-size-preset").change();
  });
  $("#printing-tech-2d").change(function(){
    setData("printing-tech", "2d");
    $(".hidden-for-3d").show();
    $(".hidden-for-2d").hide();
    $("#map-size-input").val(DEFAULT_PRINT_SIZE_2D).change();
  });
  if (initialPrintingTech === '2d') {
    $("#printing-tech-2d").prop('checked', true).change();
  } else {
    $("#printing-tech-3d").prop('checked', true).change();
  }

  // Map content selection
  initSimpleInput("exclude-buildings", $("#exclude-buildings"), "checkbox", true);

  // Print size preset
  $("#map-size-preset").change(function(){
    var preset = $(this).val();
    $("#map-size-input").val(parseFloat(preset).toFixed(1)).change();
    setLocalStorage("map-size-preset", preset);
  }).val(getLocalStorageStr("map-size-preset", DEFAULT_PRINT_SIZE_3D))
    .change();

  // Scale preset
  $("#map-scale-preset").change(function(){
    $("#scale-input").val($(this).val()).change();
    setLocalStorage("map-scale-preset", $(this).val());
  }).val(getLocalStorageStr("map-scale-preset", "2400"))
    .change();

  // Advanced mode
  $("#advanced-input").click(function(){
    if (initDone) {
      $("#advanced-controls").slideToggle();
    } else {
      $("#advanced-controls").toggle();
    }
    $("html").toggleClass("advanced-mode");
    if (! $("html").hasClass("advanced-mode")) {
      // Reset offsets, else they may end up outside of map
      $("#x-offset-input").val("0").change();
      $("#y-offset-input").val("0").change();
      // Basic mode can't be combined with multipart mode
      $("#multipart-map-input").prop("checked", "").change();
      // Set advanced values from non-advanced presets
      if (data.get("printing-tech") === '3d') {
        $("#map-size-preset").change();
      }
      $("#map-scale-preset").change();
    }
  });
  initSimpleInput("advancedMode", $("#advanced-input"), "checkbox", false);

  // Coordinates
  initSimpleInput("lat", $("#lat-input"), 'float', 0);
  initSimpleInput("lon", $("#lon-input"), 'float', 0);

  // Offset
  initSimpleInput("offsetX", $("#x-offset-input"), 'int', 0);
  initSimpleInput("offsetY", $("#y-offset-input"), 'int', 0);

  // Map size
  initSimpleInput("size", $("#map-size-input"), 'float',
    initialPrintingTech === '3d' ? DEFAULT_PRINT_SIZE_3D : DEFAULT_PRINT_SIZE_2D);

  // Scale
  initSimpleInput("scale", $("#scale-input"), 'int', 2400);

  // Multipart mode
  initMultipartMode(data, osmDragPanInteraction); // in multipart-mode.js

  // Submit map creation
  $("#submit-button").click(window.submitMapCreation); // in map-creation.js

  initDone = true;
}

function setParametersByMapId(id) {
  return loadInfoJson(id).done(function(data, textStatus, jqXHR){

      // Set address as when searching
      setLocalStorage("addresses", JSON.stringify([{
        addrShort: data.addrShort,
        addrLong: data.addrLong,
        lat: data.lat,
        lon: data.lon
      }]));
      setLocalStorage("addressesSelectedIndex", 0);

      // Set area view parameters
      setLocalStorage("offsetX", data.offsetX);
      setLocalStorage("offsetY", data.offsetY);
      setLocalStorage("printing-tech", data.printingTech || "3d");
      setLocalStorage("exclude-buildings", data.excludeBuildings || false);
      setLocalStorage("map-size-preset",
        optionExistsInSelect($("#map-size-preset"), data.size) ? data.size
          : ""); // empty value makes initInputs() use global default
      setLocalStorage("map-scale-preset",
        optionExistsInSelect($("#map-scale-preset"), data.scale) ? data.scale
          : ""); // empty value makes initInputs() use global default
      setLocalStorage("advancedMode", data.advancedMode);
      setLocalStorage("lat", data.lat);
      setLocalStorage("lon", data.lon);
      setLocalStorage("size", data.size);
      setLocalStorage("scale", data.scale);
      setLocalStorage("multipartMode", data.multipartMode);
      setLocalStorage("multipartXpc", data.multipartXpc);
      setLocalStorage("multipartYpc", data.multipartYpc);

      return true;
    });
}

function setParametersFromBlindSquare() {
  setLocalStorage("addresses", JSON.stringify([{
    addrShort: getUrlParam("addrName"),
    addrLong: getUrlParam("addrName"),
    lat: getUrlParam("lat"),
    lon: getUrlParam("lon")
  }]));
  setLocalStorage("addressesSelectedIndex", 0);
  return $.when(); // return a resolved promise
}

// - If URL has param "id", fetch matching map metadata, and store into localStorage, from
//   which UI initialization will read them. Used when arriving from map page or QR code.
// - If URL has param origin=BlindSquare, set address, coordinates and maybe lang from URL params.
function setParametersByUrlQuery() {
  var id = getUrlParam("map");
  if (id) {
    return setParametersByMapId(id);
  } else if (getUrlParam("origin") === 'BlindSquare') {
    return setParametersFromBlindSquare();
  } else {
    return $.when(); // return a resolved promise
  }
}

function initialAddressAndParameters() {
  if (! localStorage.addresses || localStorage.addresses.length === 0) {
    location.href = ".";
  }
  var addrIndex = getLocalStorageInt("addressesSelectedIndex", 0);
  var addresses = JSON.parse(localStorage.addresses);
  var addr = addresses[addrIndex];
  if (! addr) {
    location.href = ".";
  }
  if (addresses.length > 1) {
    $(".show-all-addresses")
      .show()
      .click(function(){
        showAllAddresses(addresses);
      });
  }

  $(".first-address").text(addr.addrLong);
  selectAddress(addr, addrIndex);
  // If we are showing different address than on previous page load, reset some parameters.
  if (getLocalStorageStr('previousAddress', '') !== addr.addrLong) {
    resetParameters(addr);
  }
  setLocalStorage('previousAddress', addr.addrLong);
}

$(window).ready(function(){
  var outputs = {
    currentDiameterMeters: $(".current-diameter-meters"),
    currentDiameterYards: $(".current-diameter-yards"),
    map: $("#map-area-preview")
  };

  setParametersByUrlQuery().done(function(){
    var osmDragPanInteraction = window.initOsmPreview(outputs); // in osm-preview.js
    initInputs(outputs, osmDragPanInteraction);
    initialAddressAndParameters();
    $(".show-on-load").show(); // Don't use CSS for this to make screen readers happier
    data.trigger("initdone");
  });
});
