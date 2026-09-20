'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.resolve(__dirname, '../..');

// Minimal DOM records the production card renderer's semantic structure offline.
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.value = ''; }
  set textContent(value) { this.children = []; this.value = value; }
  get textContent() { return this.value + this.children.map(child => child.textContent).join(''); }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); return child; }
  prepend(...children) { this.children.unshift(...children); }
  insertBefore(child, reference) { this.children.splice(this.children.indexOf(reference), 0, child); }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener() {}
}
const page = new Element('div');
const strings = JSON.parse(fs.readFileSync(path.join(root, 'web/locales/en/tm.json')));
const template = fs.readFileSync(path.join(root, 'web/pre-src/maps.pre'), 'utf8');
for (const match of template.matchAll(/data-([\w-]+)="{{ (\w+) }}"/g)) {
  page.dataset[match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = strings[match[2]];
}
const context = {
  window: {}, Intl, Date, console,
  TMMapHistory: {displayName: record => record.name || record.addressShort},
  document: {
    documentElement: {lang: 'en'},
    querySelector: () => page,
    getElementById: () => new Element('div'),
    createElement: tag => new Element(tag),
    createElementNS: (_, tag) => new Element(tag),
    createTextNode: value => { const node = new Element('#text'); node.textContent = value; return node; }
  }
};
let source = fs.readFileSync(path.join(root, 'web/src/scripts/maps.js'), 'utf8');
// Stop before page startup; exercise the real renderer without network or browser.
source = source.slice(0, source.lastIndexOf('\n  render();')) + '\n  window.renderCard = renderRecord; window.formatDate = formattedDate;\n})();';
vm.runInNewContext(source, context);
function all(node) { return [node, ...node.children.flatMap(all)]; }
function byClass(node, name) { return all(node).filter(el => (el.className || '').split(' ').includes(name)); }
const record = {id: 'Bcard', addressShort: 'Kaapelitehdas', addressLong: 'Kaapelitehdas, Helsinki',
  status: 'ready', createdAt: new Date().toISOString(), request: {
    printWidthCm: 99, printHeightCm: 1, scale: 2400, printingTech: '3d', contentMode: 'only-big-roads'
  }};
let card = context.window.renderCard(record);
assert.strictEqual(all(card).find(el => el.tag === 'h3').textContent, 'Kaapelitehdas');
assert.strictEqual(byClass(card, 'my-map-address')[0].textContent, ', Helsinki');
assert.strictEqual(byClass(card, 'my-map-details')[0].tag, 'ul');
assert.match(byClass(card, 'my-map-time')[0].textContent, /^A few moments ago \(.+\)$/);
const printing = byClass(card, 'my-map-printing')[0];
assert.match(printing.textContent, /99 × 1 cm.*1:2400.*3D printing/);
assert.strictEqual(byClass(printing, 'visuallyhidden').length, 3);
assert.strictEqual(byClass(card, 'my-map-content').length, 1);
assert.match(byClass(card, 'edit-action')[0].attrs['aria-label'], /Kaapelitehdas/);
assert.match(byClass(card, 'remove-action')[0].attrs['aria-label'], /Kaapelitehdas/);
assert.strictEqual(byClass(card, 'remove-action')[0].textContent, '');
record.request.multipartMode = true;
card = context.window.renderCard(record);
assert.strictEqual(byClass(card, 'my-map-content').length, 0);
assert.strictEqual(byClass(card, 'my-map-printing').length, 1, 'multipart keeps size/scale/printing');
assert.match(byClass(card, 'my-map-multipart')[0].textContent, /Multipart map.*X 0%.*Y 0%/);
const finnish = JSON.parse(fs.readFileSync(path.join(root, 'web/locales/fi/tm.json')));
page.dataset.multipart = finnish.multipart_map;
page.dataset.partShift = finnish.my_maps_part_shift;
assert.strictEqual(byClass(context.window.renderCard(record), 'my-map-multipart')[0].textContent,
  'Moniosainen kartta. Osan siirto X 0 %, Y 0 %');
page.dataset.multipart = strings.multipart_map;
page.dataset.partShift = strings.my_maps_part_shift;
for (const locale of ['en', 'de', 'es', 'fi', 'nl']) {
  const translated = JSON.parse(fs.readFileSync(path.join(root, 'web/locales', locale, 'tm.json')));
  assert(translated.my_maps_part_shift.startsWith('__multipart__. '));
  assert(!translated.my_maps_part_shift.includes(':'));
}
record.request.multipartXpc = 100;
record.request.multipartYpc = -10;
record.request.coordinatesAdjusted = true;
record.request.lat = 60.1;
record.request.lon = 24.2;
card = context.window.renderCard(record);
assert.match(byClass(card, 'my-map-multipart')[0].textContent, /X 100%.*Y -10%/);
assert.match(byClass(card, 'my-map-coordinates')[0].textContent, /Coordinates adjusted.*60.1.*24.2/);
record.request.coordinatesAdjusted = false;
record.request.offsetX = 5;
card = context.window.renderCard(record);
assert.match(byClass(card, 'my-map-offset')[0].textContent, /X 5 m.*Y 0 m/);
assert.match(byClass(card, 'my-map-coordinates')[0].textContent, /Reference coordinates/);
record.request.multipartMode = false;
record.request.contentMode = 'normal';
record.name = 'School route';
card = context.window.renderCard(record);
assert.strictEqual(byClass(card, 'my-map-content').length, 0);
assert.strictEqual(all(card).find(el => el.tag === 'h3').textContent, 'School route');
assert.strictEqual(byClass(card, 'my-map-address')[0].textContent, ', Kaapelitehdas, Helsinki');
const fixed = new Date(2026, 8, 20, 18).getTime();
context.Date = class extends Date {
  constructor(...args) { super(...(args.length ? args : [fixed])); }
  static now() { return fixed; }
};
for (const [minutes, label] of [[0, 'A few moments ago'], [1, '1 minute ago'], [5, '5 minutes ago'],
  [59, '59 minutes ago'], [60, 'An hour ago'], [119, 'An hour ago'], [120, '2 hours ago'],
  [300, '5 hours ago'], [360, '6 hours ago'], [720, '12 hours ago'],
  [1380, '23 hours ago'], [1439, '23 hours ago'], [1440, 'Yesterday'], [4320, '3 days ago'],
  [21600, '15 days ago'], [191520, '133 days ago']]) {
  assert(context.window.formatDate(new Date(fixed - minutes * 60000).toISOString()).startsWith(label + ' ('), label);
}
console.log('Map card presentation passed');
