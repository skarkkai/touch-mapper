'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '../..');
const preview = fs.readFileSync(path.join(root, 'web/src/scripts/model-preview.js'), 'utf8');
const three = fs.readFileSync(path.join(root, 'web/src/scripts/vendor-other/three-r182.module.js'), 'utf8');
// Run the real renderer sizing method without requiring a WebGL context.
const sizing = three.slice(three.indexOf('this.setSize = function ( width, height, updateStyle'), three.indexOf('\n\t\t};', three.indexOf('this.setSize = function ( width, height, updateStyle')) + 6);
const initial = preview.match(/renderer\.setPixelRatio\([\s\S]*?renderer\.setSize\([^;]+;/)[0];
const resize = preview.match(/function updateSize\(\) \{[\s\S]*?\n          \}/)[0];
for (const dpr of [1, 2, 3]) {
  const canvas = { style: {} };
  const context = vm.createContext({
    canvas, xr: { isPresenting: false }, output: null, _pixelRatio: dpr,
    _width: 0, _height: 0,
    window: { devicePixelRatio: dpr },
    size: { width: 510, height: 352 }, elem: {},
    camera: { updateProjectionMatrix() {} },
    readSize() { return { width: 320, height: 240 }; }
  });
  vm.runInContext('var renderer = { setViewport() {}, setPixelRatio(value) { _pixelRatio = value; } }; (function() {' + sizing + '}).call(renderer);', context);
  vm.runInContext(initial, context);
  assert.strictEqual(canvas.style.width, '510px');
  assert.strictEqual(canvas.style.height, '352px');
  assert.strictEqual(canvas.width, 510 * Math.min(dpr, 2));
  assert.strictEqual(canvas.height, 352 * Math.min(dpr, 2));
  vm.runInContext(resize + '; updateSize();', context);
  assert.strictEqual(canvas.style.width, '320px');
  assert.strictEqual(canvas.style.height, '240px');
  assert.strictEqual(canvas.width, 320 * Math.min(dpr, 2));
  assert.strictEqual(canvas.height, 240 * Math.min(dpr, 2));
  assert.strictEqual(context.camera.aspect, 320 / 240);
}
console.log('3D preview sizing passed at DPR 1, 2 and capped 3, initial load and resize');
