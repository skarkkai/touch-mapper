'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const names = require('../../converter/road-names');
const cases = require('./road_names.json');
const repo = path.resolve(__dirname, '../..');
for (const test of cases) {
  assert.strictEqual(names.resolve(test.tags), test.name);
  if (test.locale) assert.strictEqual(names.resolve(test.tags, test.locale), test.localized);
}
const sandbox = {window: {TM: {}, location: {pathname: '/fi/map'}}, console, setTimeout, clearTimeout};
vm.createContext(sandbox);
for (const file of ['converter/road-names.js', 'web/src/scripts/map-desc-ways.js',
  'web/src/scripts/map-desc-areas.js', 'web/src/scripts/map-desc-pois.js', 'web/src/scripts/map-description.js']) {
  vm.runInContext(fs.readFileSync(path.join(repo, file), 'utf8'), sandbox, {filename: file});
}
const payload = JSON.parse(fs.readFileSync(path.join(process.argv[2], 'naming-map-content.json')));
sandbox.window.TM.mapDescription.buildModel(payload, {t: (key, fallback) => fallback || key}, {});
for (const group of payload.A.subclasses[0].groups) {
  for (const way of group.ways) {
    assert.strictEqual(way.label, names.resolve(way.nameTags, 'fi'));
    assert.strictEqual(way.isNamed, !!names.resolve(way.nameTags));
  }
}
const mixed = payload.A.subclasses[0].groups.find(group => group.label === 'Main');
assert(mixed, 'Mixed translations must retain the default group name');
assert.strictEqual(mixed.ways.find(way => way.nameTags['name:fi']).label, 'Katu');
const literal = payload.A.subclasses[0].groups.find(group => group.label === '(unnamed)');
assert.strictEqual(literal.isNamed, true);
const rendered = sandbox.window.TM.mapDescWays.buildModel(payload, {t: (key, fallback) => fallback || key});
assert(JSON.stringify(rendered).includes('(unnamed)'));
console.log('Shared naming and browser description passed');
