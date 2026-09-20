'use strict';
/* global makeMapPermaUrl, storeMapSettingsFromInfo */
/* eslint quotes:0, consistent-return:0 */

(function(){
  const STORAGE_KEY = 'tm-map-history-v1';
  const VISITED_KEY = 'tm-my-maps-visited';
  let visitedThisPage = false;
  const VERSION = 1;
  const REQUEST_FIELDS = [
    'addrShort', 'addrLong', 'printingTech', 'offsetX', 'offsetY',
    'printWidthCm', 'printHeightCm', 'size', 'contentMode', 'targetRoadDensity',
    'hideLocationMarker', 'lon', 'lat', 'effectiveArea', 'scale',
    'multipartMode', 'noBorders', 'multipartXpc', 'multipartYpc',
    'advancedMode', 'marker1', 'filterSourceRequestId', 'excludedFeatures', 'coordinatesAdjusted'
  ];

  function mapId(requestId) {
    return String(requestId || '').split('/', 1)[0];
  }

  // Retain only values needed to identify or recreate a map.
  function safeRequest(source) {
    const request = {};
    REQUEST_FIELDS.forEach(function(field){
      if (source && source[field] !== undefined) request[field] = source[field];
    });
    if (source && source.contentFilterBaseRequestId) request.filterSourceRequestId = source.contentFilterBaseRequestId;
    if (source && source.contentFilterExcludedFeatures) request.excludedFeatures = source.contentFilterExcludedFeatures;
    return request;
  }

  // Keep unreadable history intact: a later write must never silently replace it.
  function readDocument() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw === null) return {version: VERSION, maps: []};
      const value = JSON.parse(raw);
      if (value && value.version === VERSION && Array.isArray(value.maps) &&
          value.maps.every(function(record){ return record && typeof record.id === 'string'; })) return value;
      throw new Error('Unsupported history document');
    } catch (error) {
      return {version: VERSION, maps: [], error: error};
    }
  }

  // Write the complete document atomically so a failed write preserves old history.
  function writeDocument(documentValue) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(documentValue));
      window.dispatchEvent(new Event('tm-map-history-changed'));
      return {ok: true};
    } catch (error) {
      return {ok: false, error: error};
    }
  }

  function list() {
    return readDocument().maps.slice();
  }

  function find(id) {
    return list().find(function(record){ return record.id === mapId(id); }) || null;
  }

  // Replace or insert one record without changing the order of older records.
  function saveRecord(record) {
    const documentValue = readDocument();
    if (documentValue.error) return {ok: false, error: documentValue.error};
    const index = documentValue.maps.findIndex(function(item){ return item.id === record.id; });
    if (index === -1) documentValue.maps.push(record);
    else documentValue.maps[index] = record;
    return writeDocument(documentValue);
  }

  // Create a history entry as soon as a map attempt has an ID.
  function addAttempt(request, source) {
    const id = mapId(request && request.requestId);
    if (!id) return {ok: false, error: new Error('Map request ID is required')};
    const existing = find(id);
    const now = new Date().toISOString();
    const record = Object.assign({
      id: id,
      requestId: request.requestId,
      addressShort: request.addrShort || request.addrLong || '',
      addressLong: request.addrLong || request.addrShort || '',
      createdAt: now,
      updatedAt: now,
      status: 'in-progress',
      progress: 0,
      submission: 'unconfirmed',
      name: '',
      note: '',
      favorite: false,
      source: source || 'created',
      request: safeRequest(request)
    }, existing || {});
    record.requestId = request.requestId;
    record.updatedAt = now;
    record.request = Object.assign({}, record.request, safeRequest(request));
    return Object.assign({record: record}, saveRecord(record));
  }

  // Apply a partial status or metadata change while preserving immutable identity.
  function update(id, changes) {
    const record = find(id);
    if (!record) return {ok: false, missing: true};
    const next = Object.assign({}, record, changes, {
      id: record.id,
      createdAt: record.createdAt,
      updatedAt: new Date().toISOString()
    });
    if (changes && changes.request) {
      next.request = Object.assign({}, record.request, safeRequest(changes.request));
    }
    return Object.assign({record: next}, saveRecord(next));
  }

  // Mark an existing record ready from authoritative result metadata.
  function markReady(info) {
    const id = mapId(info && info.requestId);
    const record = find(id);
    if (!record) return {ok: false, missing: true};
    return update(id, {
      requestId: info.requestId,
      addressShort: info.addrShort || info.addrLong || record.addressShort,
      addressLong: info.addrLong || info.addrShort || record.addressLong,
      status: 'ready',
      progress: 100,
      errorCode: null,
      errorDescription: null,
      request: info
    });
  }

  // Explicitly save a map opened through a shared link.
  function saveShared(info) {
    const result = addAttempt(info, 'shared');
    if (!result.ok) return result;
    return markReady(info);
  }

  function remove(id) {
    const documentValue = readDocument();
    if (documentValue.error) return {ok: false, error: documentValue.error};
    documentValue.maps = documentValue.maps.filter(function(record){ return record.id !== mapId(id); });
    return writeDocument(documentValue);
  }

  function clear() {
    return writeDocument({version: VERSION, maps: []});
  }

  function displayName(record) {
    return (record && (record.name || record.addressShort || record.addressLong)) || '';
  }

  // Discovery belongs to this browser, not to individual maps or locales.
  function shouldShowNew() {
    if (visitedThisPage) return false;
    try {
      return window.localStorage.getItem(VISITED_KEY) !== '1' && list().length > 0;
    } catch (_error) { return false; }
  }

  // Keep the visit marker separate so clearing maps never re-arms the hint.
  function markVisited() {
    visitedThisPage = true;
    try { window.localStorage.setItem(VISITED_KEY, '1'); } catch (_error) {
      // A discovery hint must not block the library when storage is unavailable.
    }
    window.dispatchEvent(new Event('tm-map-history-changed'));
  }

  // Missing output is definitive only for a completed map. Never infer deletion
  // from a network/permission error or from an attempt that has not produced files.
  async function refresh(id) {
    const record = find(id);
    if (!record) return;
    const knownComplete = record.status === 'ready' || record.status === 'unavailable';
    let info;
    // Completed maps already have their identity and settings locally. Only
    // their output availability can change, so avoid fetching metadata again.
    if (!knownComplete) {
      const response = await fetchStatus(window.makeS3InfoUrl(record.id));
      if (response.ok) info = await response.json();
      else if (response.status !== 404) throw new Error('Status unavailable');
    }
    if (!find(id)) return;
    if (info && info.status && info.status.errorCode) {
      return update(id, {status: 'failed', errorCode: info.status.errorCode});
    }
    const progress = info && info.status && Number(info.status.progress);
    const complete = Number.isFinite(progress) && progress >= 100;
    if (complete || knownComplete) {
      const requestId = info && info.requestId || record.requestId;
      const printingTech = info && info.printingTech || (record.request || {}).printingTech;
      const url = printingTech === '2d' ? window.makeS3urlSvg(requestId) : window.makeS3url(requestId);
      const file = await fetchStatus(url, 'HEAD');
      if (!find(id)) return;
      if (file.status === 404) return remove(id);
      if (!file.ok) throw new Error('Files unavailable');
      if (complete) return markReady(Object.assign({}, info, {requestId: requestId}));
      return update(id, {status: 'ready'});
    }
    if (Number.isFinite(progress)) return update(id, {status: 'in-progress', progress: progress, submission: 'accepted'});
    // An absent status file can mean the tab closed before submission. Keep the
    // original choices and expose an explicit retry rather than claiming progress.
    throw new Error('Status not yet available');
  }

  // Bound network waits so one unreachable host cannot block the refresh queue.
  async function fetchStatus(url, method) {
    const controller = new AbortController();
    const timeout = window.setTimeout(function(){ controller.abort(); }, 10000);
    try {
      return await fetch(url, {method: method || 'GET', cache: 'no-store', signal: controller.signal});
    } finally { window.clearTimeout(timeout); }
  }

  // Restore the creation form from a saved record before navigating to settings.
  function restoreSettings(id) {
    const record = find(id);
    if (!record) return false;
    const values = Object.assign({}, record.request, {
      addrShort: record.addressShort,
      addrLong: record.addressLong,
      requestId: record.requestId
    });
    storeMapSettingsFromInfo(values);
    return true;
  }

  window.TMMapHistory = {
    storageKey: STORAGE_KEY,
    shouldShowNew: shouldShowNew,
    markVisited: markVisited,
    readable: function(){ return !readDocument().error; },
    refresh: refresh,
    mapId: mapId,
    list: list,
    find: find,
    addAttempt: addAttempt,
    update: update,
    markReady: markReady,
    saveShared: saveShared,
    remove: remove,
    clear: clear,
    displayName: displayName,
    restoreSettings: restoreSettings,
    permaUrl: function(record){ return makeMapPermaUrl(record.requestId || record.id); }
  };
})();
