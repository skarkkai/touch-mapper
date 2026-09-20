'use strict';
/* global $ mapCalc Backbone isNan _ ol THREE performance google ga fbq TRANSLATIONS i18next readCookie createCookie */
/* eslint quotes:0, space-unary-ops:0, no-alert:0, no-unused-vars:0, no-shadow:0, no-extend-native:0, no-trailing-spaces:0 */

$(function(){
  // Change URL to one with given language
  function changeLang(newLang) {
    var newHref = location.href.replace(/\/[a-z][a-z]\b(\/.*)/, '/' + newLang + '$1');
    location.href = newHref;
  }

  // Set current lang
  var match = window.location.pathname.match(/([a-z][a-z])\b.*/);
  if (match) {
    $(".language-selector").val(match[1]);
    document.documentElement.lang = match[1];
  }
  $('.page-maps .my-maps-link, .page-help .help-link').attr('aria-current', 'page');

  // Refresh the discovery hint after local saves, visits in another tab, or Back.
  function updateMapsHint() {
    const show = window.TMMapHistory.shouldShowNew();
    $('.my-maps-new').prop('hidden', !show);
    document.documentElement.classList.toggle('has-my-maps-hint', show);
  }
  if (document.documentElement.classList.contains('page-maps')) window.TMMapHistory.markVisited();
  updateMapsHint();
  window.addEventListener('tm-map-history-changed', updateMapsHint);
  window.addEventListener('storage', updateMapsHint);
  window.addEventListener('pageshow', updateMapsHint);

  // Change language callback
  $(".language-selector").change(function(){
    changeLang($(this).val());
  });

  // Get current lang from URL
  var requestedLang = getUrlParam('lang');
  var langSelected = $(".language-selector");
  if (requestedLang && langSelected.val() !== requestedLang) {
    // URL has "lang" param; make sure its value is among supported languages
    langSelected.find("option").each(function(index, option) {
      if ($(option).val() === requestedLang) {
        changeLang(requestedLang);
      }
    });
  }
});
