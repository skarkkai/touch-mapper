'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const repo = path.resolve(__dirname, '../..');
const fragmented = require('./way_segments_fragmented.json');

// Recreate the grouped production input using only the location data under test.
function fragmentedPayload() {
  const data = payload('A1_secondary_roads', fragmented.segments.map(entry => [{events: [
    {t: 0, type: 'terminates', zone: fragmented.zones[entry.from]},
    {t: 1, type: 'terminates', zone: fragmented.zones[entry.to]}
  ]}]));
  const group = data.A.subclasses[0].groups[0];
  group.label = 'Example Road';
  group.ways.forEach((way, index) => {
    way.osmId = fragmented.segments[index].osmId;
    way.label = group.label;
    way.nameTags = {name: group.label};
    group.visibleGeometry[index].osmId = way.osmId;
  });
  return data;
}

// Distinct pieces carry independent routes, edges, and a shared junction.
function segment(edge, end) {
  return {events: [
    {type: 'map_edge_crossing', t: 0, edge, zone: {kind: 'near_edge', dir: edge}},
    {type: 'junction', t: 0.5, zone: {kind: 'center'}, connections: [
      {osmType: 'way', osmId: 99, name: 'Cross Street', subClass: 'A1_local_streets'}
    ]},
    {type: 'endpoint', t: 1, zone: {kind: 'part', dir: end}}
  ]};
}

function payload(key, buckets) {
  return {A: {subclasses: [{key, kind: 'linear', groups: [{
    label: 'Example Road', isNamed: true, totalLength: 100,
    ways: buckets.map((segments, index) => ({osmType: 'way', osmId: index + 1,
      label: 'Example Road', isNamed: true, nameTags: {name: 'Example Road'}})),
    visibleGeometry: buckets.map((segments, index) => ({osmId: index + 1, segments}))
  }]}]}};
}

