'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const {payload} = require('./way_segments');
const english = JSON.parse(fs.readFileSync('web/locales/en/tm.json'));
const types = Object.keys(english).filter(key => key.startsWith('map_content_way_type_A'))
  .map(key => key.slice('map_content_way_type_'.length));
const template = fs.readFileSync('web/pre-src/map.pre', 'utf8');
const injected = new Set(Array.from(template.matchAll(/"(map_content_[^"]+)":/g), match => match[1]));
const sandbox = {window: {TM: {}, location: {pathname: '/en/map'}}, console};
vm.createContext(sandbox);
for (const file of ['converter/road-names.js', 'web/src/scripts/map-desc-ways.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox);
}

// Use only template-injected translations, matching the browser's limited dictionary.
for (const locale of ['en', 'fi', 'de', 'es', 'nl']) {
  const dictionary = JSON.parse(fs.readFileSync('web/locales/' + locale + '/tm.json'));
  const render = data => sandbox.window.TM.mapDescWays.buildModel(data,
    {t: (key, fallback) => injected.has(key) ? dictionary[key] || fallback : fallback});
  for (const type of types) {
    const key = 'map_content_way_type_plural_' + type;
    assert(dictionary[key], locale + ': missing ' + key);
    assert(injected.has(key), 'Browser dictionary omits ' + key);
    const data = payload('A1_local_streets', [[{events: [{type: 'junction', t: 0,
      connections: [10, 11, 12].map(osmId => ({osmType: 'way', osmId, subClass: type}))}]}]]);
    const lines = render(data)[0].lines.map(line => line.parts.map(part => part.text).join(''));
    const expected = dictionary.map_content_connects_to_type_many
      .replace('__count__', '3').replace('__type__', dictionary[key]);
    if (type.startsWith('A3_')) {
      assert(!lines.includes(expected), 'Railway junction narration remains suppressed');
    } else {
      assert(lines.includes(expected), locale + ': missing plural connection for ' + type);
      assert(!lines.some(line => line.includes('__')), 'No unresolved placeholders');
    }
    if (locale === 'en' && type === 'A1_secondary_roads') {
      assert(lines.includes('Connects to 3 secondary roads'));
    }
  }
}
console.log('All way types have browser-accessible plural labels in every locale');
