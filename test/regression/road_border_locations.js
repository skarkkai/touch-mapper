'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {payload} = require('./way_segments');
const repo = path.resolve(__dirname, '../..');
const part = dir => ({kind: 'part', dir});
const edge = (t, dir, side = dir) => ({t, type: 'map_edge_crossing', edge: side,
  zone: {kind: 'near_edge', dir}});
const end = (t, dir) => ({t, type: 'terminates', zone: part(dir)});
const junction = (t, dir, ids) => ({t, type: 'junction', zone: part(dir),
  connections: ids.map(osmId => ({osmId, osmType: 'way'}))});
const piece = (...events) => ({events});
const lines = item => Array.from(item.lines, line => line.parts.map(p => p.text).join(''));
const sandbox = {window: {TM: {}, location: {pathname: '/en/map'}}, console};
vm.createContext(sandbox);
for (const file of ['converter/road-names.js', 'web/src/scripts/map-desc-ways.js']) {
  vm.runInContext(fs.readFileSync(path.join(repo, file), 'utf8'), sandbox);
}

for (const locale of ['en', 'fi', 'de', 'es', 'nl']) {
  const translations = JSON.parse(fs.readFileSync(path.join(repo, 'web/locales', locale, 'tm.json')));
  const render = data => sandbox.window.TM.mapDescWays.buildModel(data,
    {t: (key, fallback) => key.startsWith('map_content_connects_') ? 'CONNECTION' : translations[key] || fallback});
  const road = buckets => payload('A1_secondary_roads', buckets);
  const endpoint = dir => translations.map_content_way_endpoint.replace('__location__',
    translations.map_content_loc_full_part.replace('__dir__', translations['map_content_dir_' + dir]));
  const locationLines = item => Array.from(item.lines).filter(line =>
    line.className === 'map-content-location').map(line => line.parts.map(p => p.text).join(''))
    .filter(text => text !== 'CONNECTION');

  // The user's fragmented road: several source ways and short internal branches
  // must contribute no location clauses once both borders are represented.
  const through = road([
    [piece(edge(0, 'southeast', 'south'), junction(1, 'southeast', [1, 2]))],
    [piece(junction(0, 'southeast', [1, 2]), junction(1, 'north', [2, 3]))],
    [piece(junction(0, 'north', [2, 3]), edge(1, 'north'))],
    [piece(end(0, 'south'), end(1, 'southeast'))]
  ]);
  const item = render(through)[0];
  assert.strictEqual(item.attrs.filterRefs.length, 4);
  assert.strictEqual(locationLines(item).length, 1, locale + ': only the crossing sentence survives');
  if (locale === 'en') assert.strictEqual(locationLines(item)[0],
    'Crosses north edge near the center and south edge in the east');
  assert(!lines(item).join('\n').includes('; '));
  through.A.subclasses[0].groups[0].visibleGeometry.reverse();
  assert.deepStrictEqual(locationLines(render(through)[0]), locationLines(item), 'source order is irrelevant');

  // Follow the same-name group through an OSM split to its endpoint at another
  // road's junction. The split and intervening junction are not endpoints.
  const entering = road([
    [piece(edge(0, 'north'), junction(1, 'east', [1, 2]))],
    [piece(junction(0, 'east', [1, 2]), junction(0.5, 'south', [2, 99]), junction(1, 'southwest', [2, 99]))]
  ]);
  const enteringItem = render(entering)[0];
  assert.strictEqual(locationLines(enteringItem).length, 2);
  assert(lines(enteringItem).includes(endpoint('southwest')), locale + ': report the actual road endpoint');
  assert(!lines(enteringItem).includes(endpoint('east')));
  const group = entering.A.subclasses[0].groups[0];
  group.visibleGeometry.push(group.visibleGeometry[0]);
  assert.deepStrictEqual(locationLines(render(entering)[0]), locationLines(enteringItem), 'repeated bucket is not another crossing');

  const deadEnd = render(road([[piece(edge(0, 'west'), end(1, 'east'))]]))[0];
  assert(lines(deadEnd).includes(endpoint('east')), 'ordinary dead end');
  const reverse = render(road([[piece(end(0, 'east'), edge(1, 'west'))]]))[0];
  assert.deepStrictEqual(locationLines(reverse), locationLines(deadEnd), 'OSM direction has no effect');
  const branch = render(road([[piece(edge(0, 'west'), end(1, 'east'))], [piece(end(0, 'south'), end(1, 'east'))]]))[0];
  assert(lines(branch).some(text => text.includes(endpoint('east')) && text.includes(endpoint('south'))),
    'all known termini survive for a branched road');

  // Two crossings on the same edge, even in the same coarse region, still
  // suppress all internal locations. A third border does not restore them.
  for (const events of [
    [edge(0, 'northwest', 'north'), junction(0.5, 'south', [1, 99]), edge(1, 'northeast', 'north')],
    [edge(0, 'north'), junction(0.5, 'south', [1, 99]), edge(1, 'north')]
  ]) {
    assert.strictEqual(locationLines(render(road([[piece(...events)]]))[0]).length, 1);
  }
  const multiple = road([[piece(edge(0, 'north'), end(1, 'east'))],
    [piece(edge(0, 'west'), edge(1, 'south'))]]);
  assert.strictEqual(locationLines(render(multiple)[0]).length, 1);

  // One corner contact is one crossing, although it touches two border edges.
  const corner = {...edge(0, 'northwest'), edge: 'corner', edges: ['north', 'west']};
  const cornerItem = render(road([[piece(corner, end(1, 'east'))]]))[0];
  assert.strictEqual(locationLines(cornerItem).length, 2);
  assert(lines(cornerItem).includes(endpoint('east')));
  assert(lines(cornerItem).some(text => text.includes(translations.map_content_edge_north) &&
    text.includes(translations.map_content_edge_west)));

  const unknown = render(road([[piece(edge(0, 'north'), {t: 1, type: 'terminates', zone: {kind: 'unknown'}})]]))[0];
  assert.strictEqual(locationLines(unknown).length, 1, 'missing endpoint data must not invent an endpoint');
  const interior = render(road([[piece(end(0, 'west'), end(1, 'east'))]]))[0];
  assert.strictEqual(locationLines(interior).length, 1, 'no-crossing road retains its route');
  assert(!lines(interior).some(text => text.includes(translations.map_content_way_endpoint.split('__')[0])));
}
console.log('Road border and endpoint location priorities passed in all five locales');
