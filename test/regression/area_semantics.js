'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const repo = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(repo, 'web/src/scripts/map-desc-areas.js'), 'utf8');
const template = fs.readFileSync(path.join(repo, 'web/pre-src/map.pre'), 'utf8');
const injected = new Set(Array.from(template.matchAll(/"(map_content_[^"]+)":/g), match => match[1]));
const loc = (dir, kind = 'part') => ({kind, dir});
const coverage = regions => ({coveragePercent: 1.2, segments: regions.map(([dir, insideCount, kind]) => ({
  loc: loc(dir, kind), insideCount
}))});
const area = (id, regions, extra = {}) => ({osmId: id, osmType: 'way', displayLabel: '(unnamed)',
  visibleGeometry: {coverage: regions ? coverage(regions) : null}, ...extra});
const group = item => ({items: [item], displayLabel: '(unnamed)'});
const water = items => ({B: {subclasses: [{kind: 'area', key: 'B1_lakes', groups: items.map(group)}]}});
const buildings = items => ({C: {subclasses: [{kind: 'building', groups: [{
  displayLabel: 'house building', items
}]}]}});
const refs = models => models.map(item => item.attrs.filterRefs.slice().sort().join('|')).sort();
const lines = (model, css) => model.lines.filter(line => line.parts.some(part => part.className === css));
const lineText = line => line.parts.map(part => part.text).join('');

// All assertions exercise the actual browser selection, grouping and formatting.
function renderer(locale, change) {
  const dictionary = require(path.join(repo, 'web/locales', locale, 'tm.json'));
  const context = {window: {TM: {}}, console};
  vm.createContext(context);
  vm.runInContext(source, context);
  const t = (key, fallback) => change ? change(key, dictionary[key] || fallback)
    : (injected.has(key) ? dictionary[key] || fallback : fallback);
  return (data, section = 'water_areas') => JSON.parse(JSON.stringify(
    context.window.TM.mapDescAreas.buildModel(data, {t}, {section})));
}

const cases = [
  ['single', [['north', 90], ['south', 10]], [['north', 95], ['east', 5]]],
  ['mostly', [['north', 70], ['south', 30]], [['south', 35], ['north', 65]]],
  ['comparable', [['north', 50], ['south', 50]], [['south', 50], ['north', 50]]],
  ['three', [['north', 40], ['northeast', 35], ['east', 25]], [['east', 40], ['north', 35], ['northeast', 25]]],
  ['distributed', [['north', 20], ['northeast', 18], ['east', 17], ['south', 16], ['southwest', 15], ['west', 14]],
    [['northeast', 20], ['north', 18], ['east', 17], ['south', 16], ['southwest', 15], ['west', 14]]]
];

for (const locale of ['en', 'fi', 'de', 'es', 'nl']) {
  const render = renderer(locale);
  for (const [name, first, second] of cases) {
    const pair = render(water([area(1, first), area(2, second)]));
    assert.deepStrictEqual(refs(pair), ['way:1|way:2'], locale + ': equivalent selected ' + name);
    assert.strictEqual(pair[0].type, 'water_area_summary');
    assert(lineText(pair[0].lines[0]).startsWith('2 '));
    assert.strictEqual(lines(pair[0], 'map-content-parts-coverage')[0].parts
      .find(part => part.className === 'map-content-parts-coverage').text, '2.4');
    const repeated = render(buildings([area(1, first), area(2, second)]), 'buildings')[0];
    assert.strictEqual(lines(repeated, 'map-content-location-text').length, 1, name + ': group deduplicates selected meaning');
  }
  const singleAndFallback = render(water([area(1, [['north', 90], ['south', 10]]),
    area(2, null, {location: {center: {loc: loc('north')}}})]));
  assert.deepStrictEqual(refs(singleAndFallback), ['way:1|way:2'], 'Coverage and fallback select the same single-region meaning');
  assert.deepStrictEqual(refs(render(water([area(1), area(2)]))), ['way:1', 'way:2'], 'Missing locations remain separate');
  assert.deepStrictEqual(refs(render(water([area(1, [['invalid', 100]]), area(2, [['invalid', 100]])]))),
    ['way:1', 'way:2'], 'Invalid locations remain separate');
  assert.deepStrictEqual(refs(render(water([area(1, [['north', Infinity]]), area(2, [['north', Infinity]])]))),
    ['way:1', 'way:2'], 'Invalid region weights do not invent a selected location');
  const malformed = [area(1, [['north', 100, 'unknown_kind']]), area(2, null, {
    visibleGeometry: {components: [null], coverage: {segments: [null, {loc: null, insideCount: 10}]}}
  }), area(3, null, {location: {center: {kind: 'near_edge', dir: 'invalid'}}})];
  assert.deepStrictEqual(refs(render(water(malformed))), ['way:1', 'way:2', 'way:3'],
    'Malformed kinds, directions, components and segments neither crash nor merge');
  for (const invalid of [undefined, null, NaN, Infinity, -1, '1.2']) {
    const incomplete = [area(1, [['north', 100]]), area(2, [['south', 100]])];
    incomplete[1].visibleGeometry.coverage.coveragePercent = invalid;
    assert.strictEqual(lines(render(buildings(incomplete), 'buildings')[0], 'map-content-parts-coverage').length, 0,
      'Missing or invalid member coverage cannot claim a complete group total');
  }
  assert.deepStrictEqual(refs(render(water([area(1, [['north', 70], ['south', 30]]),
    area(2, [['south', 70], ['north', 30]])]))), ['way:1', 'way:2'], 'Dominant/secondary roles are ordered');

  const contact = (id, edges, regions = [['north', 100]]) => ({...area(id, regions),
    visibleGeometry: {coverage: coverage(regions), edgesTouched: edges}});
  const contacts = render(buildings([
    contact(1, [{north: 12.1}]), contact(2, [{north: 12.2}]), contact(3, [{north: 0}]),
    contact(4, [{north: null}]), contact(5, [{south: null}]), contact(6, [{north: undefined}])
  ]), 'buildings')[0];
  assert.strictEqual(lines(contacts, 'map-content-touches').length, 5,
    'Exact measurements survive display rounding; zero and unknown measurements differ; unknown still retains its edge');
  const ordered = render(buildings([contact(1, [{north: 10, west: 20}]),
    contact(2, [{west: 20, north: 10}])]), 'buildings')[0];
  assert.strictEqual(lines(ordered, 'map-content-touches').length, 1, 'Property order does not change contact equivalence');
  const positions = render(buildings([
    contact(1, [{north: 10}], [['northwest', 50, 'near_edge'], ['northwest', 50, 'near_edge']]),
    contact(2, [{north: 10}], [['northeast', 50, 'near_edge'], ['northeast', 50, 'near_edge']])
  ]), 'buildings')[0];
  assert.strictEqual(lines(positions, 'map-content-touches').length, 2, 'Edge position remains part of contact identity');
}

for (const locale of ['en', 'fi', 'de', 'es', 'nl']) {
  // Coincident display labels must retain every different selected meaning.
  const collide = renderer(locale, (key, value) => /map_content_(loc_|dir_|corner_|edge_|touch_pos_)/.test(key) ? 'same' : value);
  const collisionItems = [area(1, [['north', 100]]), area(2, [['south', 100]]),
    area(3, [['north', 100, 'near_edge']]), area(4, [['northeast', 100, 'near_edge']])];
  assert.strictEqual(collide(water(collisionItems)).length, 4);
  assert.strictEqual(lines(collide(buildings(collisionItems), 'buildings')[0], 'map-content-location-text').length, 4);

  // Vary each formatting call: equal selected facts must still deduplicate.
  let sequence = 0;
  const changing = renderer(locale, (key, value) => key.startsWith('map_content_loc_') ? value + ' (' + (++sequence) + ')' : value);
  assert.strictEqual(lines(changing(buildings([area(1, [['north', 90], ['south', 10]]),
    area(2, [['north', 95], ['east', 5]])]), 'buildings')[0], 'map-content-location-text').length, 1);
  assert.strictEqual(changing(water([area(1, [['north', 70], ['south', 30]]),
    area(2, [['north', 65], ['south', 35]])])).length, 1);
}

// Preserve existing selector precedence: comparable shares use distributed,
// while 55/45 reaches mostly. The equal branch is unreachable at these thresholds.
const english = renderer('en');
const comparable = lines(english(water([area(1, [['north', 50], ['south', 50]])]))[0], 'map-content-location-text')[0];
const dominant = lines(english(water([area(1, [['north', 55], ['south', 45]])]))[0], 'map-content-location-text')[0];
assert(lineText(comparable).startsWith('In several areas'));
assert(lineText(dominant).startsWith('Mostly'));

// Exercise localization through the actual coordinator, including repeated use
// of one payload: localized name text cannot change source namedness.
const coordinator = {window: {TM: {}, location: {pathname: '/en/map'}}, console};
vm.createContext(coordinator);
for (const file of ['converter/road-names.js', 'web/src/scripts/map-desc-ways.js',
  'web/src/scripts/map-desc-areas.js', 'web/src/scripts/map-desc-pois.js', 'web/src/scripts/map-description.js']) {
  vm.runInContext(fs.readFileSync(path.join(repo, file), 'utf8'), coordinator, {filename: file});
}
const namedPayload = water([area(801, [['north', 100]]), area(802, [['north', 100]]), area(803, [['north', 100]])]);
namedPayload.B.subclasses[0].groups.forEach((entry, index) => {
  const name = ['Synthetic Cedar Lake', 'Synthetic Birch Lake', 'Synthetic Elm Lake'][index];
  const translatedName = index < 2 ? '(unnamed)' : 'water area';
  entry.label = name;
  entry.displayLabel = 'lake: ' + name;
  Object.assign(entry.items[0], {label: name, displayLabel: entry.displayLabel, importanceTags: {
    extraNames: Object.fromEntries(['en', 'fi', 'de', 'es', 'nl'].map(locale => ['name:' + locale, translatedName]))
  }});
});
for (const locale of ['en', 'fi', 'de', 'es', 'nl', 'fi', 'en']) {
  coordinator.window.location.pathname = '/' + locale + '/map';
  const dictionary = require(path.join(repo, 'web/locales', locale, 'tm.json'));
  const model = JSON.parse(JSON.stringify(coordinator.window.TM.mapDescription.buildModel(namedPayload,
    {t: (key, fallback) => injected.has(key) ? dictionary[key] || fallback : fallback}, {})));
  const items = model.waterAreas.items;
  assert.deepStrictEqual(refs(items), ['way:801', 'way:802', 'way:803'], locale + ': source names prevent unnamed aggregation');
  assert(items.every(item => item.attrs.dataIsNamed === true));
  assert.strictEqual(items.filter(item => lineText(item.lines[0]).endsWith('(unnamed)')).length, 2,
    'Localized names matching the unnamed sentinel remain displayed as names');
  assert.strictEqual(items.filter(item => lineText(item.lines[0]).endsWith('water area')).length, 1,
    'Localized names matching a generic type remain displayed as names');
  assert.strictEqual(namedPayload.B.subclasses[0].groups[0].sourceLabel, 'Synthetic Cedar Lake');
}
console.log('Area semantic selection, locale collisions, exact contacts and unordered regions passed');
