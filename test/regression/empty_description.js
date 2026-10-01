'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

// Keep DOM mechanics small while exercising the production section visibility rules.
function container() {
  const nodes = new Map();
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      length: 1, visible: true, value: '',
      find: child => node(selector + ' ' + child),
      closest: row => node(row),
      text(value) { this.value = value; return this; },
      empty() { this.value = ''; return this; },
      remove() { return this; },
      hide() { this.visible = false; return this; },
      show() { this.visible = true; return this; },
      toggle(visible) { this.visible = visible; return this; }
    });
    return nodes.get(selector);
  }
  return {length: 1, find: node};
}

for (const locale of ['en', 'fi', 'de', 'es', 'nl']) {
  const context = {window: {TM: {}, location: {pathname: '/' + locale + '/map'}}};
  vm.createContext(context);
  for (const file of ['converter/road-names.js', 'web/src/scripts/map-desc-ways.js',
    'web/src/scripts/map-desc-areas.js', 'web/src/scripts/map-desc-pois.js', 'web/src/scripts/map-description.js']) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  }
  const translations = JSON.parse(fs.readFileSync('web/locales/' + locale + '/tm.json'));
  const helpers = {t: (key, fallback) => translations[key] || fallback};
  const api = context.window.TM.mapDescription;
  const empty = api.buildModel({metadata: {printHeightsMm: {roads: 0, paths: 0, buildings: 0, railways: .81}}}, helpers);
  assert.strictEqual(empty.ui.emptyMessage, translations.map_content_empty);
  assert.strictEqual(empty.ui.hasFullContentRows, false);
  const view = container();
  const counts = api.renderFromModel(empty, view);
  assert(Object.values(counts).every(count => count === 0));
  for (const section of ['roads', 'paths', 'railways', 'waterways', 'water-areas',
    'other-linear', 'buildings', 'poi-familiar', 'poi-daily', 'poi-transport']) {
    assert.strictEqual(view.find('.map-content-' + section + '-row').visible, false, section);
  }
  assert.strictEqual(view.find('.map-content-notice').visible, true);
  assert.strictEqual(view.find('.map-content-notice').value, translations.map_content_empty);

  // A populated section removes the empty-map notice and leaves other categories hidden.
  const populated = api.buildModel({A: {subclasses: [{key: 'A1_local_streets', kind: 'linear', groups: [{
    label: 'Main Street', isNamed: true, totalLength: 100,
    ways: [{osmType: 'way', osmId: 1, label: 'Main Street', isNamed: true}],
    visibleGeometry: [{osmId: 1, segments: [{events: []}]}]
  }]}]}}, helpers);
  assert.strictEqual(populated.roads.count, 1);
  assert.strictEqual(populated.ui.emptyMessage, null);
  assert.strictEqual(populated.ui.hasFullContentRows, true);
  // Renderers already have their own DOM tests; this test checks the containing rows.
  context.window.TM.mapDescWays.renderFromModel = items => items.length;
  assert.strictEqual(api.renderFromModel(populated, view).roads, 1);
  assert.strictEqual(view.find('.map-content-roads-row').visible, true);
  assert.strictEqual(view.find('.map-content-buildings-row').visible, false);
  assert.strictEqual(view.find('.map-content-paths-row').visible, false);
  assert.strictEqual(view.find('.map-content-notice').visible, false);
}
console.log('Empty categories hidden consistently; localized empty-map notice and populated rows passed');
