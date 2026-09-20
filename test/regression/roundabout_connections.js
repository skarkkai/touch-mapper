'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const repo = path.resolve(__dirname, '../..');
const data = JSON.parse(fs.readFileSync(process.argv[2]));
const sandbox = {window: {TM: {}, location: {pathname: '/en/map'}}, console};
vm.createContext(sandbox);
for (const file of ['converter/road-names.js', 'web/src/scripts/map-desc-ways.js']) {
  vm.runInContext(fs.readFileSync(path.join(repo, file), 'utf8'), sandbox);
}
for (const locale of ['en', 'fi', 'de', 'es', 'nl']) {
  const translations = JSON.parse(fs.readFileSync(path.join(repo, 'web/locales', locale, 'tm.json')));
  const render = input => sandbox.window.TM.mapDescWays.buildModel(input,
    {t: (key, fallback) => translations[key] || fallback}, {section: 'roads'});
  const item = (items, name) => items.find(entry => entry.summaryTitle.includes(name));
  const lines = entry => Array.from(entry.lines, line => line.parts.map(part => part.text).join(''));
  const result = render(data);
  const first = lines(item(result, 'First Road'));
  const second = lines(item(result, 'Second Road'));
  const roundaboutText = translations.map_content_connects_to_roundabout;
  assert.strictEqual(first.filter(line => line === roundaboutText).length, 1);
  assert.strictEqual(second.filter(line => line === roundaboutText).length, 1);
  assert(!first.some(line => line.includes('Side Street')), 'No invented connection across roundabout');
  assert(second.includes(translations.map_content_connects_to_way.replace('__way__', 'Side Street')));
  assert(!first.some(line => line === translations.map_content_connects_to_type_many
    .replace('__count__', '2').replace('__type__', translations.map_content_way_type_plural_A1_secondary_roads)),
    'Roundabout segments must not also be counted as roads');
  assert(lines(item(result, 'Bridge Road')).includes(
    translations.map_content_connects_to_roundabouts.replace('__count__', '2')),
    'Distinct roundabouts joined by a road are counted separately');
  assert.deepStrictEqual(Array.from(item(result, 'First Road').attrs.filterRefs), ['way:1']);

  const named = JSON.parse(JSON.stringify(data));
  for (const group of named.A.subclasses[0].groups) {
    for (const bucket of group.visibleGeometry) for (const segment of bucket.segments) {
      for (const event of segment.events) for (const contact of event.connections || []) {
        if (contact.roundabout && contact.roundabout.id === 'roundabout:way:10') {
          contact.roundabout.name = 'Central Circle';
        }
      }
    }
  }
  const namedFirst = lines(item(render(named), 'First Road'));
  assert(namedFirst.includes(translations.map_content_connects_to_named_roundabout.replace('__name__', 'Central Circle')));
  assert(!namedFirst.includes(roundaboutText));
}
console.log('Split roundabout identity and localized connection descriptions passed');
