'use strict';

// Synthetic inputs exercise the production POI renderer and name-localization boundary.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '../..');
const locales = ['en', 'fi', 'de', 'es', 'nl'];

function context(locale) {
  const sandbox = {window: {TM: {}, location: {pathname: '/' + locale + '/map'}}, console};
  vm.createContext(sandbox);
  for (const file of ['converter/road-names.js', 'web/src/scripts/map-desc-ways.js',
    'web/src/scripts/map-desc-areas.js', 'web/src/scripts/map-desc-pois.js', 'web/src/scripts/map-description.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, {filename: file});
  }
  return sandbox;
}

function translations(locale, override) {
  const en = JSON.parse(fs.readFileSync(path.join(root, 'web/locales/en/tm.json')));
  const local = JSON.parse(fs.readFileSync(path.join(root, 'web/locales', locale, 'tm.json')));
  return {t: (key, fallback) => Object.prototype.hasOwnProperty.call(override || {}, key)
    ? override[key] : local[key] || en[key] || fallback};
}

function group(id, type, loc, options = {}) {
  const label = options.name || null;
  return {
    label, displayLabel: type + (label ? ': ' + label : ''),
    importanceScore: options.importance || 0,
    items: [{osmType: 'node', osmId: id, label, displayLabel: type,
      location: loc ? {point: {loc}} : null,
      importanceTags: {extraNames: options.extraNames || {}}}]
  };
}

function payload(groups) {
  return {D: {subclasses: [{key: 'D3_commercial', kind: 'poi', groups}]}};
}

function refs(items) {
  return Array.from(items, item => Array.from(item.attrs.filterRefs || []).sort().join('|')).sort();
}

function lineText(item, className) {
  const line = item.lines.find(value => value.className === className);
  return line ? line.parts.map(part => part.text).join('') : '';
}

let baseline;
for (const locale of locales) {
  const sandbox = context(locale);
  const renderer = sandbox.window.TM.mapDescPois;
  const helpers = translations(locale);
  const build = (groups, overrides) => renderer.buildModel(payload(groups),
    overrides ? translations(locale, overrides) : helpers, {section: 'daily_essentials'});
  const north = {kind: 'part', dir: 'north'};
  const south = {kind: 'part', dir: 'south'};
  const known = [group(101, 'bench', north), group(102, 'bench', north, {importance: 5}),
    group(103, 'bench', south), group(104, 'waste basket', north)];
  const collisions = {map_content_osm_value_bench: 'Same type', map_content_osm_value_waste_basket: 'Same type',
    map_content_dir_north: 'Same region', map_content_dir_south: 'Same region',
    map_content_poi_unnamed_many: 'COUNT=__count__; TYPE=__type__',
    map_content_summary_distributed_top2: 'TWO: __first__ | __second__'};
  const normal = build(known);
  if (locale === 'en') {
    const singleton = build([group(100, 'bench', north)])[0];
    assert.strictEqual(lineText(singleton, 'map-content-title-line'), 'Unnamed bench');
    assert.strictEqual(lineText(singleton, 'map-content-location'), 'In the north part');
  }
  const collided = build(known, collisions);
  assert.deepStrictEqual(refs(collided), ['poi:node:101|poi:node:102|poi:node:103', 'poi:node:104']);
  assert.deepStrictEqual(refs(normal), refs(collided));
  const merged = collided.find(item => item.attrs.filterRefs.length === 3);
  assert.strictEqual(lineText(merged, 'map-content-title-line'), 'COUNT=3; TYPE=Same type',
    locale + ': replacing a representative retains every member count');
  assert(lineText(merged, 'map-content-location').startsWith('TWO: '),
    locale + ': colliding region wording retains two distinct location facts');
  const rewritten = build(known, Object.assign({}, collisions, {
    map_content_loc_full_part: 'AROUND (__dir__)!',
    map_content_summary_distributed_top2: 'TWO: __first__ / __second__'}));
  assert.deepStrictEqual(refs(rewritten), refs(collided));
  assert(lineText(rewritten.find(item => item.attrs.filterRefs.length === 3), 'map-content-location').startsWith('TWO: '));

  const equivalent = build([group(111, 'bench', {kind: 'center'}), group(112, 'bench', {kind: 'part'})], collisions);
  assert.deepStrictEqual(refs(equivalent), ['poi:node:111|poi:node:112']);
  assert(!lineText(equivalent[0], 'map-content-location').startsWith('TWO: '),
    locale + ': a part without direction selects the existing center meaning');
  const sameTypeDifferentMeanings = build([group(121, 'bench', {kind: 'near_edge', dir: 'northwest'}),
    group(122, 'bench', {kind: 'part', dir: 'northwest'})], collisions);
  assert(lineText(sameTypeDifferentMeanings[0], 'map-content-location').startsWith('TWO: '),
    locale + ': corner and interior remain distinct facts');

  const unknown = build([group(131, 'bench', null), group(132, 'bench', null),
    group(133, 'bench', {kind: 'near_edge'}), group(134, 'bench', {kind: 'part', dir: {}}),
    group(135, 'bench', {kind: 'other', dir: 'north'})]);
  assert.strictEqual(unknown.length, 5, locale + ': unrelated unknown locations never merge');
  assert(unknown.every(item => !lineText(item, 'map-content-location')), 'Invalid locations produce no invented sentence');
  assert(!JSON.stringify(unknown).includes('__'), 'No unresolved placeholders');
  const unknownType = build([group(136, '', north, {name: 'Synthetic Unknown'}),
    group(137, '', north, {name: 'Synthetic Unknown'})]);
  assert.strictEqual(unknownType.length, 2, 'Missing types cannot establish semantic equivalence');
  const semantic = {known: refs(normal), unknown: refs(unknown), equivalent: refs(equivalent)};
  if (!baseline) baseline = semantic;
  else assert.deepStrictEqual(semantic, baseline, locale + ': counts and memberships remain locale independent');

  // Name translation may collide, but source names continue to identify separate features.
  const named = payload([group(141, 'cafe', north, {name: 'Synthetic Cedar', extraNames: {
    'name:fi': 'Synthetic Common', 'name:de': 'Synthetic Common'}}),
  group(142, 'cafe', north, {name: 'Synthetic Birch', extraNames: {
    'name:fi': 'Synthetic Common', 'name:de': 'Synthetic Common'}})]);
  function road(id, name) {
    const tags = {name, 'name:fi': 'Synthetic Shared Road', 'name:de': 'Synthetic Shared Road'};
    return {label: name, displayLabel: name, isNamed: true, totalLength: 50,
      ways: [{osmType: 'way', osmId: id, label: name, displayLabel: name, isNamed: true, nameTags: tags}]};
  }
  named.A = {subclasses: [{key: 'A1_major_roads', kind: 'linear', groups: [
    road(151, 'Synthetic Cedar Road'), road(152, 'Synthetic Birch Road')]}]};
  const connectingRoad = road(153, 'Synthetic Connecting Road');
  connectingRoad.ways[0].nameTags = {name: connectingRoad.label};
  connectingRoad.visibleGeometry = [{osmId: 153, segments: [{events: [{type: 'junction', t: 0,
    zone: {kind: 'center'}, connections: [
      {osmType: 'way', osmId: 151, name: 'Synthetic Cedar Road', subClass: 'A1_major_roads'},
      {osmType: 'way', osmId: 152, name: 'Synthetic Birch Road', subClass: 'A1_major_roads'}
    ]}]}]}];
  named.A.subclasses[0].groups.push(connectingRoad);
  for (const lang of [locale, 'fi', 'de', 'en', 'nl']) {
    sandbox.window.location.pathname = '/' + lang + '/map';
    const model = sandbox.window.TM.mapDescription.buildModel(named, translations(lang), {});
    assert.deepStrictEqual(refs(model.poiDaily.items), ['poi:node:141', 'poi:node:142']);
    assert.deepStrictEqual(refs(model.roads.items), ['way:151', 'way:152', 'way:153']);
    const connected = model.roads.items.find(item => item.attrs.filterRefs.includes('way:153'));
    const names = ['fi', 'de'].includes(lang)
      ? 'Synthetic Shared Road, Synthetic Shared Road' : 'Synthetic Birch Road, Synthetic Cedar Road';
    const expectedConnection = translations(lang).t('map_content_connects_to_ways').replace('__ways__', names);
    assert(connected.lines.some(line => line.parts.map(part => part.text).join('') === expectedConnection),
      lang + ': two distinct connection targets survive identical localized names');
    const poi = named.D.subclasses[0].groups[0];
    assert.strictEqual(poi.sourceLabel, 'Synthetic Cedar');
    assert.strictEqual(poi.sourceDisplayLabel, 'cafe: Synthetic Cedar');
    assert.strictEqual(poi.label, ['fi', 'de'].includes(lang) ? 'Synthetic Common' : 'Synthetic Cedar');
    assert(!Object.keys(poi).includes('sourceLabel'), 'Browser-only identity fields do not alter serialized map-content');
  }
}
console.log('POI semantic grouping, retained facts, counts, and source-name localization passed for all five locales');
