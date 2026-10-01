'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');
const {chromium} = require('playwright');

// Inspect the real editors, submitted requests, and generated result views offline.
async function main() {
  const repo = path.resolve(__dirname, '../..');
  const screenshots = path.join(repo, '.tmp/print-heights/screenshots');
  execFileSync('python3', [path.join(repo, 'bin/tmpctl'), 'mkdir', screenshots]);
  const browser = await chromium.launch({headless: true});
  const errors = [];
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 1100}});
    page.on('pageerror', error => errors.push(String(error)));
    await page.addInitScript(() => {
      window.TM_REGION = 'eu-west-1';
      window.TM_MAP_REQUEST_SQS_QUEUE = 'http://127.0.0.1:9000/mock-queue';
    });
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
      ? route.continue() : route.abort());
    const base = 'http://127.0.0.1:9000';
    async function capture() {
      return page.evaluate(() => {
        let captured;
        const original = $.ajax;
        $.ajax = options => {
          const deferred = $.Deferred();
          if (options.url.includes('ipify')) deferred.resolve({ip: '127.0.0.1'});
          else if (options.url.includes('Action=SendMessage')) captured = JSON.parse(new URL(options.url).searchParams.get('MessageBody'));
          return deferred.promise();
        };
        try { submitMapCreation(); } finally { $.ajax = original; $('#submit-button').prop('disabled', false); }
        return captured;
      });
    }
    for (const lang of ['en', 'fi', 'de', 'es', 'nl']) {
      await page.goto(base + '/' + lang + '/area?origin=BlindSquare&lat=60.001&lon=24.002&addrName=Heights&size=17&advancedMode=true');
      await page.waitForFunction(() => window.data && data.get('roadHeightMm') !== undefined);
      assert(await page.locator('#print-heights').isVisible());
      assert.deepStrictEqual(await page.locator('#print-heights .height-input-row > label').evaluateAll(labels => labels.map(label => label.id)),
        ['paths-height-label', 'roads-height-label', 'railways-height-label', 'buildings-height-label']);
      assert(!/0[.,]01 mm/.test(await page.locator('#print-heights').innerText()), 'internal railway offset is not shown in the editor');
      for (const section of ['roads', 'paths', 'buildings', 'railways']) {
        const inches = page.locator('#' + section + '-height-inches');
        for (const typed of [null, '0.12']) {
          if (typed !== null) await inches.fill(typed);
          const before = Number(await inches.inputValue());
          assert(await inches.evaluate(input => input.checkValidity()));
          await inches.press('ArrowUp');
          assert(Math.abs(Number(await inches.inputValue()) - before - 0.05) < 1e-9);
          await inches.press('ArrowDown');
          assert(Math.abs(Number(await inches.inputValue()) - before) < 1e-9);
          assert(await inches.evaluate(input => input.checkValidity()));
        }
      }
      const groupBox = await page.locator('#print-heights').boundingBox();
      for (const input of await page.locator('#print-heights input').all()) {
        const box = await input.boundingBox();
        assert(box.x >= groupBox.x && box.x + box.width <= groupBox.x + groupBox.width, 'height control clipped');
      }
      await page.locator('#roads-height-inches').fill('2');
      assert.strictEqual(await page.locator('#roads-height-mm').inputValue(), '50.8');
      await page.locator('#paths-height-mm').fill('0.01');
      await page.locator('#buildings-height-mm').fill('0');
      await page.locator('#railways-height-mm').fill('50');
      let request = await capture();
      assert(request);
      assert.strictEqual(request.roadHeightMm, 50.8);
      assert.strictEqual(request.pathHeightMm, 0);
      assert.strictEqual(request.buildingHeightMm, 0);
      assert.strictEqual(request.railwayHeightMm, 50);
      await page.locator('#roads-height-mm').fill('50.8');
      assert.strictEqual(await capture(), undefined);
      assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'roads-height-mm');
      assert(await page.locator('#roads-height-error').isVisible());
      if (lang === 'en') await page.locator('#print-heights').screenshot({path: path.join(screenshots, 'invalid-focus.png')});
      await page.locator('#roads-height-mm').fill('3');
      await page.locator('#paths-height-inches').fill('0.003937');
      assert.strictEqual(await capture(), undefined, 'rounded below-minimum inches are invalid when edited');
      await page.locator('#paths-height-mm').fill('0.1');
      assert(await page.locator('#paths-height-inches').evaluate(input => input.checkValidity()),
        'converted minimum must remain valid with the native inch step');
      assert(await capture());
      await page.uncheck('#advanced-input');
      assert(await capture(), 'valid hidden heights still submit');
      await page.check('#advanced-input');
      await page.locator('#paths-height-mm').fill('0');
      await page.locator('#buildings-height-mm').fill('5');
      await page.locator('#railways-height-mm').fill('3');
      request = await capture();
      await page.reload();
      await page.waitForFunction(() => data.get('roadHeightMm') === 3);
      assert.strictEqual(await page.locator('#railways-height-mm').inputValue(), '3');
      await page.check('#printing-tech-2d');
      assert(!(await page.locator('#print-heights').isVisible()));
      const flat = await capture();
      assert.strictEqual(flat.roadHeightMm, .82);
      assert.strictEqual(flat.pathHeightMm, 1.5);
      await page.check('#printing-tech-3d');
      assert.strictEqual(await page.locator('#paths-height-mm').inputValue(), '0');
      await page.evaluate(info => storeMapSettingsFromInfo(info), request);
      await page.reload();
      await page.waitForFunction(() => data.get('buildingHeightMm') === 5);
      await page.locator('#roads-height-inches').fill('2.5');
      assert.strictEqual(await capture(), undefined);
      const reset = page.locator('#reset-print-heights');
      await reset.click();
      const defaults = {roads: .82, paths: 1.5, buildings: 2.9, railways: .81};
      const restored = await capture();
      for (const [section, value] of Object.entries(defaults)) {
        assert.strictEqual(Number(await page.locator('#' + section + '-height-mm').inputValue()), value);
        assert(!(await page.locator('#' + section + '-height-error').isVisible()));
        const key = section === 'railways' ? 'railwayHeightMm' : section.slice(0, -1) + 'HeightMm';
        assert.strictEqual(restored[key], value);
      }
      await page.reload();
      await page.waitForFunction(() => data.get('roadHeightMm') === .82);
      const resetBox = await reset.boundingBox();
      const heightBox = await page.locator('#print-heights').boundingBox();
      assert(Math.abs(resetBox.x + resetBox.width - heightBox.x - heightBox.width) < 20, 'reset aligned to the right');
      if (lang === 'en') {
        await page.locator('#roads-height-mm').focus();
        await page.keyboard.press('Tab');
        assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'roads-height-inches');
        await page.locator('#buildings-height-inches').focus();
        await page.keyboard.press('Tab');
        assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'reset-print-heights');
        await page.locator('#print-heights').screenshot({path: path.join(screenshots, 'settings-desktop.png')});
      }
      console.log('PASS editor, units, errors, persistence, and request: ' + lang);
    }
    await page.setViewportSize({width: 390, height: 900});
    await page.locator('#print-heights').screenshot({path: path.join(screenshots, 'settings-narrow.png')});
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    // Serve a real tall-model fixture through the usual result-page fetches.
    const folder = path.join(repo, '.tmp/print-heights/maximum');
    const info = JSON.parse(fs.readFileSync(path.join(folder, 'info.json')));
    await page.route('**/map/info/*.json', route => route.fulfill({json: info, headers: {'Access-Control-Allow-Origin': '*'}}));
    await page.route('**/map/data/**', async route => {
      const url = new URL(route.request().url());
      const suffix = ['.map-content.json', '.stl', '.svg', '.pdf'].find(ext => url.pathname.endsWith(ext));
      const file = suffix === '.map-content.json' ? 'map-content.json' : 'map' + suffix;
      if (suffix && fs.existsSync(path.join(folder, file))) {
        await route.fulfill({headers: {'Access-Control-Allow-Origin': '*'}, body: fs.readFileSync(path.join(folder, file)), contentType:
          suffix === '.map-content.json' ? 'application/json' : suffix === '.stl' ? 'application/sla' : 'image/svg+xml'});
      } else await route.abort();
    });
    await page.setViewportSize({width: 1280, height: 1100});
    await page.goto(base + '/en/map?map=B123456789abcdef');
    await page.locator('.map-content-summary-toggle').click();
    await page.waitForFunction(() => document.querySelector('.map-content-roads-row .map-content-section-height')?.textContent.includes('50.8'), null, {timeout: 15000}).catch(async error => {
      await page.screenshot({path: path.join(screenshots, 'result-failure.png'), fullPage: true});
      console.error(await page.locator('body').innerText(), errors);
      throw error;
    });
    assert((await page.locator('.map-content-railways-row .map-content-section-height').textContent()).includes('50.79'));
    await page.screenshot({path: path.join(screenshots, 'result-desktop.png'), fullPage: true});
    assert.deepStrictEqual(errors, []);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
