'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const repo = path.resolve(__dirname, '../..');

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
