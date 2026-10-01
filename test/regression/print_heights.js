'use strict';
// Exercise the production editor and result formatter without browser/network dependencies.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const storage = {};
const elements = {};
class Input {
  constructor() { this.value = ''; this.handlers = {}; this.attributes = {}; this.hidden = true; }
  addEventListener(type, callback) { this.handlers[type] = callback; }
  setCustomValidity(message) { this.error = message; }
  setAttribute(key, value) { this.attributes[key] = value; }
  focus() { this.focused = true; }
  reportValidity() { return !this.error; }
  edit(value) { this.value = String(value); this.handlers.input({type: 'input', currentTarget: this}); }
}
const values = {};
const context = {window: {localStorage: storage, location: {protocol: 'http:'}}, localStorage: storage, TM_DOMAIN: 'example.test', TM_REGION: 'eu-west-1', document: {getElementById: id => elements[id]},
  setData: (key, value) => { values[key] = value; storage[key] = String(value); },
  $: () => ({prop: () => true})};
vm.createContext(context);
vm.runInContext(fs.readFileSync('web/src/scripts/util.js', 'utf8'), context);
const api = context.window.TMPrintHeights;
for (const [value, unit, valid] of [[0, 'mm', true], [.01, 'mm', true], [.010001, 'mm', false],
  [.099, 'mm', false], [.1, 'mm', true], [50, 'mm', true], [50.8, 'mm', false],
  [2, 'in', true], [2.001, 'in', false], [-1, 'mm', false], ['', 'mm', false], ['NaN', 'in', false]]) {
  assert.strictEqual(api.valid(value, unit), valid, `${value} ${unit}`);
}
assert.strictEqual(api.applied({roadHeightMm: 2, railwayHeightMm: 2}).railways, 1.99);
assert.strictEqual(api.applied({roadHeightMm: 0, railwayHeightMm: 2}).railways, 2);
for (const section of Object.keys(api.sections)) {
  for (const suffix of ['mm', 'inches', 'error']) elements[section + '-height-' + suffix] = new Input();
}
elements['reset-print-heights'] = new Input();
elements['print-heights'] = {dataset: {invalid: 'Invalid height'}};
const source = fs.readFileSync('web/src/scripts/area.js', 'utf8');
vm.runInContext(source.slice(source.indexOf('function initPrintHeightInputs()')), context);
context.initPrintHeightInputs();
const mm = elements['roads-height-mm'], inches = elements['roads-height-inches'];
assert.strictEqual(mm.value, '0.82');
inches.edit('2');
assert.strictEqual(values.roadHeightMm, 50.8);
assert.strictEqual(mm.value, '50.8');
assert(mm.validatePrintHeight(), 'converted millimetres must not invalidate two inches');
mm.edit('50.8');
assert(!mm.validatePrintHeight());
assert.strictEqual(elements['roads-height-error'].hidden, false);
mm.edit('.01');
assert.strictEqual(values.roadHeightMm, 0);
assert(mm.validatePrintHeight());
mm.edit('.1');
assert.strictEqual(inches.value, '0.004');
assert(mm.validatePrintHeight(), 'approximate inches must not replace the entered minimum');
inches.edit('1.123456');
assert.strictEqual(values.roadHeightMm, 28.52);
inches.handlers.change({type: 'change', currentTarget: inches});
assert.strictEqual(inches.value, '1.123');
assert.strictEqual(storage.roadHeightMm, '28.52');
mm.edit('3.14159');
mm.handlers.change({type: 'change', currentTarget: mm});
assert.strictEqual(mm.value, '3.14');
assert.strictEqual(inches.value, '0.124');
assert.strictEqual(storage.roadHeightMm, '3.14');
inches.edit('0.12');
assert.strictEqual(values.roadHeightMm, 3.05);
const canonical = values.roadHeightMm;
context.initPrintHeightInputs();
assert.strictEqual(values.roadHeightMm, canonical, 'reload preserves rounded settings');
for (const section of Object.keys(api.sections)) {
  elements[section + '-height-mm'].edit(0);
  assert.strictEqual(values[api.sections[section]], 0);
}
inches.edit('2.5');
assert(!mm.validatePrintHeight());
elements['reset-print-heights'].handlers.click();
for (const [section, key] of Object.entries(api.sections)) {
  const field = elements[section + '-height-mm'];
  const companion = elements[section + '-height-inches'];
  assert.strictEqual(values[key], api.defaults[key]);
  assert.strictEqual(storage[key], String(api.defaults[key]));
  assert.strictEqual(storage[key + 'Unit'], 'mm');
  assert.strictEqual(field.value, api.format(api.defaults[key]));
  assert.strictEqual(companion.value, api.format(api.defaults[key] / 25.4, 'in'));
  assert(field.validatePrintHeight(), 'reset clears invalid edits');
  assert.strictEqual(elements[section + '-height-error'].hidden, true);
  assert.strictEqual(field.attributes['aria-invalid'], 'false');
  assert.strictEqual(companion.attributes['aria-invalid'], 'false');
}
context.initPrintHeightInputs();
assert.strictEqual(values.roadHeightMm, .82, 'reset defaults survive reload');
// The real result model reads applied heights and localized strings in every locale.
for (const locale of ['en', 'fi', 'de', 'es', 'nl']) {
  const translations = JSON.parse(fs.readFileSync(`web/locales/${locale}/tm.json`));
  const sandbox = {window: {TM: {}, location: {pathname: `/${locale}/map`}}};
  vm.createContext(sandbox);
  for (const file of ['converter/road-names.js', 'web/src/scripts/map-desc-ways.js',
    'web/src/scripts/map-desc-areas.js', 'web/src/scripts/map-desc-pois.js', 'web/src/scripts/map-description.js']) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox);
  }
  const model = sandbox.window.TM.mapDescription.buildModel({metadata: {printHeightsMm:
    {roads: 50.8, paths: .1, buildings: 5, railways: 50.79}}}, {t: (key, fallback) => translations[key] || fallback});
  assert(model.ui.sectionHeightNotes.roads.includes('50.8'));
  assert(model.ui.sectionHeightNotes.roads.includes('2'));
  assert(model.ui.sectionHeightNotes.railways.includes('50.79'));
  assert(model.ui.sectionHeightNotes.paths.includes('0.004'));
  assert(!model.ui.sectionHeightNotes.paths.includes('__'));
}
console.log('Height unit limits, active-field validation, zero omission, persistence, and localized result notes passed');
