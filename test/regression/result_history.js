'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync('web/src/scripts/map.js', 'utf8');
const start = source.indexOf('function initMapHistory(');
const end = source.indexOf('function infoLoadHandler(', start);

// Run the actual result-page history controls with observable visibility/clicks.
for (const saved of [true, false]) {
  for (const ok of [true, false]) {
    const controls = {};
    let writes = 0;
    const $ = selector => controls[selector] || (controls[selector] = {
      hidden: true,
      removeAttr() { this.hidden = false; return this; },
      attr() { this.hidden = true; return this; },
      off() { return this; },
      on(event, handler) { this.click = handler; return this; }
    });
    const history = {
      find: () => saved,
      markReady: () => { writes++; return {ok}; },
      saveShared: () => { writes++; return {ok}; }
    };
    vm.runInNewContext(source.slice(start, end) + 'initMapHistory({requestId: "B123/map"});',
      {$, TMMapHistory: history});
    assert.strictEqual(writes, saved ? 1 : 0, 'opening a shared map never saves automatically');
    assert.strictEqual($('.map-history-save-error').hidden, !saved || ok);
    assert(!controls['.map-history-saved'], 'no routine saved confirmation');
    if (!saved) {
      assert.strictEqual($('.map-history-save-shared').hidden, false);
      $('#save-map-to-history').click();
      assert.strictEqual(writes, 1);
      assert.strictEqual($('.map-history-save-error').hidden, ok);
      assert.strictEqual($('.map-history-save-shared').hidden, ok);
    }
  }
}
console.log('Result history reports only attempted-save failures');
