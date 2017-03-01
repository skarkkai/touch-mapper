'use strict';
/* global $ mapCalc Backbone isNan _ ol THREE performance google ga fbq TRANSLATIONS i18next show3dPreview data */
/* eslint quotes:0, space-unary-ops:0, no-alert:0, no-unused-vars:0, no-shadow:0, no-extend-native:0, no-trailing-spaces:0 */

// Can't use 'load' event because Google API loads asynchronously
$(window).load(function(){

  // Address search
  initSimpleInput("address", $("#address-input"), 'str');
  if (localStorage.searchString && localStorage.searchString.length > 0) {
    $("#address-input").val(localStorage.searchString).change();
  }
  var map = new google.maps.Map(document.getElementById('dummy-google-map'));
  var placesServices = new google.maps.places.PlacesService(map);
  var prevAddr;
  $("#address-search-form").submit(function(ev){
    ev.preventDefault();

    // Avoid duplicate searches
    var addr = data.get("address").trim();
    if (addr === prevAddr || addr === '') {
      return;
    }
    prevAddr = addr;

    //$("#searching").slideDown();
    $("#no-search-results").hide();
    placesServices.textSearch({
      query: addr
    }, function callback(results, status){
      if (status !== google.maps.places.PlacesServiceStatus.OK && status !== google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
        alert("search failed: " + status);
        prevAddr = undefined;
        return;
      }

      if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS || results.length === 0) {
        $("#searching").hide();
        $("#no-search-results").show().focus();
        return;
      }

      if (results.length > 5) {
        results = results.slice(0, 5);
      }

      localStorage.addresses = JSON.stringify(_.map(results, function(result){
        var addrShort = result.formatted_address.substr(0, result.formatted_address.indexOf(','))
            || result.formatted_address;

        var addrLong = result.formatted_address;
        if (result.name && ! (addrLong.toLowerCase().startsWith(result.name.toLowerCase()))) {
          addrLong += " (" + result.name + ")";
        }

        var location = result.geometry.location;

        return {
          addrShort: addrShort,
          addrLong: addrLong,
          lat: location.lat(),
          lon: location.lng(),
        };
      }));
      localStorage.searchString = addr;
      location.href = "area";
    });
  });

  data.trigger("init");
  $(".show-on-load").show(); // Don't use CSS for this to make screen readers happier
});
