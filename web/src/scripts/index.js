'use strict';
/* global $ mapCalc Backbone isNan _ ol THREE performance TRANSLATIONS i18next show3dPreview data */
/* eslint quotes:0, space-unary-ops:0, no-alert:0, no-unused-vars:0, no-shadow:0, no-extend-native:0, no-trailing-spaces:0 */

const MAX_ADDRESSES = 5;
const SEARCH_MAX_ATTEMPTS = 2;
const SEARCH_RETRY_DELAY_MS = 500;
const SEARCH_TIMEOUT_MS = 8000;

const getAddress = (g) => {
  let streetAddr = g.street;
  if (streetAddr && g.housenumber) {
    streetAddr += ' ' + g.housenumber;
  }
  let addrShort = g.name || streetAddr || g.label;
  return [
    addrShort,
    [g.name, streetAddr, g.city, g.state || g.county, g.country].filter((x) => x != undefined).join(', ')
      || g.label,
  ];
};

// Wait for window load so the DOM is fully ready.
$(window).load(function(){

  // Address search
  initSimpleInput("address", $("#address-input"), 'str');
  if (localStorage.searchString && localStorage.searchString.length > 0) {
    $("#address-input").val(localStorage.searchString).change();
  }
  var prevAddr;
  var currentSearchRequestId = 0;
  var activeSearchXhr = null;
  $("#address-search-form").submit(function(ev){
    ev.preventDefault();

    // Avoid duplicate searches
    var addr = data.get("address").trim();
    if (addr === prevAddr || addr === '') {
      return;
    }
    prevAddr = addr;

    $("#searching").show();
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

        const addr = getAddress(g);
        const coords = result.geometry.coordinates;
        return {
          addrShort: addr[0],
          addrLong: addr[1],
          lat: coords[1],
          lon: coords[0],
        };
      }).filter((x) => x != undefined);
      if (addresses.length > MAX_ADDRESSES) {
        addresses = addresses.slice(0, MAX_ADDRESSES);
      }
      localStorage.addresses = JSON.stringify(addresses);
      localStorage.searchString = addr;
      location.href = "area";
    }

    const requestId = ++currentSearchRequestId;

    function isCurrentRequest() {
      return requestId === currentSearchRequestId;
    }

    function failSearch(statusText, statusCode, attemptNumber) {
      if (!isCurrentRequest()) {
        return;
      }
      if (attemptNumber < SEARCH_MAX_ATTEMPTS) {
        setTimeout(function() {
          sendSearchRequest(attemptNumber + 1);
        }, SEARCH_RETRY_DELAY_MS);
        return;
      }

      activeSearchXhr = null;
      $("#searching").hide();
      alert("search failed: " + (statusText || ("HTTP " + statusCode)));
      prevAddr = undefined;
    }

    function sendSearchRequest(attemptNumber) {
      if (!isCurrentRequest()) {
        return;
      }

      if (activeSearchXhr) {
        activeSearchXhr.abort();
      }

      var xhr = new XMLHttpRequest();
      activeSearchXhr = xhr;
      xhr.open("GET", "https://nominatim.openstreetmap.org/search?" + new URLSearchParams({
        q: addr,
        addressdetails: 1,
        format: 'geocodejson',
        limit: MAX_ADDRESSES * 3, // *3 to have room for duplicate removal
        email: 'sofia.pahaoja@gmail.com',
      }).toString(), true);
      xhr.timeout = SEARCH_TIMEOUT_MS;
      xhr.onload = () => {
        if (!isCurrentRequest() || xhr !== activeSearchXhr || xhr.readyState !== 4) {
          return;
        }
        if (xhr.status === 200) {
          try {
            activeSearchXhr = null;
            $("#searching").hide();
            handleSearchResults(JSON.parse(xhr.responseText));
          } catch (e) {
            failSearch("invalid response", xhr.status, attemptNumber);
          }
        } else {
          failSearch(xhr.statusText, xhr.status, attemptNumber);
        }
      };
      xhr.onerror = () => {
        if (xhr !== activeSearchXhr) {
          return;
        }
        failSearch(xhr.statusText, xhr.status, attemptNumber);
      };
      xhr.ontimeout = () => {
        if (xhr !== activeSearchXhr) {
          return;
        }
        failSearch("timeout", xhr.status, attemptNumber);
      };
      xhr.send(null);
    }

    sendSearchRequest(1);
  });

  data.trigger("init");
  $(".show-on-load").show(); // Don't use CSS for this to make screen readers happier
});
