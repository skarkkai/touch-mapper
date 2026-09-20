'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const repo = path.resolve(__dirname, '../..');
const fixture = require('./area_groups.json');
const baseline = require('./area_groups_baseline.json');
const groups = fixture.C.subclasses.flatMap(sub => sub.groups || []);
const template = fs.readFileSync(path.join(repo, 'web/pre-src/map.pre'), 'utf8');
const injected = new Set(Array.from(template.matchAll(/"(map_content_[^"]+)":/g), match => match[1]));
const identity = refs => refs.slice().sort().join('|');
const groupRefs = group => group.items.map(item => item.osmType + ':' + item.osmId);
const multiGroups = groups.filter(group => group.items.length > 1);
assert.strictEqual(multiGroups.length, 7);
const pluralKeys = Object.keys(require('../../web/locales/en/tm.json'))
  .filter(key => key.startsWith('map_content_building_plural_'));

// The permanent regression input must not regain production identity metadata.
function checkSyntheticIdentity(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert(!['metadata', 'requestId', 'externalLink', 'importanceTags', 'centroid', 'lat', 'lon'].includes(key));
    if (key === 'osmId') assert(Number.isInteger(child) && child >= 1000 && child < 2000);
    if (key === 'label' && child) assert(child.startsWith('Example Place'));
    if (key === 'displayLabel' && child.includes(',')) assert(/, Example Street \d+$/.test(child));
    checkSyntheticIdentity(child);
  }
}
checkSyntheticIdentity(fixture);

// Exercise the production model with the browser's template-limited dictionary.
function renderer(locale) {
  const context = {window: {TM: {}, location: {pathname: '/' + locale + '/map'}}, console};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(repo, 'web/src/scripts/map-desc-areas.js'), 'utf8'), context);
  const dictionary = JSON.parse(fs.readFileSync(path.join(repo, 'web/locales', locale, 'tm.json')));
  return {dictionary, render: (data, section = 'buildings') => JSON.parse(JSON.stringify(
    context.window.TM.mapDescAreas.buildModel(data,
      {t: (key, fallback) => injected.has(key) ? dictionary[key] || fallback : fallback}, {section})
      .map(item => ({refs: item.attrs.filterRefs, lines: item.lines.map(line => ({
        className: line.className, text: line.parts.map(part => part.text).join('')
      }))}))))};
}

const wrap = group => ({C: {subclasses: [{kind: 'building', groups: [group]}]}});
for (const locale of Object.keys(baseline)) {
  const {dictionary, render} = renderer(locale);
  const actual = render(fixture);
  assert.deepStrictEqual(actual.map(item => identity(item.refs)).sort(), groups.map(group => identity(groupRefs(group))).sort(),
    'Group membership and filter identities remain unchanged');
  for (const item of baseline[locale].buildings) {
    assert.deepStrictEqual(actual.find(candidate => identity(candidate.refs) === identity(item.refs)), item,
      locale + ': singleton description changed');
  }
  assert.deepStrictEqual(render(fixture, 'water_areas'), baseline[locale].water_areas,
    locale + ': water descriptions changed');
  for (const group of multiGroups) {
    const item = actual.find(candidate => identity(candidate.refs) === identity(groupRefs(group)));
    assert(item.lines[0].text.startsWith(group.items.length + ' '), 'Explicit member count, not an address number');
    assert(!item.lines.some(line => line.className === 'map-content-shape'), 'No group shape/orientation');
    const locations = [];
    for (const member of group.items) {
      for (const line of render(wrap({...group, items: [member]}))[0].lines) {
        if (line.className === 'map-content-location' && !locations.includes(line.text)) locations.push(line.text);
      }
    }
    const actualLocations = item.lines.filter(line => line.className === 'map-content-location').map(line => line.text);
    assert.deepStrictEqual(actualLocations.slice().sort(), locations.slice().sort(), locale + ': retain each unique member location/contact');
    const total = group.items.reduce((sum, member) => sum + member.visibleGeometry.coverage.coveragePercent, 0);
    const formatted = total < 10 ? total.toFixed(1) : Math.round(total).toFixed(0);
    const expected = dictionary.map_content_total_area.replace('__percent__', formatted);
    assert.deepStrictEqual(item.lines.filter(line => line.className === 'map-content-parts').map(line => line.text), [expected]);
  }
  const group = JSON.parse(JSON.stringify(multiGroups[multiGroups.length - 1]));
  const item = render(wrap(group))[0];
  assert(item.lines[0].text.startsWith('2 ' + dictionary.map_content_building_plural_terrace));
  assert(item.lines.some(line => line.text === dictionary.map_content_total_area.replace('__percent__', '0.5')));
  // Missing measurements must not turn a partial sum into an asserted group total.
  delete group.items[1].visibleGeometry.coverage;
  assert(!render(wrap(group))[0].lines.some(line => line.className === 'map-content-parts'));
  group.displayLabel = 'unusual building, Example Street 99';
  assert(render(wrap(group))[0].lines[0].text.includes('2'));
  assert(!render(wrap(group))[0].lines[0].text.includes('__'));
  for (const key of pluralKeys) {
    assert(dictionary[key], locale + ': missing counted type');
    assert(injected.has(key), 'Plural translation must reach the browser');
    const type = key.slice('map_content_building_plural_'.length);
    group.displayLabel = (type === 'building' ? type : type + ' building') + ', Example Street 99';
    assert(render(wrap(group))[0].lines[0].text.startsWith('2 ' + dictionary[key]),
      locale + ': counted type not rendered for ' + type);
  }
}
console.log('Grouped building counts, locations, coverage and singleton/water baselines passed in all locales');
