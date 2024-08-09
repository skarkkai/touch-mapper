'use strict';
/* global $ mapCalc Backbone isNan _ ol THREE performance TRANSLATIONS i18next show3dPreview data */
/* eslint quotes:0, space-unary-ops:0, no-alert:0, no-unused-vars:0, no-shadow:0, no-extend-native:0, no-trailing-spaces:0 */

const MAX_ADDRESSES = 5;

const getAddress = (g) => {
  let streetAddr = g.street;
  if (streetAddr && g.housenumber) {
    streetAddr += ' ' + g.housenumber;
  }
  let addrShort = g.name || streetAddr || g.label;
  return [
    addrShort,
    [g.name, streetAddr, g.city, g.state || g.county, g.country].filter(x => x != undefined).join(', ') || g.label,
  ];
}

// Can't use 'load' event because Google API loads asynchronously
$(window).load(function(){

  // Address search
  initSimpleInput("address", $("#address-input"), 'str');
  if (localStorage.searchString && localStorage.searchString.length > 0) {
    $("#address-input").val(localStorage.searchString).change();
  }
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

    function handleSearchResults(response) {
      var results = response.features;
      if (results.length === 0) {
        $("#searching").hide();
        $("#no-search-results").show().focus();
        return;
      }

      const seenLabels = {};
      let addresses = results.map((result) => {
          var g = result.properties.geocoding;
          // There may be effectively duplicates, only show first one of those
          if (seenLabels[g.label]) return null;
          seenLabels[g.label] = true;

          const [addrShort, addrLong] = getAddress(g);
          const coords = result.geometry.coordinates;
          return {
            addrShort: addrShort,
            addrLong: addrLong,
            lat: coords[1],
            lon: coords[0],
          };
        }).filter(x => x != undefined);
      if (addresses.length > MAX_ADDRESSES) {
        addresses = addresses.slice(0, MAX_ADDRESSES);
      }
      localStorage.addresses = JSON.stringify(addresses);
      localStorage.searchString = addr;
      location.href = "area";
    }

    var xhr = new XMLHttpRequest();
    xhr.open("GET", "https://nominatim.openstreetmap.org/search?" + new URLSearchParams({
      q: addr,
      addressdetails: 1,
      format: 'geocodejson',
      limit: MAX_ADDRESSES*3, // *3 to have room for duplicate removal
    }).toString(), true);
    xhr.onload = (e) => {
      if (xhr.readyState === 4) {
        if (xhr.status === 200) {
          handleSearchResults(JSON.parse(xhr.responseText));
        } else {
          alert("search failed: " + xhr.statusText);
          prevAddr = undefined;
        }
      }
    };
    xhr.onerror = (e) => {
      alert("search failed: " + xhr.statusText);
      prevAddr = undefined;
    };
    xhr.send(null);
  });

  data.trigger("init");
  $(".show-on-load").show(); // Don't use CSS for this to make screen readers happier
});
