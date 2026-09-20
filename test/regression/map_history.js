'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = path.resolve(__dirname, '../..');
const values = {};
let failWrites = false;
const restored = [];
const sandbox = {
  console,
  Date,
  Error,
  JSON,
  Object,
  Array,
  String,
  AbortController,
  Event,
  window: {
    dispatchEvent() {},
    setTimeout,
    clearTimeout,
    localStorage: {
      getItem(key) { return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null; },
      setItem(key, value) {
        if (failWrites) throw new Error('quota exceeded');
        values[key] = value;
      }
    }
  },
  makeMapPermaUrl(id) { return 'https://example.test/?map=' + String(id).split('/')[0]; },
  storeMapSettingsFromInfo(info) { restored.push(info); }
};
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(repo, 'web/src/scripts/map-history.js'), 'utf8'), sandbox);
const history = sandbox.window.TMMapHistory;

const firstRequest = {
  requestId: 'B123/example',
  addrShort: 'Central Station',
  addrLong: 'Central Station, Helsinki',
  printingTech: '3d',
  printWidthCm: 17,
  printHeightCm: 20,
  scale: 2400,
  contentMode: 'normal',
  lat: 60.17,
  lon: 24.94,
  coordinatesAdjusted: true,
  browserIp: '192.0.2.1',
  browserFingerprint: 'private-value'
};
assert.strictEqual(history.addAttempt(firstRequest, 'created').ok, true);
assert.strictEqual(history.list().length, 1);
let record = history.find('B123');
assert.strictEqual(record.status, 'in-progress');
assert.strictEqual(record.addressLong, 'Central Station, Helsinki');
assert.strictEqual(record.request.browserIp, undefined);
assert.strictEqual(record.request.browserFingerprint, undefined);
assert.strictEqual(record.request.coordinatesAdjusted, true);

history.update('B123', {status: 'failed', name: 'Commute', note: 'Print for Alex'});
record = history.find('B123/example');
assert.strictEqual(record.name, 'Commute');
assert.strictEqual(record.status, 'failed');
assert.strictEqual(history.displayName(record), 'Commute');

history.addAttempt(firstRequest, 'created');
assert.strictEqual(history.list().length, 1, 'same map ID must not create duplicates');
assert.strictEqual(history.find('B123').name, 'Commute', 'personal metadata must survive refreshes');

history.markReady(Object.assign({}, firstRequest, {addrLong: 'Updated address'}));
record = history.find('B123');
assert.strictEqual(record.status, 'ready');
assert.strictEqual(record.progress, 100);
assert.strictEqual(record.addressLong, 'Updated address');
assert.strictEqual(history.permaUrl(record), 'https://example.test/?map=B123');

assert.strictEqual(history.restoreSettings('B123'), true);
assert.strictEqual(restored.length, 1);
assert.strictEqual(restored[0].printHeightCm, 20);

history.saveShared(Object.assign({}, firstRequest, {requestId: 'B999/shared'}));
assert.strictEqual(history.find('B999').status, 'ready');
assert.strictEqual(history.find('B999').source, 'shared');

const beforeFailedWrite = values[history.storageKey];
failWrites = true;
assert.strictEqual(history.update('B123', {note: 'must not persist'}).ok, false);
assert.strictEqual(values[history.storageKey], beforeFailedWrite, 'failed writes preserve existing history');
failWrites = false;

assert.strictEqual(history.remove('B123').ok, true);
assert.strictEqual(history.find('B123'), null);
assert.strictEqual(history.list().length, 1);
assert.strictEqual(history.clear().ok, true);
assert.strictEqual(history.list().length, 0);

// Unreadable and future-version data must survive all implicit writes.
for (const raw of ['{broken', JSON.stringify({version: 2, maps: [{id: 'future'}]})]) {
  values[history.storageKey] = raw;
  assert.strictEqual(history.readable(), false);
  assert.strictEqual(history.addAttempt(firstRequest).ok, false);
  assert.strictEqual(history.remove('B123').ok, false);
  assert.strictEqual(values[history.storageKey], raw);
}
history.clear();
// Execute the production retry path and inspect the outgoing queue payload.
let queued;
const jq = {prop() { return this; }};
sandbox.$ = () => jq;
sandbox.$.ajax = options => {
  queued = JSON.parse(new URL(options.url).searchParams.get('MessageBody'));
  return {done() { return this; }, fail() { return this; }};
};
sandbox.newMapId = () => 'Bretry';
sandbox.TMMapHistory = history;
sandbox.window.TM_MAP_REQUEST_SQS_QUEUE = 'https://queue.invalid';
vm.runInContext(fs.readFileSync(path.join(repo, 'web/src/scripts/map-creation.js'), 'utf8'), sandbox);
history.addAttempt(Object.assign({}, firstRequest, {filterSourceRequestId: 'Bsource/Map', excludedFeatures: ['way/1']}));
sandbox.window.retrySavedMapCreation(history.find('B123'));
assert.strictEqual(queued.requestId, 'Bretry/example');
assert.strictEqual(queued.filterSourceRequestId, 'Bsource/Map');
assert.deepStrictEqual(queued.excludedFeatures, ['way/1']);
assert.strictEqual(history.find('Bretry').submission, 'unconfirmed');
history.clear();
history.addAttempt(Object.assign({}, firstRequest, {
  filterSourceRequestId: 'Bsource/Original', excludedFeatures: ['way/42']
}));
assert.strictEqual(history.find('B123').request.excludedFeatures[0], 'way/42');
history.markReady(Object.assign({}, firstRequest, {
  contentFilterBaseRequestId: 'Bsource/Original', contentFilterExcludedFeatures: ['way/43']
}));
assert.strictEqual(history.find('B123').request.excludedFeatures[0], 'way/43');
assert.strictEqual(history.find('B123').request.filterSourceRequestId, 'Bsource/Original');

