'use strict';

// Exercise the production renderers with hostile translation dictionaries. The
// render-ready text may collide, but grouping and filter identities must not.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const repo = path.resolve(__dirname, '../..');
const locales = ['en', 'fi', 'de', 'es', 'nl'];

function renderer(locale, collisions) {
  const sandbox = {window: {TM: {}, location: {pathname: '/' + locale + '/map'}}, console};
  vm.createContext(sandbox);
  for (const file of ['converter/road-names.js', 'web/src/scripts/map-desc-ways.js',
    'web/src/scripts/map-desc-areas.js', 'web/src/scripts/map-desc-pois.js']) {
    vm.runInContext(fs.readFileSync(path.join(repo, file), 'utf8'), sandbox);
  }
  const translations = JSON.parse(fs.readFileSync(path.join(repo, 'web/locales', locale, 'tm.json')));
  return {
    translations,
    ways: (data, section) => sandbox.window.TM.mapDescWays.buildModel(data, {t: (key, fallback) =>
      collisions && collisions[key] !== undefined ? collisions[key] : (translations[key] || fallback)}, {section}),
    areas: (data, section) => sandbox.window.TM.mapDescAreas.buildModel(data, {t: (key, fallback) =>
      collisions && collisions[key] !== undefined ? collisions[key] : (translations[key] || fallback)}, {section}),
    pois: (data, section) => sandbox.window.TM.mapDescPois.buildModel(data, {t: (key, fallback) =>
      collisions && collisions[key] !== undefined ? collisions[key] : (translations[key] || fallback)}, {section})
  };
}

function refs(model) {
  return Array.from(model, item => Array.from(item.attrs.filterRefs || []).sort().join('|')).sort();
}

function segment(from, to, edge) {
  return {events: [
    {t: 0, type: 'endpoint', zone: {kind: 'part', dir: from}},
    {t: 1, type: 'map_edge_crossing', edge, zone: {kind: 'near_edge', dir: edge}},
    {t: 2, type: 'endpoint', zone: {kind: 'part', dir: to}}
  ]};
}

function linearGroup(id, from, to, edge) {
  return {isNamed: false, totalLength: 123.4,
    ways: [{osmType: 'way', osmId: id}],
    visibleGeometry: [{osmId: id, segments: [segment(from, to, edge)]}]};
}

function poiGroup(id, type, loc) {
  return {displayLabel: type, items: [{osmType: 'node', osmId: id, displayLabel: type,
    location: {point: {loc}}}]};
}

function waterGroup(id, segments) {
  return {items: [{osmType: 'way', osmId: id, visibleGeometry: {coverage: {coveragePercent: 10, segments}}}]};
}

const linearDistinct = {A: {subclasses: [{key: 'A6_other_ways', kind: 'linear', groups: [
  linearGroup(1, 'west', 'east', 'north'), linearGroup(2, 'west', 'east', 'south')
]}]}};
const linearEquivalent = {A: {subclasses: [{key: 'A4_other_waterways', kind: 'linear', groups: [
  linearGroup(3, 'west', 'east', 'north'), linearGroup(4, 'east', 'west', 'north')
]}]}};
const poiDistinct = {D: {subclasses: [{key: 'D3_commercial', kind: 'poi', groups: [
  poiGroup(10, 'bench', {kind: 'part', dir: 'north'}),
  poiGroup(11, 'waste basket', {kind: 'part', dir: 'north'})
]}]}};
const poiEquivalent = {D: {subclasses: [{key: 'D3_commercial', kind: 'poi', groups: [
  poiGroup(12, 'bench', {kind: 'part', dir: 'north'}),
  poiGroup(13, 'bench', {kind: 'part', dir: 'north'})
]}]}};
const waterDistinct = {B: {subclasses: [{key: 'B1_lakes', kind: 'area', groups: [
  waterGroup(20, [{loc: {kind: 'part', dir: 'north'}, insideCount: 90}, {loc: {kind: 'part', dir: 'south'}, insideCount: 10}]),
  waterGroup(21, [{loc: {kind: 'part', dir: 'south'}, insideCount: 90}, {loc: {kind: 'part', dir: 'north'}, insideCount: 10}])
]}]}};
const waterEquivalent = {B: {subclasses: [{key: 'B1_lakes', kind: 'area', groups: [
  waterGroup(22, [{loc: {kind: 'part', dir: 'north'}, insideCount: 90}, {loc: {kind: 'part', dir: 'south'}, insideCount: 10}]),
  waterGroup(23, [{loc: {kind: 'part', dir: 'north'}, insideCount: 180}, {loc: {kind: 'part', dir: 'south'}, insideCount: 20}])
]}]}};

const collisions = {
  map_content_dir_north: 'same place', map_content_dir_south: 'same place',
  map_content_edge_north: 'same edge', map_content_edge_south: 'same edge',
  map_content_osm_value_bench: 'same type', map_content_osm_value_waste_basket: 'same type'
};

