'use strict';
// Exercise geometry and compatibility through the browser's real helper functions.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const storage = {removeItem(key) { delete this[key]; }};
const context = {window: {location: {protocol: 'https:'}, localStorage: storage},
  localStorage: storage, TM_DOMAIN: 'example.com', TM_REGION: 'eu-west-1',
  mapCalc: {metersPerDegree: () => ({lon: 50000, lat: 100000})}};
vm.createContext(context);
vm.runInContext(fs.readFileSync('web/src/scripts/util.js', 'utf8'), context);
const norm = value => JSON.parse(JSON.stringify(context.normalizePrintDimensions(value)));
assert.deepStrictEqual(norm({size: 1}), {printWidthCm: 1, printHeightCm: 1});
assert.deepStrictEqual(norm({printWidthCm: 1, printHeightCm: 99.9}), {printWidthCm: 1, printHeightCm: 99.9});
assert.deepStrictEqual(norm({size: 17}), {printWidthCm: 17, printHeightCm: 17});
assert.deepStrictEqual(norm({size: 17, printWidthCm: 20, printHeightCm: 10}), {printWidthCm: 20, printHeightCm: 10});
for (const input of [{size: 17, printWidthCm: 20}, {printHeightCm: 10}, {size: 0}, {size: -1},
  {size: 0.9}, {printWidthCm: 0.9, printHeightCm: 10}, {printWidthCm: 10, printHeightCm: 0.9},
  {size: Infinity}, {size: 100}, {size: true}, {size: ''}]) assert.throws(() => norm(input));
for (const [width, height] of [[20, 10], [10, 20], [17, 17]]) {
  const values = {printWidthCm: width, printHeightCm: height, scale: 2400,
    lat: 60, lon: 24, offsetX: 0, offsetY: 0, multipartXpc: 100, multipartYpc: 100};
  const model = {get: key => values[key]};
  const dimensions = context.mapDimensionsMeters(model);
  assert(Math.abs(dimensions.width - width * 24) < 1e-9);
  assert(Math.abs(dimensions.height - height * 24) < 1e-9);
  const center = context.computeLonLat(model);
  assert(Math.abs((center[0] - 24) * 50000 - width * 24) < 1e-8);
  assert(Math.abs((center[1] - 60) * 100000 - height * 24) < 1e-8);
}
// A matrix of independent axes, scales, hemispheres and shifts catches coupling
// without pinning entire request objects to one example.
vm.runInContext(fs.readFileSync('web/src/scripts/map-calc.js', 'utf8'), context);
context.mapCalc = context.window.mapCalc;
for (const [width, height] of [[1, 99.9], [99.9, 1], [12.5, 8], [17, 17]]) {
  for (const scale of [500, 2400, 10000]) {
    for (const lat of [-60, 0, 60]) {
      const values = {printWidthCm: width, printHeightCm: height, scale, lat, lon: 24,
        offsetX: 3, offsetY: -2, multipartXpc: 0, multipartYpc: 0};
      const model = {get: key => values[key]};
      const center = context.computeLonLat(model);
      const meters = context.mapCalc.metersPerDegree(lat);
      const coverage = context.mapDimensionsMeters(model);
      assert(Math.abs(coverage.width / coverage.height - width / height) < 1e-9);
      for (const shift of [-100, -10, 10, 100]) {
        values.multipartXpc = shift;
        values.multipartYpc = 0;
        let shifted = context.computeLonLat(model);
        assert.strictEqual(shifted[1], center[1], 'X shift must not move latitude');
        assert(Math.abs((shifted[0] - center[0]) * meters.lon - coverage.width * shift / 100) < 1e-6);
        values.multipartXpc = 0;
        values.multipartYpc = shift;
        shifted = context.computeLonLat(model);
        assert.strictEqual(shifted[0], center[0], 'Y shift must not move longitude');
        assert(Math.abs((shifted[1] - center[1]) * meters.lat - coverage.height * shift / 100) < 1e-6);
      }
    }
  }
}
context.window.storeMapSettingsFromInfo({size: 17, scale: 2400});
assert.strictEqual(storage.printWidthCm, 17);
assert.strictEqual(storage.printHeightCm, 17);
context.window.storeMapSettingsFromInfo({printWidthCm: 20, printHeightCm: 10, scale: 2400});
assert.strictEqual(storage.printWidthCm, 20);
assert.strictEqual(storage.printHeightCm, 10);
assert.strictEqual(storage.advancedMode, true);
// Equal physical areas have the same target road length irrespective of aspect ratio.
const pruner = require('../../converter/prune-only-big-roads.js');
assert.strictEqual(pruner.computeTargetRoadLengthMeters(20, 10, 2400, 1.2), 5760);
assert.strictEqual(pruner.computeTargetRoadLengthMeters(10, 20, 2400, 1.2), 5760);
assert.strictEqual(pruner.computeTargetRoadLengthMeters(25, 8, 2400, 1.2), 5760);
console.log('Browser dimensions, legacy metadata, multipart movement and density passed');
