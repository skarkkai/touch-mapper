/* global $, newMapId, makeS3InfoUrl, makeMapPageUrlRelative, makeCloudFrontMapContentUrl, insertMapDescription */
/* eslint quotes:0, consistent-return:0 */
(function(){
  'use strict';

  function translation(key, fallback) {
    return window.TM && window.TM.translations && window.TM.translations[key] || fallback;
  }

  function refsForRow(row) {
    try {
      return JSON.parse(row.attr('data-filter-refs') || '[]');
    } catch (_error) {
      return [];
    }
  }

  function rowCheckBoxes(section) {
    return section.find('li[data-filter-refs] > .map-content-filter-item');
  }

  function updateSection(section) {
    var rows = rowCheckBoxes(section);
    var control = section.children('.map-content-filter-section');
    var included = rows.filter(':checked').length;
    control.prop('checked', included === rows.length);
    control.prop('indeterminate', included > 0 && included < rows.length);
  }

  function sameRefs(left, right) {
    return JSON.stringify(left.slice().sort()) === JSON.stringify(right.slice().sort());
  }

  function updateApplyButton(appliedExcluded) {
    $('#apply-map-content-filter').prop('disabled',
      sameRefs(excludedFeatures(), appliedExcluded));
  }

  function makeCheckBoxes(appliedExcluded) {
    var full = $('#map-content-full');
    full.children('.row').each(function(){
      var section = $(this);
      var items = section.find('li[data-filter-refs]');
      if (!items.length) return;
      var heading = section.children('h4');
      var sectionLabel = heading.text().trim();
      var sectionControl = $('<input type="checkbox" checked>')
        .addClass('map-content-filter-section')
        .attr('aria-label', translation('filter_content_include', 'Include') + ' ' + sectionLabel);
      heading.before(sectionControl);
      items.each(function(){
        var item = $(this);
        var title = item.children('h5').first().text().trim();
        var included = refsForRow(item).every(function(ref){
          return appliedExcluded.indexOf(ref) < 0;
        });
        var control = $('<input type="checkbox">')
          .addClass('map-content-filter-item')
          .prop('checked', included)
          .attr('aria-label', translation('filter_content_include', 'Include') + ' ' + title);
        item.prepend(control);
      });
      sectionControl.on('change', function(){
        rowCheckBoxes(section).prop('checked', this.checked);
        updateSection(section);
        updateApplyButton(appliedExcluded);
      });
      rowCheckBoxes(section).on('change', function(){
        updateSection(section);
        updateApplyButton(appliedExcluded);
      });
      updateSection(section);
    });
    updateApplyButton(appliedExcluded);
  }

  function excludedFeatures() {
    var refs = {};
    $('.map-content-filter-item:not(:checked)').each(function(){
      refsForRow($(this).parent()).forEach(function(ref){ refs[ref] = true; });
    });
    return Object.keys(refs);
  }

  function requestBody(info, excluded) {
    var fields = [
      'addrShort', 'addrLong', 'printingTech', 'offsetX', 'offsetY', 'size',
      'contentMode', 'hideLocationMarker', 'lon', 'lat', 'effectiveArea',
      'scale', 'diameter', 'multipartMode', 'noBorders', 'multipartXpc',
      'multipartYpc', 'advancedMode', 'browserFingerprint', 'marker1',
      'targetRoadDensity'
    ];
    var request = {};
    fields.forEach(function(field){
      if (info[field] !== undefined) request[field] = info[field];
    });
    request.requestId = newMapId() + '/' + String(info.addrShort || 'map').replace(/[\x00-\x1F\x80-\x9F/]/g, '_');
    request.filterSourceRequestId = info.contentFilterBaseRequestId || info.requestId;
    request.excludedFeatures = excluded;
    return request;
  }

  function initMapContentFilter(info) {
    if (!info || !info.contentFilterAvailable) return;
    var container = $('.map-content');
    var open = $('#filter-map-content');
    var apply = $('#apply-map-content-filter');
    var error = $('.map-content-filter-error');
    var busy = false;
    var loading = false;
    var restoring = false;
    var autoOpen = !!info.contentFilterBaseRequestId;
    var appliedExcluded = Array.isArray(info.contentFilterExcludedFeatures)
      ? info.contentFilterExcludedFeatures : [];

    function showError() {
      error.text(translation('filter_content_error', 'Could not update the map. Your selections are still here.'))
        .removeAttr('hidden');
      apply.text(translation('filter_content_apply', 'Apply filter'));
      updateApplyButton(appliedExcluded);
      $('#cancel-map-content-filter').prop('disabled', false);
      $('.map-content-filter-section, .map-content-filter-item').prop('disabled', false);
      busy = false;
    }

    function poll(requestId, started) {
      if (Date.now() - started > 600000) return showError();
      $.ajax({ url: makeS3InfoUrl(requestId), cache: false }).done(function(payload){
        if (typeof payload === 'string') {
          try { payload = JSON.parse(payload); } catch (_error) { payload = {}; }
        }
        var status = payload && payload.status;
        if (status && status.errorCode) return showError();
        if (status && Number(status.progress) >= 100) {
          window.location.href = makeMapPageUrlRelative(requestId);
          return;
        }
        setTimeout(function(){ poll(requestId, started); }, 1000);
      }).fail(function(jqXHR){
        if (jqXHR.status === 404) {
          setTimeout(function(){ poll(requestId, started); }, 1000);
        } else {
          showError();
        }
      });
    }

    container.on('map-content-ready', function(){
      if (restoring) return;
      open.removeAttr('hidden');
      if (autoOpen) {
        autoOpen = false;
        open.trigger('click');
      }
    });

    open.on('click', function(){
      if (loading) return;
      loading = true;
      $.ajax({
        url: makeCloudFrontMapContentUrl(info.contentFilterBaseRequestId || info.requestId),
        cache: true
      }).done(function(payload){
        if (typeof payload === 'string') {
          try { payload = JSON.parse(payload); } catch (_error) { payload = {}; }
        }
        window.TM.mapDescription.renderFilterCatalog(payload, container);
        if (!$('#map-content-full li[data-filter-refs]').length) return;
        makeCheckBoxes(appliedExcluded);
        open.attr('hidden', 'hidden');
        $('.map-content-row').addClass('filtering');
        $('.map-content-filter-controls, .map-content-filter-actions').removeAttr('hidden');
      }).fail(function(){
        error.text(translation('filter_content_error', 'Could not update the map. Your selections are still here.'))
          .removeAttr('hidden');
        $('.map-content-filter-controls').removeAttr('hidden');
      }).always(function(){ loading = false; });
    });

    $('#cancel-map-content-filter').on('click', function(){
      if (busy) return;
      $('.map-content-filter-section, .map-content-filter-item').remove();
      $('.map-content-row').removeClass('filtering');
      $('.map-content-filter-controls, .map-content-filter-actions').attr('hidden', 'hidden');
      error.attr('hidden', 'hidden').empty();
      restoring = true;
      open.attr('hidden', 'hidden');
      var refresh = insertMapDescription(info, container);
      if (refresh) refresh.always(function(){
        restoring = false;
        open.removeAttr('hidden').trigger('focus');
      });
    });

    apply.on('click', function(){
      if (busy) return;
      var excluded = excludedFeatures();
      if (sameRefs(excluded, appliedExcluded)) return;
      busy = true;
      error.attr('hidden', 'hidden').empty();
      apply.prop('disabled', true).text(translation('filter_content_progress', 'Updating map…'));
      $('#cancel-map-content-filter').prop('disabled', true);
      $('.map-content-filter-section, .map-content-filter-item').prop('disabled', true);
      var request = requestBody(info, excluded);
      $.ajax({
        type: 'GET',
        url: window.TM_MAP_REQUEST_SQS_QUEUE + '?Action=SendMessage&MessageBody=' +
          encodeURIComponent(JSON.stringify(request)) + '&Version=2012-11-05'
      }).done(function(){
        poll(request.requestId, Date.now());
      }).fail(showError);
    });
  }

  window.initMapContentFilter = initMapContentFilter;
})();
