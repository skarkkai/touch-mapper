'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../web/src/scripts/util.js'), 'utf8');
const history = JSON.stringify({maps: [{requestId: 'B123/example'}]});

// Browser Storage stringifies property assignments, including undefined from old metadata.
function createStorage(initial) {
  const values = Object.create(null);
  const storage = new Proxy(values, {
    set(target, key, value) { target[key] = String(value); return true; }
  });
  Object.assign(storage, {'tm-map-history-v1': history, scale: 2400}, initial);
  return storage;
}

// Reload the real browser helpers against the same stored data to check durable recovery.
function load(storage) {
  const context = {
    window: {location: {protocol: 'https:'}, localStorage: storage},
    localStorage: storage, TM_DOMAIN: 'example.test', TM_REGION: 'eu-west-1'
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

function check(initial, defaultSize, width, height) {
  const storage = createStorage(initial);
  const expected = {printWidthCm: width, printHeightCm: height};
  for (let visit = 0; visit < 2; visit++) {
    const actual = load(storage).getStoredPrintDimensions(defaultSize);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(actual)), expected,
      'stored settings ' + JSON.stringify(initial) + ', default ' + defaultSize + ', visit ' + visit);
    assert.strictEqual(storage.printWidthCm, String(width));
    assert.strictEqual(storage.printHeightCm, String(height));
    assert.strictEqual(storage['tm-map-history-v1'], history, 'recovery must preserve My Maps');
    assert.strictEqual(storage.scale, '2400', 'recovery must preserve unrelated settings');
  }
}

for (const defaultSize of [17, 20, 27.9]) {
  check({}, defaultSize, defaultSize, defaultSize);
  check({size: 12.5}, defaultSize, 12.5, 12.5);
  check({printWidthCm: 20, printHeightCm: 10}, defaultSize, 20, 10);
  check({size: 'undefined', printWidthCm: 1, printHeightCm: 99.9}, defaultSize, 1, 99.9);
  check({size: 17, printWidthCm: 12.5, printHeightCm: 8}, defaultSize, 12.5, 8);

  for (const size of [undefined, 'null', 'NaN', 'Infinity', 'abc', 0, -1, 0.9, 100]) {
    check({size}, defaultSize, defaultSize, defaultSize);
  }
  for (const axis of ['printWidthCm', 'printHeightCm']) {
    check({[axis]: 12.5}, defaultSize, defaultSize, defaultSize);
    check({size: 12.5, [axis]: 12.5}, defaultSize, defaultSize, defaultSize);
    for (const invalid of [undefined, null, '', 'undefined', 'NaN', 'abc', Infinity, 0, 0.9, 100]) {
      check({size: 12.5, printWidthCm: 20, printHeightCm: 10, [axis]: invalid},
        defaultSize, defaultSize, defaultSize);
    }
  }
}

// Forgiving stored preferences must not relax validation of explicit map dimensions.
const context = load(createStorage({}));
for (const input of [
  {size: 17, printWidthCm: 20}, {size: 17, printHeightCm: 10},
  {printWidthCm: 0, printHeightCm: 10}, {printWidthCm: 20, printHeightCm: 'undefined'}
]) {
  assert.throws(() => context.normalizePrintDimensions(input), {name: 'RangeError'});
}

console.log('Stored print dimensions recover durably while preserving valid preferences and map history');
