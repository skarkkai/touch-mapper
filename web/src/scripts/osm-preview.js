'use strict';
/* global $ mapCalc Backbone isNan _ ol THREE performance google ga fbq TRANSLATIONS i18next readCookie createCookie data mapDimensionsMeters */
/* eslint quotes:0, space-unary-ops:0, no-alert:0, no-unused-vars:0, no-shadow:0, no-extend-native:0, no-trailing-spaces:0 */

window.initOsmPreview = function(outputs) {
  var previewMapMarker1 = new ol.Overlay({
    element: $("#marker1-overlay")[0]
  });
  var osmDragPanInteraction = new ol.interaction.DragPan();
  var previewMap = new ol.Map({
    target: outputs.map[0],
    interactions: new ol.Collection([
      osmDragPanInteraction
    ]),
    controls: new ol.Collection([
      new ol.control.ScaleLine()
    ]),
    layers: [
      new ol.layer.Tile({
        source: new ol.source.OSM({
        })
      })
    ],
    view: new ol.View({
    }),
    overlays: new ol.Collection([
      previewMapMarker1
    ])
  });

  // Fit the selected footprint inside a bounded viewport with one common scale.
  function updatePreview() {
    const dimensions = mapDimensionsMeters();
    if (![dimensions.width, dimensions.height].every(value => Number.isFinite(value) && value > 0)) return;
    if (!Number.isFinite(Number(data.get('lat'))) || !Number.isFinite(Number(data.get('lon')))) return;
    const container = $('#map-area-preview-container').show();
    const availableWidth = container.width();
    if (!availableWidth) return;
    const ratio = dimensions.width / dimensions.height;
    const width = Math.min(availableWidth, 500 * ratio);
    outputs.map.css({width: width + 'px', height: width / ratio + 'px'});
    previewMap.updateSize();
    const view = previewMap.getView();
    const newCenter = ol.proj.fromLonLat(computeLonLat(data));
    const metersPerPixel = dimensions.width / width;
    const resolutionAtCoords = metersPerPixel / view.getProjection().getPointResolution(1, newCenter);
    view.setResolution(resolutionAtCoords);
    view.setCenter(newCenter);
    previewMapMarker1.setPosition(ol.proj.fromLonLat([data.get('lon'), data.get('lat')]));
    outputs.currentCoverageMeters.text(dimensions.width.toFixed(0) + ' × ' + dimensions.height.toFixed(0));
    outputs.currentCoverageYards.text((dimensions.width * 1.0936133).toFixed(0) + ' × ' + (dimensions.height * 1.0936133).toFixed(0));
  }

  data.on('change:lon change:lat change:printWidthCm change:printHeightCm change:offsetX change:offsetY change:scale change:multipartXpc change:multipartYpc', updatePreview);

  // Map panning
  previewMap.on("moveend", function(ev){
    if (data.get("multipartMode")) {
        return;
    }

    var metersPerDeg = mapCalc.metersPerDegree(data.get("lat"));
    var newCenter = ol.proj.toLonLat(previewMap.getView().getCenter());
    var offsetX = Math.round((newCenter[0] - data.get("lon")) * metersPerDeg.lon);
    var offsetY = Math.round((newCenter[1] - data.get("lat")) * metersPerDeg.lat);
    var dimensions = mapDimensionsMeters();
    var maxOffsetX = dimensions.width / 2 * 0.9;
    var maxOffsetY = dimensions.height / 2 * 0.9;
    var fixPreview = false;
    if (Math.abs(offsetX) > maxOffsetX) {
      fixPreview = true;
      offsetX = Math.sign(offsetX) * Math.floor(maxOffsetX);
    }
    if (Math.abs(offsetY) > maxOffsetY) {
      fixPreview = true;
      offsetY = Math.sign(offsetY) * Math.floor(maxOffsetY);
    }
    $("#x-offset-input").val(offsetX);
    $("#y-offset-input").val(offsetY);
    data.set("offsetX", offsetX, { silent: true });
    data.set("offsetY", offsetY, { silent: true });
    setLocalStorage("offsetX", offsetX);
    setLocalStorage("offsetY", offsetY);
    if (fixPreview) {
      updatePreview();
    }
  });

  // Show preview when user arrives via back button or browser wake-up.
  $(window).on('pageshow resize', function(){
    updatePreview();
  });
  data.on("initdone", function(){
    updatePreview();
  });

  return osmDragPanInteraction;
};
