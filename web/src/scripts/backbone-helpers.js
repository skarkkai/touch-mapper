'use strict';
/* global $ mapCalc Backbone isNan _ ol THREE performance google ga fbq TRANSLATIONS i18next readCookie createCookie data */
/* eslint quotes:0, space-unary-ops:0, no-alert:0, no-unused-vars:0, no-shadow:0, no-extend-native:0, no-trailing-spaces:0 */

$(function(){
  window.data = new Backbone.Model();

  window.setData = function(name, value) {
    data.set(name, value);
    setLocalStorage(name, value);
  };

  window.initSimpleInput = function(name, elem, type, defaultValue) {
    elem.change(function(ev) {
      if ($(ev.target).is(':invalid')) {
        return false;
      }
      var value;
      switch (type) {
        case 'float':
          value = parseFloat($(ev.target).val());
          if (! isNaN(value)) {
            setData(name, value);
          }
          break;
        case 'int':
          value = parseInt($(ev.target).val(), 10);
          if (! isNaN(value)) {
            setData(name, value);
          }
          break;
        case 'str':
          setData(name, $(ev.target).val().trim());
          break;
        case 'checkbox':
          setData(name, $(ev.target).is(':checked')); // converts to strings 'true' / 'false'
          break;
        default:
          throw new Error("unknown type: " + type);
      }
      return false;
    });
    if (type === 'checkbox') {
      var booleanValue = getLocalStorageStr(name, defaultValue) === 'true';
      if (booleanValue) {
        elem.click();
      }
    } else {
      elem.val(getLocalStorageStr(name, defaultValue));
      elem.change();
    }
  };
});
