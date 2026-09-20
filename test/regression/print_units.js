'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

// Exercise the production two-way input binding without browser/network dependencies.
class Input {
  constructor(value, min, max) {
    this.value = value; this.handlers = {}; this[0] = this;
    this.checkValidity = () => this.value !== '' && Number(this.value) >= min && Number(this.value) <= max;
  }
  val(value) { if (value === undefined) return this.value; this.value = String(value); return this; }
  on(events, fn) { for (const event of events.split(' ')) this.handlers[event] = fn; }
  trigger(type) { if (this.handlers[type]) this.handlers[type].call(this, {type}); return this; }
}
const cm = new Input('20', 1, 99.9);
const inches = new Input('', .4, 39.3);
const model = {};
const source = fs.readFileSync(path.resolve(__dirname, '../../web/src/scripts/area.js'), 'utf8');
const start = source.indexOf('function initPrintUnitInputs(');
const end = source.indexOf('// Invalid dimensions', start);
const context = {$: selector => selector.endsWith('-inches') ? inches : cm,
  setData: (key, value) => { model[key] = value; }};
vm.runInNewContext(source.slice(start, end) + "\ninitPrintUnitInputs('Width', 'printWidthCm');", context);
assert.strictEqual(cm.val(), '20.0');
assert.strictEqual(inches.val(), '7.9');
inches.val('9.1').trigger('input');
assert.strictEqual(cm.val(), '23.1');
assert.strictEqual(model.printWidthCm, 23.1);
assert.strictEqual(inches.val(), '9.1');
cm.val('17').trigger('change');
assert.strictEqual(cm.val(), '17.0');
assert.strictEqual(inches.val(), '6.7');
inches.val('4').trigger('change');
assert.strictEqual(inches.val(), '4.0');
assert.strictEqual(cm.val(), '10.2');
inches.val('100').trigger('input');
assert.strictEqual(cm.val(), '10.2', 'invalid inches must not corrupt dimensions');
inches.val('').trigger('input');
assert.strictEqual(cm.val(), '');
cm.val('99.9').trigger('change');
assert.strictEqual(inches.val(), '39.3');
assert.strictEqual(model.printWidthCm, 99.9);
console.log('Centimetre/inch input synchronization passed');