let baseline = null;
for (const locale of locales) {
  const normal = renderer(locale);
  const collided = renderer(locale, collisions);
  const semantic = {
    linearDistinct: refs(normal.ways(linearDistinct, 'otherLinear')),
    linearEquivalent: refs(normal.ways(linearEquivalent, 'waterways')),
    poiDistinct: refs(normal.pois(poiDistinct, 'daily_essentials')),
    poiEquivalent: refs(normal.pois(poiEquivalent, 'daily_essentials')),
    waterDistinct: refs(normal.areas(waterDistinct, 'water_areas')),
    waterEquivalent: refs(normal.areas(waterEquivalent, 'water_areas'))
  };
  assert.strictEqual(semantic.linearDistinct.length, 2, locale + ': distinct edge meanings remain separate');
  assert.deepStrictEqual(semantic.linearEquivalent, ['way:3|way:4'], locale + ': reversed route pairs merge once');
  assert.strictEqual(semantic.poiDistinct.length, 2, locale + ': distinct source POI types remain separate');
  assert.deepStrictEqual(semantic.poiEquivalent, ['poi:node:12|poi:node:13'], locale + ': equivalent POIs merge');
  assert.strictEqual(semantic.waterDistinct.length, 2, locale + ': opposite dominant regions remain separate');
  assert.deepStrictEqual(semantic.waterEquivalent, ['way:22|way:23'], locale + ': equivalent coverage meanings merge');
  assert.deepStrictEqual(refs(collided.ways(linearDistinct, 'otherLinear')), semantic.linearDistinct,
    locale + ': translated edge collision changes no linear identity');
  assert.deepStrictEqual(refs(collided.pois(poiDistinct, 'daily_essentials')), semantic.poiDistinct,
    locale + ': translated type collision changes no POI identity');
  assert.deepStrictEqual(refs(collided.areas(waterDistinct, 'water_areas')), semantic.waterDistinct,
    locale + ': translated region collision changes no water identity');
  if (!baseline) baseline = semantic;
  else assert.deepStrictEqual(semantic, baseline, locale + ': locale changes no semantic result');
}

const lines = item => Array.from(item.lines, line => line.parts.map(part => part.text).join(''));
const wrapWays = (groups, key = 'A6_other_ways') => ({A: {subclasses: [{key, kind: 'linear', groups}]}});
const clone = value => JSON.parse(JSON.stringify(value));
const groupsWithLengths = values => values.map((totalLength, index) => ({
  ...linearGroup(100 + index, 'west', 'east', 'north'), totalLength
}));

