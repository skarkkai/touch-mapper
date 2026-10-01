'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');
const {chromium} = require('playwright');

async function tabTo(page, selector) {
  for (let count = 0; count < 80; count += 1) {
    if (await page.evaluate(s => document.activeElement.matches(s), selector)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('Cannot reach by keyboard: ' + selector);
}

async function main() {
  const repo = path.resolve(__dirname, '../..');
  const artifacts = path.join(repo, '.tmp/filter-regression');
  const original = path.join(artifacts, 'road-only-original');
  const empty = path.join(artifacts, 'road-only-empty');
  assert(fs.existsSync(path.join(empty, 'map-content.json')),
    'Run python3 test/map-content/check-content-filter.py first');
  const base = new URL(process.argv[2] || 'http://127.0.0.1:9000').origin;
  assert.strictEqual(new URL(base).hostname, '127.0.0.1');
  const originalId = 'B123456789abcdef/road';
  const emptyId = 'B23456789abcdef0/empty';
  const nativeId = 'B3456789abcdef01/native';
  const info = {
    addrShort: 'Empty tile', addrLong: 'Empty tile, Helsinki',
    printingTech: '3d', printWidthCm: 17, printHeightCm: 17, scale: 1400,
    contentMode: 'normal', hideLocationMarker: true, noBorders: true,
    lat: 60.001, lon: 24.002, effectiveArea: {latMin: 59.999, latMax: 60.003,
      lonMin: 23.999, lonMax: 24.004}, contentFilterAvailable: true,
    status: {progress: 100}
  };
  const browser = await chromium.launch({headless: true});
  const context = await browser.newContext({serviceWorkers: 'block'});
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [];
  let restored;
  let failNativeContent = false;
  const blocked = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('dialog', dialog => {
    errors.push('Unexpected dialog: ' + dialog.message());
    dialog.dismiss();
  });
  try {
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      const respond = json => route.fulfill({json, headers: {'access-control-allow-origin': '*'}});
      if (url.origin === base && url.pathname === '/scripts/environment.js') {
        return route.fulfill({contentType: 'application/javascript', body:
          "window.TM_ENVIRONMENT='test';window.TM_DOMAIN='fixture.invalid';" +
          "window.TM_REGION='eu-west-1';" +
          "window.TM_MAP_REQUEST_SQS_QUEUE='https://queue.fixture.invalid/requests';"});
      }
      if (url.origin === base) return route.continue();
      if (url.hostname === 'queue.fixture.invalid') {
        restored = JSON.parse(url.searchParams.get('MessageBody'));
        return respond({});
      }
      if (url.hostname === 'api.ipify.org') return respond({ip: '127.0.0.1'});
      if (url.pathname.includes('/map/info/')) {
        const id = url.pathname.split('/map/info/')[1].slice(0, -'.json'.length);
        if (id === nativeId.split('/')[0]) return respond({...info, requestId: nativeId});
        if (id === emptyId.split('/')[0]) return respond({...info, requestId: emptyId,
          contentFilterBaseRequestId: originalId, contentFilterExcludedFeatures: ['way:101']});
        if (restored && id === restored.requestId.split('/')[0]) {
          return respond({...restored, contentFilterAvailable: true,
            contentFilterBaseRequestId: originalId, contentFilterExcludedFeatures: [],
            status: {progress: 100}});
        }
      }
      if (url.pathname.includes('/map/data/')) {
        const decoded = decodeURIComponent(url.pathname.split('/map/data/')[1]);
        const id = [nativeId, emptyId, originalId, restored && restored.requestId]
          .find(candidate => candidate && decoded.startsWith(candidate + '.'));
        if (id) {
          const folder = id === originalId || restored && id === restored.requestId ? original : empty;
          const suffix = decoded.slice(id.length);
          if (route.request().method() === 'HEAD') return route.fulfill({status: 200,
            headers: {'access-control-allow-origin': '*'}});
          if (suffix === '.map-content.json') {
            if (id === nativeId && failNativeContent) return route.fulfill({status: 503,
              headers: {'access-control-allow-origin': '*'}});
            return respond(JSON.parse(fs.readFileSync(path.join(folder, 'map-content.json'))));
          }
          const files = {'.stl': ['map.stl', 'application/sla'],
            '.svg': ['map.svg', 'image/svg+xml'], '.pdf': ['map.pdf', 'application/pdf']};
          if (files[suffix]) return route.fulfill({contentType: files[suffix][1],
            body: fs.readFileSync(path.join(folder, files[suffix][0])),
            headers: {'access-control-allow-origin': '*'}});
        }
      }
      blocked.push(url.href);
      return route.abort();
    });
    await page.goto(base + '/en/map?map=' + nativeId.split('/')[0]);
    await page.locator('.map-content-notice').getByText('No map features listed for this map.').waitFor();
    assert.strictEqual(await page.locator('#map-content-full > .row:visible').count(), 0);
    assert.strictEqual(await page.locator('.map-content-section-height:visible').count(), 0);
    assert(!(await page.locator('#filter-map-content').isVisible()));
    assert(!(await page.locator('.map-content-summary-toggle').isVisible()));
    await page.locator('.preview-3d canvas').waitFor({state: 'visible'});
    execFileSync('python3', [path.join(repo, 'bin/tmpctl'), 'mkdir', '.tmp/e2e/empty-map']);
    await page.screenshot({path: path.join(repo, '.tmp/e2e/empty-map/native-empty.png'), fullPage: true});
    await page.setViewportSize({width: 390, height: 844});
    await page.screenshot({path: path.join(repo, '.tmp/e2e/empty-map/native-empty-mobile.png'), fullPage: true});
    await page.setViewportSize({width: 1280, height: 720});

    for (const locale of ['fi', 'de', 'es', 'nl']) {
      const translations = JSON.parse(fs.readFileSync(path.join(repo, 'web/locales', locale, 'tm.json')));
      await page.goto(base + '/' + locale + '/map?map=' + nativeId.split('/')[0]);
      await page.locator('.map-content-notice').getByText(translations.map_content_empty, {exact: true}).waitFor();
      assert.strictEqual(await page.locator('#map-content-full > .row:visible').count(), 0);
      assert(!(await page.locator('.map-content-summary-toggle').isVisible()));
    }
    failNativeContent = true;
    await page.goto(base + '/en/map?map=' + nativeId.split('/')[0]);
    await page.locator('.map-content-notice').getByText('Map content is not available.', {exact: true}).waitFor({timeout: 20000});
    assert.strictEqual(await page.locator('#map-content-full > .row:visible').count(), 0);
    failNativeContent = false;

    await page.goto(base + '/en/map?map=' + emptyId.split('/')[0]);
    const road = page.locator('.map-content-roads .map-content-filter-item');
    await road.waitFor();
    assert(!(await road.isChecked()), 'Excluded road must remain unchecked');
    assert((await page.locator('.map-content-roads').innerText()).includes('Main Street'));
    await page.screenshot({path: path.join(repo, '.tmp/e2e/empty-map/filtered-empty.png'), fullPage: true});
    await tabTo(page, '.map-content-roads .map-content-filter-item');
    assert(await road.evaluate(element => element.matches(':focus-visible')));
    await page.waitForFunction(() =>
      getComputedStyle(document.activeElement).outlineColor === 'rgb(0, 95, 204)');
    assert.strictEqual(await road.evaluate(element => getComputedStyle(element).outlineColor),
      'rgb(0, 95, 204)');
    await page.setViewportSize({width: 390, height: 844});
    await page.screenshot({path: path.join(repo, '.tmp/e2e/empty-map/filtered-empty-mobile-focus.png'), fullPage: true});
    await page.setViewportSize({width: 1280, height: 720});
    await page.locator('#cancel-map-content-filter').click();
    await page.locator('.map-content-notice').getByText('No map features listed for this map.').waitFor();
    assert.strictEqual(await page.locator('#map-content-full > .row:visible').count(), 0);
    assert.strictEqual(await page.locator('.map-content-section-height:visible').count(), 0);
    await page.locator('#filter-map-content').click();
    await road.waitFor();
    await road.check();
    assert(await page.locator('#apply-map-content-filter').isEnabled());
    await page.locator('#apply-map-content-filter').click();
    await page.waitForURL(url => restored &&
      new URL(url).searchParams.get('map') === restored.requestId.split('/')[0]);
    assert.deepStrictEqual(restored.excludedFeatures, []);
    assert.strictEqual(restored.filterSourceRequestId, originalId);
    await page.locator('.map-content-roads .map-content-filter-item').waitFor();
    assert(await page.locator('.map-content-roads .map-content-filter-item').isChecked());
    await page.locator('#cancel-map-content-filter').click();
    await page.locator('.map-content-summary').getByText('Main Street').waitFor();
    assert.deepStrictEqual(errors, []);
    console.log('PASS empty map description, printable preview, filter restoration');
  } catch (error) {
    execFileSync('python3', [path.join(repo, 'bin/tmpctl'), 'mkdir', '.tmp/e2e/empty-map']);
    await page.screenshot({path: path.join(repo, '.tmp/e2e/empty-map/failure.png'), fullPage: true});
    console.error('Browser errors:', errors, 'Restored:', restored, 'Blocked:', blocked);
    throw error;
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
