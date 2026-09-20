'use strict';
const assert = require('assert');
const {chromium} = require('playwright');
const path = require('path');
const fs = require('fs');
const {execFileSync} = require('child_process');

// Check the real form, request geometry, persistence and bounded preview offline.
async function main() {
  const repo = path.resolve(__dirname, '../..');
  const out = path.join(repo, '.tmp/rectangular-maps');
  execFileSync(path.join(repo, 'bin/tmpctl'), ['mkdir', out]);
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 1100, height: 1000}});
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.addInitScript(() => {
      window.TM_REGION = 'eu-west-1';
      window.TM_MAP_REQUEST_SQS_QUEUE = 'http://127.0.0.1:9000/mock-queue';
    });
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
      ? route.continue() : route.abort());
    const base = 'http://127.0.0.1:9000';
    const url = base + '/en/area?origin=BlindSquare&lat=60.001&lon=24.002&addrName=Rectangle';
    await page.goto(url + '&size=17');
    await page.waitForFunction(() => window.data && data.get('printHeightCm') === 17);
    assert.strictEqual(await page.locator('#print-width-input').inputValue(), '17.0');
    // Legacy localStorage migrates without losing the square size.
    await page.evaluate(() => {
      localStorage.removeItem('printWidthCm'); localStorage.removeItem('printHeightCm'); localStorage.size = '20';
    });
    await page.goto(url);
    await page.waitForFunction(() => data.get('printWidthCm') === 20);
    assert.strictEqual(await page.locator('#print-height-input').inputValue(), '20.0');
    await page.check('#advanced-input');
    await page.locator('#print-width-inches').fill('9.1');
    await page.locator('#print-width-inches').press('Tab');
    assert.strictEqual(await page.locator('#print-width-input').inputValue(), '23.1');
    assert.strictEqual(await page.evaluate(() => data.get('printWidthCm')), 23.1);
    await page.locator('#print-width-input').fill('20');
    await page.locator('#print-width-input').press('Tab');
    assert.strictEqual(await page.locator('#print-width-inches').inputValue(), '7.9');
    assert.strictEqual(await page.locator('#print-width-input').inputValue(), '20.0');
    await page.locator('#print-height-inches').fill('4');
    await page.locator('#print-height-inches').press('Tab');
    assert.strictEqual(await page.locator('#print-height-input').inputValue(), '10.2');
    assert.strictEqual(await page.locator('#print-height-inches').inputValue(), '4.0');
    await page.locator('#lat-input').fill('60.25');
    await page.locator('#lat-input').press('Tab');
    assert.strictEqual(await page.evaluate(() => data.get('coordinatesAdjusted')), true);
    await page.locator('#lat-input').fill('60.001');
    await page.locator('#lat-input').press('Tab');
    assert.strictEqual(await page.evaluate(() => data.get('coordinatesAdjusted')), false);
    for (const axis of ['width', 'height']) {
      const field = page.locator('#print-' + axis + '-input');
      assert.strictEqual(await field.getAttribute('min'), '1');
      await field.fill('0.9');
      assert(await field.evaluate(input => input.validity.rangeUnderflow));
      await field.fill('1');
      assert(await field.evaluate(input => input.checkValidity()));
    }
    for (const [width, height] of [[20, 10], [10, 20], [99.9, 1], [1, 99.9], [17, 17]]) {
      await page.goto(url + '&printWidthCm=' + width + '&printHeightCm=' + height + '&size=17&advancedMode=true');
      await page.waitForFunction(([w, h]) => window.data && data.get('printWidthCm') === w && data.get('printHeightCm') === h, [width, height]);
      await page.locator('#print-height-input').focus();
      const box = await page.locator('#map-area-preview').boundingBox();
      assert(Math.abs(box.width / box.height - width / height) / (width / height) < .01, JSON.stringify(box));
      assert(box.height <= 501 && box.width <= 900, JSON.stringify(box));
      const capture = () => page.evaluate(() => {
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
      const request = await capture();
      assert(request);
      assert.strictEqual(request.printWidthCm, width);
      assert.strictEqual(request.printHeightCm, height);
      assert(!('size' in request) && !('diameter' in request));
      if (width === 20 && height === 10) {
        await page.locator('#lat-input').fill('60.25');
        await page.locator('#lat-input').press('Tab');
        const adjusted = await capture();
        assert.strictEqual(adjusted.coordinatesAdjusted, true);
        assert.strictEqual(adjusted.lat, 60.25);
        const saved = await page.evaluate(id => TMMapHistory.find(id), adjusted.requestId);
        assert.strictEqual(saved.request.coordinatesAdjusted, true);
        assert.strictEqual(saved.request.lat, 60.25);
        await page.locator('#lat-input').fill('60.001');
        await page.locator('#lat-input').press('Tab');
      }
      const geo = await page.evaluate(request => {
        const meters = mapCalc.metersPerDegree(request.lat);
        return [(request.effectiveArea.lonMax - request.effectiveArea.lonMin) * meters.lon,
          (request.effectiveArea.latMax - request.effectiveArea.latMin) * meters.lat];
      }, request);
      assert(Math.abs(geo[0] - width * 24) < 1e-6);
      assert(Math.abs(geo[1] - height * 24) < 1e-6);
      await page.evaluate(info => storeMapSettingsFromInfo(info), request);
      await page.goto(url);
      await page.waitForFunction(([w, h]) => window.data && data.get('printWidthCm') === w && data.get('printHeightCm') === h, [width, height]);
      if (width === 20 || height === 20) {
        await page.locator('#print-width-input').focus();
        await page.keyboard.press('Tab');
        assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'print-width-inches');
        await page.keyboard.press('Tab');
        assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'print-height-input');
        await page.screenshot({path: path.join(out, `${width}x${height}.png`), fullPage: true});
      }
      if (width === 20 && height === 10) {
        let alertText;
        page.once('dialog', async dialog => { alertText = dialog.message(); await dialog.accept(); });
        await page.evaluate(() => { data.set('offsetY', 120, {silent: true}); });
        assert.strictEqual(await capture(), undefined);
        assert(alertText.includes('outside'));
        await page.evaluate(() => { data.set({offsetX: 239, offsetY: 119}, {silent: true}); });
        assert(await capture());
        await page.evaluate(() => { data.set({offsetX: 0, offsetY: 0}, {silent: true}); });
      }
      await page.uncheck('#advanced-input');
      await page.waitForFunction(() => data.get('printWidthCm') === data.get('printHeightCm'));
      await page.check('#printing-tech-2d');
      assert.strictEqual(await page.locator('#print-width-input').inputValue(), '27.9');
      assert.strictEqual(await page.locator('#print-height-input').inputValue(), '27.9');
      await page.check('#printing-tech-3d');
    }
    await page.setViewportSize({width: 390, height: 844});
    await page.goto(url + '&printWidthCm=10&printHeightCm=20');
    await page.locator('#print-height-input').focus();
    await page.screenshot({path: path.join(out, 'portrait-mobile.png'), fullPage: true});
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    for (const lang of ['de', 'fi', 'nl', 'es']) {
      await page.goto(url.replace('/en/', '/' + lang + '/') + '&printWidthCm=20&printHeightCm=10');
      await page.waitForFunction(() => data.get('printWidthCm') === 20);
      assert((await page.locator('.map-scale-coverage').textContent()).includes('480 × 240'));
      assert(!(await page.locator('.map-scale-coverage').textContent()).includes('__area_metric__'));
    }
    await page.goto(url + '&printWidthCm=20&size=17');
    await page.locator('#print-dimension-error').waitFor({state: 'visible'});
    assert(!(await page.locator('#submit-button').isVisible()));
    for (const dimensions of ['printWidthCm=0.9&printHeightCm=10', 'printWidthCm=10&printHeightCm=0.9', 'size=0.9']) {
      await page.goto(url + '&' + dimensions);
      await page.locator('#print-dimension-error').waitFor({state: 'visible'});
      assert((await page.locator('#print-dimension-error').textContent()).includes('at least 1 cm'));
      assert(!(await page.locator('#submit-button').isVisible()));
    }
    // Load the actual generated rectangular outputs through the result page.
    await page.setViewportSize({width: 1100, height: 1000});
    for (const [shape, technology] of [['20x10', '3d'], ['10x20', '2d'], ['50x5', '3d']]) {
      const folder = path.join(out, shape);
      const info = JSON.parse(fs.readFileSync(path.join(folder, 'info.json')));
      info.printingTech = technology;
      info.contentFilterAvailable = true;
      await page.unroute('**/*');
      let emailPayload;
      await page.route('**/*', route => {
        const address = new URL(route.request().url());
        const headers = {'access-control-allow-origin': '*'};
        if (address.pathname === '/scripts/environment.js') return route.fulfill({
          contentType: 'application/javascript', body: "window.TM_ENVIRONMENT='test';window.TM_DOMAIN='fixture.invalid';window.TM_REGION='eu-west-1';"});
        if (address.hostname === '127.0.0.1') return route.continue();
        if (address.pathname.includes('/map/info/')) return route.fulfill({json: info, headers});
        if (address.hostname.includes('execute-api')) {
          emailPayload = route.request().postDataJSON();
          return route.fulfill({json: {}, headers});
        }
        for (const [suffix, contentType] of [['.map-content.json', 'application/json'], ['.stl', 'application/sla'], ['.svg', 'image/svg+xml']]) {
          if (address.pathname.endsWith(suffix)) return route.fulfill({headers, contentType,
            body: fs.readFileSync(path.join(folder, suffix === '.map-content.json' ? 'map-content.json' : 'map' + suffix))});
        }
        return route.abort();
      });
      await page.goto(base + '/en/map?map=' + info.requestId.split('/')[0]);
      await page.locator('.map-content-summary li').first().waitFor();
      if (technology === '3d') await page.locator('.preview-3d canvas').waitFor({state: 'visible'});
      else {
        await page.waitForFunction(() => document.querySelector('#svg-preview').naturalWidth > 0);
        const ratio = await page.locator('#svg-preview').evaluate(img => img.clientWidth / img.clientHeight);
        assert(Math.abs(ratio - 10 / 21) < .01);
      }
      assert.strictEqual(await page.locator('#order-map').count(), 0);
      await page.locator('#email-addr').fill('test@example.com');
      await page.locator('.email-sending-form').evaluate(form => $(form).trigger('submit'));
      await page.waitForFunction(() => $('.email-sending-success').is(':visible'));
      assert.strictEqual(emailPayload.meta.printWidthCm, info.printWidthCm);
      assert.strictEqual(emailPayload.meta.printHeightCm, info.printHeightCm);
      assert(!('size' in emailPayload.meta));
      await page.screenshot({path: path.join(out, shape + '-result.png'), fullPage: true});
    }
    assert.deepStrictEqual(errors, []);
    console.log('PASS rectangular UI, request bounds, offsets, restoration, presets, responsive layout and locales');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