// Numeric display buckets are intentional only for the first unnamed linear
// merge. Boundary rules are checked with literal expected memberships/totals.
for (const locale of locales) {
  const normal = renderer(locale);
  const altered = renderer(locale, {
    ...collisions,
    map_content_way_length_m: 'DISTANCE (__meters__)!',
    map_content_way_route_from_to: '__end__ ← __start__!',
    map_content_loc_route_from_part: 'ORIGIN[__dir__]',
    map_content_loc_route_to_part: 'destination[__dir__]'
  });
  const collapsed = renderer(locale, {
    ...collisions, map_content_way_length_m: 'same distance',
    map_content_way_route_from_to: 'same route', map_content_way_route_near: 'same route',
    map_content_crosses_edge: 'same edge', map_content_crosses_items: 'same edge'
  });
  for (const [values, expected, total] of [
    [[99.6, 100.2], ['way:100|way:101'], 200],
    [[102.49, 102.51], ['way:100', 'way:101']],
    [[999, 1001], ['way:100|way:101'], 2000],
    [[1004.9, 1005.1], ['way:100', 'way:101']],
    [[20.2, 20.4], ['way:100|way:101'], 41],
    [[20.49, 20.51], ['way:100', 'way:101']]
  ]) {
    const data = wrapWays(groupsWithLengths(values));
    for (const render of [normal, altered, collapsed]) {
      assert.deepStrictEqual(refs(render.ways(data, 'otherLinear')), expected, locale + ': explicit meter bucket ' + values);
    }
    if (total) {
      const text = normal.translations.map_content_way_length_m.replace('__meters__', total);
      assert(lines(normal.ways(data, 'otherLinear')[0])[0].includes(text), locale + ': sum original measurements');
    }
  }

  const groups = groupsWithLengths([120, 800]);
  const first = segment('west', 'east', 'north');
  const second = segment('north', 'south', 'west');
  const reverse = seg => ({events: seg.events.map(event => ({...event, t: 2 - event.t})).reverse()});
  groups[0].visibleGeometry[0].segments = [first, second, first];
  groups[1].visibleGeometry[0].segments = [reverse(second), reverse(first), second];
  const rail = wrapWays(groups, 'A3_railways');
  for (const render of [normal, altered, collapsed]) {
    const result = render.ways(rail, 'railways');
    assert.deepStrictEqual(refs(result), ['way:100|way:101'], 'railways ignore length and route/edge input ordering');
    assert.strictEqual(lines(result[0])[1].split('; ').length, 2, 'exactly two distinct routes survive');
  }
  const allText = lines(normal.ways(rail, 'railways')[0]).join('\n');
  assert(allText.includes(normal.translations.map_content_edge_north));
  assert(allText.includes(normal.translations.map_content_edge_west));
  assert(allText.includes(normal.translations.map_content_way_length_m.replace('__meters__', 920)));

  // Established waterway summaries span subtypes and omit the individual edge
  // line. Preserve that output while making route grouping language independent.
  const waterways = wrapWays(groupsWithLengths([120, 800]), 'A4_other_waterways');
  waterways.A.subclasses[0].groups[1].visibleGeometry[0].segments = [segment('east', 'west', 'south')];
  const waterItems = normal.ways(waterways, 'waterways');
  assert.deepStrictEqual(refs(waterItems), ['way:100|way:101']);
  assert.strictEqual(waterItems[0].type, 'summary');
  assert(lines(waterItems[0])[0].startsWith('2 '));
  const waterText = lines(waterItems[0]).join('\n');
  assert.strictEqual(waterItems[0].lines.length, 2, 'existing summary has a title and route only');
  assert(waterText.includes(normal.translations.map_content_way_length_m.replace('__meters__', 920)));
  assert.deepStrictEqual(refs(collapsed.ways(waterways, 'waterways')), refs(waterItems));

  // Identical type labels cannot combine distinct first-stage linear types.
  const twoTypes = wrapWays([linearGroup(200, 'west', 'east', 'north')], 'A3_railways');
  twoTypes.A.subclasses.push({key: 'A3_tram', kind: 'linear', groups: [linearGroup(201, 'west', 'east', 'north')]});
  const typeCollision = renderer(locale, {map_content_way_type_A3_railways: 'TRACK', map_content_way_type_A3_tram: 'TRACK'});
  assert.deepStrictEqual(refs(typeCollision.ways(twoTypes, 'railways')), ['way:200', 'way:201']);

  const road = linearGroup(250, 'west', 'east', 'north');
  road.isNamed = true;
  road.label = 'Example Road';
  const connections = [
    {osmId: 251, subClass: 'A2_cycleways'},
    {osmId: 252, subClass: 'A2_cycleways'},
    {osmId: 253, subClass: 'A2_footpaths_trails'},
    {osmId: 254, subClass: 'A2_footpaths_trails'},
    {osmId: 255, subClass: 'A3_railways'}
  ];
  road.visibleGeometry[0].segments[0].events.push({t: 1.5, type: 'junction', connections});
  road.visibleGeometry[0].segments.push(clone(road.visibleGeometry[0].segments[0]));
  const connectionCollision = renderer(locale, {
    map_content_way_type_plural_A2_cycleways: 'SAME',
    map_content_way_type_plural_A2_footpaths_trails: 'SAME',
    map_content_connects_to_type_many: 'COUNT=__count__ TYPE=__type__'
  });
  const connectionLines = lines(connectionCollision.ways(wrapWays([road], 'A1_local_streets'), 'roads')[0]);
  assert.strictEqual(connectionLines.filter(text => text === 'COUNT=2 TYPE=SAME').length, 2,
    'connection types survive label collision; repeated identified junctions deduplicate');
  const railLines = lines(connectionCollision.ways(wrapWays([road], 'A3_railways'), 'railways')[0]);
  assert(!railLines.some(text => text.includes('COUNT=')), 'railway junction narration stays suppressed');

  // Known selected locations survive an unknown final point, without inventing
  // an endpoint; entirely unknown geometry does not create a generic merge key.
  const partial = linearGroup(300, 'west', 'east', 'north');
  partial.visibleGeometry[0].segments = [{events: [{t: 0, zone: {kind: 'part', dir: 'west'}}, {t: 1, zone: {kind: 'unknown'}}]}];
  const single = clone(partial);
  single.visibleGeometry[0].segments[0].events.pop();
  assert.deepStrictEqual(lines(normal.ways(wrapWays([partial]), 'otherLinear')[0]),
    lines(normal.ways(wrapWays([single]), 'otherLinear')[0]));
  for (const bad of [null, {}, {kind: 'unknown'}, {kind: 'near_edge'}, {kind: 'part', dir: 'invalid'},
    {kind: 'part', dir: false}, {kind: 'part', dir: 0}]) {
    const unknowns = groupsWithLengths([100, 100]);
    unknowns.forEach(group => { group.visibleGeometry[0].segments = [{events: [{zone: bad}]}]; });
    for (const render of [normal, collapsed]) {
      const result = render.ways(wrapWays(unknowns), 'otherLinear');
      assert.deepStrictEqual(refs(result), ['way:100', 'way:101']);
      assert(result.every(item => item.lines.length === 1), 'unknown locations are not narrated');
      assert(!JSON.stringify(result).match(/undefined|__\w+__/));
    }
  }
  for (const length of [undefined, null, NaN, Infinity, -1, 0]) {
    const invalidLengths = groupsWithLengths([length, length]);
    assert.deepStrictEqual(refs(normal.ways(wrapWays(invalidLengths), 'otherLinear')),
      ['way:100', 'way:101'], 'missing/invalid length is not a generic equivalence bucket');
  }
}
console.log('Map-description semantic grouping is locale and wording independent');
