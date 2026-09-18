'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repo = path.resolve(__dirname, '../..');
const sandbox = {window: {TM: {}, location: {pathname: '/en/map'}}, console};
vm.createContext(sandbox);
for (const file of ['converter/road-names.js', 'web/src/scripts/map-desc-ways.js', 'web/src/scripts/map-desc-areas.js']) {
  vm.runInContext(fs.readFileSync(path.join(repo, file), 'utf8'), sandbox, {filename: file});
}
const road = (id, name) => ({osmType: 'way', osmId: id, label: name,
  isNamed: !!name, nameTags: name ? {name} : {}, length: 30, totalLength: 30});
const payload = {A: {subclasses: [{key: 'A1_local_streets', kind: 'linear', groups: [
  {label: 'Station Road', isNamed: true, totalLength: 60,
    ways: [road(1, 'Station Road'), road(2, 'Station Road')]},
  {label: null, isNamed: false, totalLength: 30, ways: [road(3, null)]},
  {label: null, isNamed: false, totalLength: 30, ways: [road(4, null)]}
]}]}};
const items = sandbox.window.TM.mapDescWays.buildModel(payload,
  {t: (key, fallback) => fallback || key}, {section: 'roads'});
const named = items.find(item => item.type === 'way');
const aggregate = items.find(item => item.type === 'summary');
assert(named, 'Named road entry missing');
assert(aggregate, 'Unnamed-road aggregate missing');
assert.deepStrictEqual(Array.from(named.attrs.filterRefs), ['way:1', 'way:2']);
assert.deepStrictEqual(Array.from(aggregate.attrs.filterRefs), ['way:3', 'way:4']);
console.log('Grouped and aggregate description entries retain all filter references');

const coastlineRef = 'coastline:' + 'a'.repeat(64);
const water = sandbox.window.TM.mapDescAreas.buildModel({B: {subclasses: [{
  key: 'B1_other_water', kind: 'area', groups: [{label: 'Sea', displayLabel: 'Sea',
    items: [{osmType: 'relation', osmId: 1, filterRefs: [coastlineRef]}]}]
}]}}, {t: (key, fallback) => fallback || key}, {section: 'water_areas'});
assert.deepStrictEqual(Array.from(water[0].attrs.filterRefs), [coastlineRef]);