async function checkRefresh() {
  sandbox.window.makeS3InfoUrl = id => '/info/' + id;
  sandbox.window.makeS3url = id => '/files/' + id;
  sandbox.window.makeS3urlSvg = id => '/svg/' + id;
  let fileStatus = 500;
  const requests = [];
  sandbox.fetch = async (url, options) => {
    requests.push([url, options.method]);
    return url.startsWith('/info/')
      ? {ok: true, json: async () => Object.assign({}, firstRequest, {status: {progress: 100}})}
      : {ok: fileStatus === 200, status: fileStatus};
  };
  await assert.rejects(history.refresh('B123'));
  assert(history.find('B123'), 'server failure must preserve history');
  fileStatus = 403;
  await assert.rejects(history.refresh('B123'));
  assert(history.find('B123'), 'permission failure is not proof of expiry');
  fileStatus = 200;
  await history.refresh('B123');
  assert.strictEqual(history.find('B123').status, 'ready');
  fileStatus = 404;
  await history.refresh('B123');
  assert.strictEqual(history.find('B123'), null, 'expired output removes reference');
  assert.deepStrictEqual(requests, Array(4).fill(['/files/B123/example', 'HEAD']),
    'known-ready maps only check output headers, including errors and expiry');
  requests.length = 0;
  fileStatus = 200;
  history.addAttempt(firstRequest);
  await history.refresh('B123');
  assert.deepStrictEqual(requests, [['/info/B123', 'GET'], ['/files/B123/example', 'HEAD']],
    'unfinished maps still fetch metadata and verify newly completed output');
  assert.strictEqual(history.find('B123').status, 'ready');
  requests.length = 0;
  history.update('B123', {status: 'unavailable', request: {printingTech: '2d'}});
  await history.refresh('B123');
  assert.deepStrictEqual(requests, [['/svg/B123/example', 'HEAD']],
    'previously unavailable embossed maps check SVG without metadata');
  assert.strictEqual(history.find('B123').status, 'ready');
  history.remove('B123');
  history.addAttempt(firstRequest);
  sandbox.fetch = async () => ({ok: true, json: async () => ({requestId: firstRequest.requestId, status: {}})});
  await assert.rejects(history.refresh('B123'));
  assert.strictEqual(history.find('B123').status, 'in-progress', 'missing progress is not a completed map');
  sandbox.fetch = async () => ({ok: false, status: 404});
  await assert.rejects(history.refresh('B123'));
  assert.strictEqual(history.find('B123').submission, 'unconfirmed');
  assert(history.find('B123'), 'unfinished attempts have no output yet: do not purge');
  // A concurrent user removal must not be undone by a late response.
  sandbox.fetch = async () => {
    history.remove('B123');
    return {ok: true, json: async () => Object.assign({}, firstRequest, {status: {progress: 100}})};
  };
  await history.refresh('B123');
  assert.strictEqual(history.find('B123'), null);
  assert.strictEqual(history.shouldShowNew(), false, 'no hint for an empty library');
  history.addAttempt(firstRequest);
  assert.strictEqual(history.shouldShowNew(), true, 'a saved attempt enables discovery');
  history.markVisited();
  assert.strictEqual(history.shouldShowNew(), false);
  vm.runInContext(fs.readFileSync(path.join(repo, 'web/src/scripts/map-history.js'), 'utf8'), sandbox);
  const reopened = sandbox.window.TMMapHistory;
  assert.strictEqual(reopened.shouldShowNew(), false, 'visit survives a reload');
  reopened.clear();
  reopened.addAttempt(firstRequest);
  assert.strictEqual(reopened.shouldShowNew(), false, 'clearing and creating maps must not re-arm discovery');
  const english = JSON.parse(fs.readFileSync(path.join(repo, 'web/locales/en/tm.json')));
  for (const locale of ['de', 'es', 'fi', 'nl']) {
    const translations = JSON.parse(fs.readFileSync(path.join(repo, 'web/locales', locale, 'tm.json')));
    for (const key of Object.keys(english).filter(key => key.startsWith('my_maps'))) {
      assert(translations[key], locale + ' must translate ' + key);
    }
  }
  console.log('Map history behavior passed');
}
checkRefresh().catch(error => { console.error(error); process.exitCode = 1; });
