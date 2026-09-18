'use strict';
const assert = require('assert');
const {chromium} = require('playwright');
const path = require('path');
const {execFileSync} = require('child_process');

// Verify the real local UI without making requests to external services.
async function main() {
  const repo = path.resolve(__dirname, '../..');
  execFileSync(path.join(repo, 'bin/tmpctl'), ['mkdir', '.tmp/named-roads']);
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.TM_REGION = 'eu-west-1';
      window.TM_MAP_REQUEST_SQS_QUEUE = 'http://127.0.0.1:9000/mock-queue';
    });
    const errors = [];
    page.on('pageerror', error => { errors.push(String(error)); console.error(String(error)); });
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1'
      ? route.continue() : route.abort());
    const base = process.argv[2] || 'http://127.0.0.1:9000';
    for (const lang of ['en', 'fi', 'de', 'es', 'nl']) {
      await page.goto(base + '/' + lang + '/area.html?origin=BlindSquare&lat=60.17&lon=24.94&addrName=Test');
      const select = page.locator('#content-mode');
      await select.waitFor({state: 'visible'});
      await select.selectOption('only-big-roads');
      await page.locator('#target-road-density-ui').fill('37');
      await page.locator('#target-road-density-ui').dispatchEvent('change');
      await select.focus();
      await select.selectOption('only-named-roads');
      assert.strictEqual(await page.locator('#named-roads-hint').count(), 0);
      assert.strictEqual(await select.getAttribute('aria-describedby'), null);
      assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'content-mode');
      assert(!(await page.locator('#target-road-density-ui').isVisible()));
      if (lang === 'en') {
        await select.locator('xpath=ancestor::div[contains(@class,"main-row")][1]').screenshot({
          path: path.join(repo, '.tmp/named-roads/settings.png')
        });
      }
      await page.keyboard.press('Tab');
      assert.notStrictEqual(await page.evaluate(() => document.activeElement.id), 'target-road-density-ui');
      await page.reload();
      assert.strictEqual(await select.inputValue(), 'only-named-roads');
      assert.strictEqual(await page.locator('#target-road-density-ui').inputValue(), '37');
      for (const mode of ['normal', 'no-buildings', 'only-big-roads', 'only-named-roads']) {
        await select.selectOption(mode);
        assert.strictEqual(await page.locator('#target-road-density-ui').isVisible(), mode === 'only-big-roads');
        const request = await page.evaluate(() => {
          let captured;
          const original = $.ajax;
          $.ajax = function(options) {
            const deferred = $.Deferred();
            if (options.url.includes('ipify')) deferred.resolve({ip: '127.0.0.1'});
            else if (options.url.includes('Action=SendMessage')) {
              captured = JSON.parse(new URL(options.url, location.href).searchParams.get('MessageBody'));
            }
            return deferred.promise();
          };
          try { window.submitMapCreation(); } finally { $.ajax = original; }
          return captured;
        });
        assert(request, 'Request must be constructed');
        assert.strictEqual(request.contentMode, mode);
        assert.strictEqual(Object.hasOwn(request, 'targetRoadDensity'), mode === 'only-big-roads');
        if (mode === 'only-big-roads') assert.strictEqual(request.targetRoadDensity, 37);
        await page.evaluate(info => window.storeMapSettingsFromInfo(info), request);
      }
      await page.reload();
      assert.strictEqual(await select.inputValue(), 'only-named-roads');
      assert.strictEqual(await page.locator('#target-road-density-ui').inputValue(), '37');
      console.log('PASS settings, keyboard, request and restoration: ' + lang);
    }
    assert.deepStrictEqual(errors, []);
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
