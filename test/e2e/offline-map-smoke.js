'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');
const {chromium} = require('playwright');

// Tab through the real focus order; .focus() would conceal tabindex/visibility bugs.
async function tabTo(page, selector) {
  for (let count = 0; count < 80; count += 1) {
    if (await page.evaluate(s => document.activeElement.matches(s), selector)) {
      assert(await page.locator(selector).isVisible(), selector + ' must be visible');
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw new Error('Cannot reach by keyboard: ' + selector);
}

async function main() {
  const repo = path.resolve(__dirname, '../..');
  const pipeline = path.join(repo, '.tmp/filter-regression/road-original');
  const filteredPipeline = path.join(repo, '.tmp/filter-regression/road-excluded');
  const content = JSON.parse(fs.readFileSync(path.join(pipeline, 'map-content.json')));
  const fixture = JSON.parse(fs.readFileSync(path.join(repo,
    'test/map-content/regression-tests.json'))).tests.find(test => test.category === 'regression-mixed').requestBody;
  const base = new URL(process.argv[2] || 'http://127.0.0.1:9000').origin;
  assert.strictEqual(new URL(base).hostname, '127.0.0.1', 'Offline smoke requires a loopback preview');
  const browser = await chromium.launch({headless: true});
  const context = await browser.newContext({serviceWorkers: 'block'});
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(15000);
  const errors = [];
  let request;
  let filterRequest;
  let filterAttempts = 0;
  let releaseFilterRequest;
  const filterRequestGate = new Promise(resolve => { releaseFilterRequest = resolve; });
  let stlFetched = false;
  let infoPolls = 0;
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
      if (url.hostname === 'nominatim.openstreetmap.org' && url.pathname === '/search') {
        assert.strictEqual(url.searchParams.get('q'), 'Fixture Square');
        return respond({features: [{
          properties: {geocoding: {name: 'Fixture Square', label: 'Fixture Square, Helsinki',
            city: 'Helsinki', country: 'Finland'}},
          geometry: {coordinates: [fixture.lon, fixture.lat]}
        }]});
      }
      if (url.hostname === 'api.ipify.org') return respond({ip: '127.0.0.1'});
      if (url.hostname === 'queue.fixture.invalid') {
        assert.strictEqual(url.searchParams.get('Action'), 'SendMessage');
        if (!request) request = JSON.parse(url.searchParams.get('MessageBody'));
        else {
          filterRequest = JSON.parse(url.searchParams.get('MessageBody'));
          filterAttempts += 1;
          if (filterAttempts === 1) return route.fulfill({status: 503, json: {},
            headers: {'access-control-allow-origin': '*'}});
          if (filterAttempts === 2) return filterRequestGate.then(() => respond({}));
        }
        return respond({});
      }
      if (filterRequest && url.pathname.endsWith('/map/info/' + filterRequest.requestId.split('/')[0] + '.json')) {
        return respond({...filterRequest, contentFilterAvailable: true,
          contentFilterBaseRequestId: filterRequest.filterSourceRequestId,
          contentFilterExcludedFeatures: filterRequest.excludedFeatures,
          status: {progress: 100}});
      }
      if (request && url.pathname.endsWith('/map/info/' + request.requestId.split('/')[0] + '.json')) {
        infoPolls += 1;
        return respond({...request, contentFilterAvailable: true, status: {progress: 100}});
      }
      if (filterRequest && url.hostname === 'fixture.invalid' &&
          decodeURIComponent(url.pathname).startsWith('/map/data/' + filterRequest.requestId)) {
        const suffix = decodeURIComponent(url.pathname).slice(('/map/data/' + filterRequest.requestId).length);
        const resultPipeline = filterRequest.excludedFeatures.includes('way:101') ? filteredPipeline : pipeline;
        if (suffix === '.map-content.json') {
          return respond(JSON.parse(fs.readFileSync(path.join(resultPipeline, 'map-content.json'))));
        }
        const files = {'.stl': ['map.stl', 'application/sla'], '.svg': ['map.svg', 'image/svg+xml'],
          '.pdf': ['map.pdf', 'application/pdf']};
        if (files[suffix]) return route.fulfill({contentType: files[suffix][1],
          body: fs.readFileSync(path.join(resultPipeline, files[suffix][0])),
          headers: {'access-control-allow-origin': '*'}});
      }
      if (url.hostname === 'fixture.invalid' && request) {
        const prefix = '/map/data/' + request.requestId;
        const decodedPath = decodeURIComponent(url.pathname);
        if (decodedPath === prefix + '.map-content.json') return respond(content);
        for (const [suffix, file, contentType] of [
          ['.stl', 'map.stl', 'application/sla'], ['.svg', 'map.svg', 'image/svg+xml'],
          ['.pdf', 'map.pdf', 'application/pdf']
        ]) {
          if (decodedPath === prefix + suffix) {
            if (suffix === '.stl' && route.request().method() === 'GET') stlFetched = true;
            return route.fulfill({contentType, body: fs.readFileSync(path.join(pipeline, file)),
              headers: {'access-control-allow-origin': '*'}});
          }
        }
      }
      if (request && route.request().method() === 'HEAD' && url.pathname.endsWith('.stl')) {
        return route.fulfill({status: 200, body: '', headers: {'access-control-allow-origin': '*'}});
      }
      // Tiles, analytics, and all other external services cannot reach the network.
      return route.abort();
    });
    await page.goto(base + '/en/');
    await tabTo(page, '#address-input');
    await page.keyboard.type('Fixture Square');
    await page.keyboard.press('Enter');
    await page.waitForURL('**/en/area*');
    await page.locator('#content-mode').waitFor({state: 'visible'});

    await tabTo(page, '#map-size-preset');
    await page.keyboard.press('End');
    assert.strictEqual(await page.locator('#map-size-preset').inputValue(), '20');
    await page.keyboard.press('Home');
    await tabTo(page, '#map-scale-preset');
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    assert.strictEqual(await page.locator('#map-scale-preset').inputValue(), '1400');
    await tabTo(page, '#content-mode');
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    assert.strictEqual(await page.locator('#content-mode').inputValue(), 'only-big-roads');
    await tabTo(page, '#target-road-density-ui');
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('37');
    await page.keyboard.press('Tab');
    await tabTo(page, '#content-mode');
    await page.keyboard.press('Home');
    assert(!(await page.locator('#target-road-density-ui').isVisible()));
    await tabTo(page, '#hide-location-marker');
    await page.keyboard.press('Space');
    assert(await page.locator('#hide-location-marker').isChecked());

    // Exercise the production button handler, transport, polling and navigation.
    await tabTo(page, '#submit-button');
    await page.keyboard.press('Enter');
    await page.waitForURL('**/en/map?map=*');
    assert(request, 'Create button must send the map request');
    for (const key of ['contentMode', 'printingTech', 'scale', 'hideLocationMarker', 'lat', 'lon']) {
      assert.strictEqual(request[key], fixture[key], key);
    }
    assert.strictEqual(request.printWidthCm, fixture.printWidthCm || fixture.size);
    assert.strictEqual(request.printHeightCm, fixture.printHeightCm || fixture.size);
    assert(!Object.hasOwn(request, 'size'));
    assert(!Object.hasOwn(request, 'diameter'));
    assert(!Object.hasOwn(request, 'targetRoadDensity'), 'Normal mode must omit density');
    for (const key of Object.keys(fixture.effectiveArea)) {
      assert(Math.abs(request.effectiveArea[key] - fixture.effectiveArea[key]) < 1e-9, key);
    }
    assert.strictEqual(new URL(page.url()).searchParams.get('map'), request.requestId.split('/')[0]);
    const createdHistory = await page.evaluate(() => JSON.parse(localStorage.getItem('tm-map-history-v1')));
    assert.strictEqual(createdHistory.maps.length, 1);
    assert.strictEqual(createdHistory.maps[0].id, request.requestId.split('/')[0]);
    assert.strictEqual(createdHistory.maps[0].status, 'ready');
    assert.strictEqual(await page.locator('.map-history-saved').count(), 0, 'Successful saving has no routine notice');
    assert.strictEqual(await page.locator('.map-history-save-error').isVisible(), false);
    assert.strictEqual(await page.locator('.map-history-save-shared').isVisible(), false);
    await page.locator('.preview-3d canvas').waitFor({state: 'visible'});
    assert(infoPolls >= 2, 'Creation polling and result info fetch must both run');
    assert(stlFetched, '3D preview must load the generated STL');
    await page.locator('.map-content-summary li').first().waitFor();
    assert((await page.locator('.map-content-summary').innerText()).includes('Main Street'));

    await tabTo(page, '#download-map');
    const toggle = page.locator('.map-content-summary-toggle');
    await tabTo(page, '.map-content-summary-toggle');
    await page.keyboard.press('Enter');
    assert.strictEqual(await toggle.getAttribute('aria-expanded'), 'true');
    for (const [section, label] of [['roads', 'Main Street'], ['paths', 'Canal Walk'],
      ['water-areas', 'Pond'], ['buildings', 'Library']]) {
      const list = page.locator('.map-content-' + section);
      assert(await list.isVisible(), section);
      assert((await list.innerText()).includes(label), section);
    }
    for (const [id, extension] of [['download-map', '.stl'], ['download-map-content', '.map-content.json'],
      ['download-svg', '.svg'], ['download-pdf', '.pdf']]) {
      const href = await page.locator('#' + id).getAttribute('href');
      assert.strictEqual(decodeURIComponent(new URL(href).pathname), '/map/data/' + request.requestId + extension);
    }
    await tabTo(page, '#filter-map-content');
    execFileSync(path.join(repo, 'bin/tmpctl'), ['mkdir', '.tmp/e2e/offline-smoke']);
    await page.screenshot({path: path.join(repo, '.tmp/e2e/offline-smoke/filter-entry-focus.png'), fullPage: true});
    await page.keyboard.press('Enter');
    const roadCheckbox = page.locator('.map-content-roads .map-content-filter-item').first();
    const roadSection = page.locator('.map-content-roads-row .map-content-filter-section');
    assert(await roadCheckbox.isChecked());
    assert(await roadSection.isChecked());
    assert(await page.locator('#apply-map-content-filter').isDisabled());
    await roadCheckbox.uncheck();
    assert(!(await roadSection.isChecked()));
    assert(await roadSection.evaluate(element => element.indeterminate));
    assert(await page.locator('#apply-map-content-filter').isEnabled());
    await roadSection.check();
    assert.strictEqual(await page.locator('.map-content-roads .map-content-filter-item:checked').count(), 2);
    assert(await page.locator('#apply-map-content-filter').isDisabled());
    await roadSection.uncheck();
    await page.locator('.map-content-roads li').last().evaluate(element => { element.style.display = 'none'; });
    assert.strictEqual(await page.locator('.map-content-roads .map-content-filter-item:checked').count(), 0);
    await page.locator('.map-content-roads li').last().evaluate(element => { element.style.display = ''; });
    await roadSection.check();
    await roadCheckbox.uncheck();
    await page.locator('#cancel-map-content-filter').click();
    await page.locator('#filter-map-content').waitFor({state: 'visible'});
    assert(await page.locator('#filter-map-content').isVisible());
    assert.strictEqual(await page.locator('.map-content-filter-item').count(), 0);
    await page.locator('#filter-map-content').click();
    await page.locator('.map-content-roads .map-content-filter-item').first().waitFor();
    assert.strictEqual(await page.locator('.map-content-roads .map-content-filter-item:checked').count(), 2);
    await page.locator('.map-content-roads .map-content-filter-item').first().uncheck();
    execFileSync(path.join(repo, 'bin/tmpctl'), ['mkdir', '.tmp/e2e/offline-smoke']);
    await page.screenshot({path: path.join(repo, '.tmp/e2e/offline-smoke/filter-desktop.png'), fullPage: true});
    await page.setViewportSize({width: 390, height: 844});
    await page.screenshot({path: path.join(repo, '.tmp/e2e/offline-smoke/filter-mobile.png'), fullPage: true});
    await page.setViewportSize({width: 1280, height: 720});
    await page.locator('#apply-map-content-filter').click();
    await page.locator('.map-content-filter-error').waitFor({state: 'visible'});
    assert(await page.locator('.map-content-roads .map-content-filter-item').first().isEnabled());
    assert(await page.locator('.map-content-roads-row .map-content-filter-section').isEnabled());
    assert(!(await page.locator('.map-content-roads .map-content-filter-item').first().isChecked()));
    assert.strictEqual(decodeURIComponent(new URL(await page.locator('#download-map').getAttribute('href')).pathname),
      '/map/data/' + request.requestId + '.stl');
    await page.locator('#apply-map-content-filter').click();
    assert(await page.locator('.map-content-roads .map-content-filter-item').last().isDisabled());
    assert(await page.locator('.map-content-roads-row .map-content-filter-section').isDisabled());
    assert(await page.locator('#apply-map-content-filter').isDisabled());
    assert(await page.locator('#cancel-map-content-filter').isDisabled());
    await page.screenshot({path: path.join(repo, '.tmp/e2e/offline-smoke/filter-busy.png'), fullPage: true});
    releaseFilterRequest();
    await page.waitForURL(url => new URL(url).searchParams.get('map') === filterRequest.requestId.split('/')[0]);
    const firstFilteredRequestId = filterRequest.requestId;
    const filteredHistory = await page.evaluate(() => JSON.parse(localStorage.getItem('tm-map-history-v1')));
    assert(filteredHistory.maps.some(record => record.id === firstFilteredRequestId.split('/')[0] &&
      record.status === 'ready'), 'Successful filtered maps must be saved in browser history');
    assert.strictEqual(filterRequest.filterSourceRequestId, request.requestId);
    for (const field of ['printWidthCm', 'printHeightCm', 'scale', 'effectiveArea', 'printingTech']) {
      assert.deepStrictEqual(filterRequest[field], request[field], 'Filtering must preserve ' + field);
    }
    assert.deepStrictEqual(filterRequest.excludedFeatures, ['way:101']);
    assert.strictEqual(filterAttempts, 2);
    // The filter editor intentionally reopens, so the updated summary is hidden.
    await page.locator('.map-content-summary li').first().waitFor({state: 'attached'});
    assert(!(await page.locator('.map-content-summary').textContent()).includes('Main Street'));
    assert.strictEqual(decodeURIComponent(new URL(await page.locator('#download-map').getAttribute('href')).pathname),
      '/map/data/' + filterRequest.requestId + '.stl');
    await page.locator('.map-content-filter-item').first().waitFor();
    assert((await page.locator('.map-content-roads').innerText()).includes('Main Street'));
    assert(!(await page.locator('.map-content-roads .map-content-filter-item').first().isChecked()));
    assert(await page.locator('.map-content-roads .map-content-filter-item').last().isChecked());
    assert(await page.locator('.map-content-roads-row .map-content-filter-section').evaluate(
      element => element.indeterminate));
    assert(await page.locator('#apply-map-content-filter').isDisabled());
    await page.locator('#cancel-map-content-filter').click();
    await page.locator('.map-content-summary li').first().waitFor();
    assert(!(await page.locator('.map-content-summary').innerText()).includes('Main Street'));
    await page.locator('#filter-map-content').click();
    await page.locator('.map-content-filter-item').first().waitFor();
    assert(!(await page.locator('.map-content-roads .map-content-filter-item').first().isChecked()));
    await page.locator('.map-content-roads .map-content-filter-item').first().check();
    assert(await page.locator('#apply-map-content-filter').isEnabled());
    await page.locator('#apply-map-content-filter').click();
    await page.waitForURL(url => new URL(url).searchParams.get('map') === filterRequest.requestId.split('/')[0] &&
      filterRequest.requestId !== firstFilteredRequestId);
    assert.strictEqual(filterRequest.filterSourceRequestId, request.requestId);
    for (const field of ['printWidthCm', 'printHeightCm', 'scale', 'effectiveArea', 'printingTech']) {
      assert.deepStrictEqual(filterRequest[field], request[field], 'Filtering must preserve ' + field);
    }
    assert.deepStrictEqual(filterRequest.excludedFeatures, []);
    await page.locator('.map-content-filter-item').first().waitFor();
    assert(await page.locator('.map-content-roads .map-content-filter-item').first().isChecked());
    assert(await page.locator('#apply-map-content-filter').isDisabled());
    await page.locator('#cancel-map-content-filter').click();
    await page.locator('.map-content-summary li').first().waitFor();
    assert((await page.locator('.map-content-summary').innerText()).includes('Main Street'));
    assert.deepStrictEqual(errors, []);
    console.log('PASS offline creation and map-content filtering through regenerated result');
  } catch (error) {
    execFileSync(path.join(repo, 'bin/tmpctl'), ['mkdir', '.tmp/e2e/offline-smoke']);
    await page.screenshot({path: path.join(repo, '.tmp/e2e/offline-smoke/failure.png'), fullPage: true});
    console.error('Browser errors:', errors);
    throw error;
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