// Compare actual localized model lines, not implementation strings or snapshots.
function check() {
  const sandbox = {window: {TM: {}, location: {pathname: '/en/map'}}, console};
  vm.createContext(sandbox);
  for (const file of ['converter/road-names.js', 'web/src/scripts/map-desc-ways.js']) {
    vm.runInContext(fs.readFileSync(path.join(repo, file), 'utf8'), sandbox);
  }
  const first = segment('west', 'east');
  const second = segment('north', 'south');
  const lines = item => Array.from(item.lines, line => line.parts.map(part => part.text).join(''));
  for (const locale of ['en', 'fi', 'de', 'es', 'nl']) {
    const translations = JSON.parse(fs.readFileSync(path.join(repo, 'web/locales', locale, 'tm.json')));
    const render = data => sandbox.window.TM.mapDescWays.buildModel(data,
      {t: (key, fallback) => translations[key] || fallback});
    const fragmentedData = fragmentedPayload();
    const fragmentedItems = render(fragmentedData);
    assert.strictEqual(fragmentedItems.length, 1);
    assert.strictEqual(fragmentedItems[0].attrs.filterRefs.length, 17, 'all source ways remain represented');
    const actualRoute = lines(fragmentedItems[0])[1];
    assert.strictEqual(actualRoute.split('; ').length, 3, locale + ': ten distinct clauses reduce to three');
    const expectedClauses = fragmented.expectedPairs.map(([from, to]) => {
      const input = payload('A1_secondary_roads', [[{events: [
        {t: 0, zone: fragmented.zones[from]}, {t: 1, zone: fragmented.zones[to]}
      ]}]]);
      return lines(render(input)[0])[1];
    });
    assert.strictEqual(actualRoute, expectedClauses.join('; '), locale + ': retain exactly the three distinct pairs');
    const reordered = fragmentedPayload();
    const reorderedGroup = reordered.A.subclasses[0].groups[0];
    reorderedGroup.visibleGeometry.reverse();
    reorderedGroup.visibleGeometry.push(...reorderedGroup.visibleGeometry.slice());
    const unrelatedSegment = {events: [{t: 0, zone: {kind: 'center'}}]};
    reorderedGroup.visibleGeometry.push({segments: [unrelatedSegment, unrelatedSegment]});
    const reorderedExpected = [['NEC', 'NE'], ['E', 'NE'], ['E', 'SEC']].map(([from, to]) =>
      lines(render(payload('A1_secondary_roads', [[{events: [
        {t: 0, zone: fragmented.zones[from]}, {t: 1, zone: fragmented.zones[to]}
      ]}]]))[0])[1]);
    reorderedExpected.push(translations.map_content_way_route_near.replace('__location__', translations.map_content_loc_full_center));
    assert.strictEqual(lines(render(reordered)[0])[1], reorderedExpected.join('; '),
      locale + ': reordered/repeated fixture retains first direction and unrelated standalone location');
    if (locale === 'en') {
      assert.strictEqual(actualRoute, fragmented.expectedEnglish);
      // Establish that the fixture reproduces the original exact-text-only failure.
      const oldClauses = fragmentedData.A.subclasses[0].groups[0].visibleGeometry.map(bucket =>
        lines(render(payload('A1_secondary_roads', [bucket.segments]))[0])[1]);
      assert.strictEqual(new Set(oldClauses).size, 10);
    }
    for (const key of ['A1_local_streets', 'A1_service_roads', 'A2_footpaths_trails', 'A2_cycleways']) {
      const one = lines(render(payload(key, [[first]]))[0]);
      const two = lines(render(payload(key, [[second]]))[0]);
      assert(one[1] && two[1] && one[1] !== two[1]);
      for (const buckets of [[[first, second, first]], [[first], [second], [first]]]) {
        const actual = lines(render(payload(key, buckets))[0]);
        assert.strictEqual(actual[1], one[1] + '; ' + two[1], locale + ': retain distinct routes once');
        assert(actual[2].includes(translations.map_content_edge_west));
        assert(actual[2].includes(translations.map_content_edge_north), locale + ': later edge retained');
        assert.strictEqual(actual.filter(line => line.includes('Cross Street')).length, 1);
      }
      const repeated = lines(render(payload(key, [[first, first]]))[0]);
      assert.strictEqual(repeated[1], one[1]);
      assert.strictEqual(repeated[2], one[2], 'duplicate edges do not become multiple locations');
      const reverse = {events: first.events.map(event => ({...event, t: 1 - event.t})).reverse()};
      const standalone = zone => ({events: [{t: 0, zone}, {t: 1, zone}]});
      const startOnly = standalone(first.events[0].zone);
      const endOnly = standalone(first.events[first.events.length - 1].zone);
      const unrelated = standalone({kind: 'part', dir: 'southwest'});
      const unrelatedText = lines(render(payload(key, [[unrelated]]))[0])[1];
      const compact = lines(render(payload(key, [[startOnly, first], [reverse, endOnly, unrelated]]))[0]);
      assert.strictEqual(compact[1].toLocaleLowerCase(locale), (one[1] + '; ' + unrelatedText).toLocaleLowerCase(locale),
        locale + ': reversed pairs and covered standalone locations are redundant');
      const singleText = lines(render(payload(key, [[startOnly]]))[0])[1];
      assert(!singleText.includes(translations.map_content_way_route_from_to.split('__')[0]),
        locale + ': a single region is not a route, even with different from/to grammar');
      const emptyFirst = lines(render(payload(key, [[{events: []}, second]]))[0]);
      assert.strictEqual(emptyFirst[1], two[1]);
      assert.strictEqual(emptyFirst[2], two[2]);
      const absent = lines(render(payload(key, [[{events: []}]]))[0]);
      assert(!absent.some(line => line.includes('undefined') || line.includes('__')));
    }
  }
  // Verify same-name groups merged by the renderer also retain both locations.
  const data = payload('A1_local_streets', [[first]]);
  const other = payload('A1_local_streets', [[second]]).A.subclasses[0].groups[0];
  other.ways[0].osmId = 2;
  other.visibleGeometry[0].osmId = 2;
  data.A.subclasses[0].groups.push(other);
  const merged = sandbox.window.TM.mapDescWays.buildModel(data, {t: (key, fallback) => fallback});
  assert.strictEqual(merged.length, 1);
  assert(lines(merged[0])[1].includes('; '));
  console.log('Multi-segment route and edge descriptions passed in all locales');
}

module.exports = {payload, segment};
if (require.main === module) check();
