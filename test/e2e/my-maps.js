'use strict';
const assert = require('assert');
const {chromium} = require('playwright');
const base = 'http://127.0.0.1:9000';

// The first-visit hint is shared across tabs and locales, but not browser profiles.
async function checkDiscovery(browser) {
  const context = await browser.newContext({viewport: {width: 1100, height: 900}});
  await context.route('**/*', route => new URL(route.request().url()).origin === base
    ? route.continue() : route.abort());
  const page = await context.newPage();
  await page.goto(base + '/en/help');
  assert.strictEqual(await page.locator('.my-maps-new').isVisible(), false);
  await page.evaluate(() => window.TMMapHistory.addAttempt({requestId: 'Bdiscovery/Map', addrShort: 'Station'}));
  assert(await page.locator('.my-maps-new').isVisible(), 'saving the first map updates the header immediately');
  for (const [locale, label] of Object.entries({en: 'New', de: 'Neu', es: 'Nuevo', fi: 'Uusi', nl: 'Nieuw'})) {
    await page.goto(base + '/' + locale + '/help');
    assert.strictEqual((await page.locator('.my-maps-new').textContent()).trim(), label);
    assert(await page.locator('.my-maps-new').isVisible());
    for (const width of [320, 401, 451, 800, 1100]) {
      await page.setViewportSize({width, height: 900});
      assert(await page.evaluate(() => {
        const logo = document.querySelector('.logo #g3').getBoundingClientRect();
        return Array.from(document.querySelectorAll('.language-selector, .my-maps-link, .help-link')).every(el => {
          const nav = el.getBoundingClientRect();
          return nav.bottom <= logo.top || nav.left >= logo.right;
        });
      }), locale + ': navigation must not overlap the logo at ' + width + 'px');
    }
  }
  await page.goto(base + '/en/help');
  await page.locator('.language-selector').focus();
  await page.keyboard.press('Tab');
  assert(await page.locator('.my-maps-link').evaluate(el => el === document.activeElement &&
    getComputedStyle(el).outlineStyle !== 'none' && parseFloat(getComputedStyle(el).outlineWidth) >= 2));
  await page.screenshot({path: '.tmp/my-maps-new-desktop.png'});
  await page.setViewportSize({width: 320, height: 800});
  assert(await page.evaluate(() => {
    const nav = document.querySelector('.top-corner').getBoundingClientRect();
    const logo = document.querySelector('.logo #g3').getBoundingClientRect();
    return nav.bottom <= logo.top || nav.left >= logo.right;
  }), 'The discovery hint must not overlap the logo on small screens');
  await page.screenshot({path: '.tmp/my-maps-new-mobile.png'});
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const otherTab = await context.newPage();
  await otherTab.goto(base + '/fi/maps');
  assert.strictEqual(await otherTab.locator('.my-maps-new').isVisible(), false);
  await page.waitForFunction(() => document.querySelector('.my-maps-new').hidden);
  await page.reload();
  assert.strictEqual(await page.locator('.my-maps-new').isVisible(), false);
  await page.evaluate(() => {
    window.TMMapHistory.clear();
    window.TMMapHistory.addAttempt({requestId: 'Bnext/Map', addrShort: 'Next map'});
  });
  assert.strictEqual(await page.locator('.my-maps-new').isVisible(), false);
  await context.close();
}

// Exercise the actual library UI with delayed service responses and no live AWS calls.
async function main() {
  const browser = await chromium.launch({headless: true});
  try {
    await checkDiscovery(browser);
    const page = await browser.newPage({viewport: {width: 1100, height: 900}});
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    let release;
    let delayed = false;
    let gate = new Promise(resolve => { release = resolve; });
    let submitted;
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      const headers = {'access-control-allow-origin': '*'};
      if (url.origin === base) return route.continue();
      if (url.searchParams.get('Action') === 'SendMessage') {
        submitted = JSON.parse(url.searchParams.get('MessageBody'));
        return route.fulfill({headers, body: '<Success/>'});
      }
      const match = url.pathname.match(/\/map\/info\/(B[^.]+)\.json/);
      if (match) {
        if (match[1] === 'Bready' && delayed) await gate;
        if (match[1] === 'Bpending') return route.fulfill({headers, status: 404});
        if (match[1] === 'Bnetwork') return route.fulfill({headers, status: 503});
        return route.fulfill({headers, json: {requestId: match[1] + '/Map', printingTech: '3d',
          status: match[1] === 'Bfailed' ? {errorCode: 'too_large'} : {progress: 100}}});
      }
      if (route.request().method() === 'HEAD') return route.fulfill({headers,
        status: url.pathname.includes('Bexpired') ? 404 : 200});
      return route.abort();
    });
    await page.goto(base + '/en/maps');
    await page.evaluate(() => {
      const records = ['Bready', 'Bexpired', 'Bnetwork', 'Bpending', 'Bfailed'].map((id, index) => ({
        id, requestId: id + '/Map', addressShort: id === 'Bready' ? 'Central Station' : id,
        addressLong: id === 'Bready' ? 'Central Station, Helsinki, Uusimaa, Finland' : 'Helsinki', createdAt: new Date(Date.now() - index * 86400000).toISOString(),
        source: 'created', status: id === 'Bpending' ? 'in-progress' : id === 'Bfailed' ? 'failed' : 'ready',
        name: '', note: '', request: {printingTech: '3d', printWidthCm: 17, printHeightCm: 20,
          scale: 2400, lat: 60, lon: 24, offsetX: 0, offsetY: 0,
          contentMode: id === 'Bready' || id === 'Bnetwork' ? 'only-big-roads' : 'normal', multipartMode: id === 'Bnetwork',
          multipartXpc: id === 'Bnetwork' ? 100 : 0, multipartYpc: id === 'Bnetwork' ? -10 : 0,
          coordinatesAdjusted: id === 'Bready',
          addrShort: 'Fixture', addrLong: 'Fixture, Helsinki',
          effectiveArea: {lonMin: 23.99, lonMax: 24.01, latMin: 59.99, latMax: 60.01},
          filterSourceRequestId: 'Bsource/Map', excludedFeatures: id === 'Bfailed' ? ['way/42'] : []}
      }));
      localStorage.setItem('tm-map-history-v1', JSON.stringify({version: 1, maps: records}));
    });
    delayed = true;
    await page.reload();
    const ready = page.locator('[data-map-id="Bready"]');
    await ready.waitFor();
    assert.strictEqual(await ready.locator('h3').textContent(), 'Central Station');
    assert.strictEqual(await ready.locator('.my-map-address').textContent(), ', Helsinki, Uusimaa, Finland');
    assert.strictEqual(await ready.locator('dl').count(), 0);
    assert.strictEqual(await ready.locator('.my-map-content').count(), 1);
    assert.strictEqual(await page.locator('[data-map-id="Bnetwork"] .my-map-content').count(), 0);
    assert.strictEqual(await page.locator('[data-map-id="Bnetwork"] .my-map-printing').count(), 1);
    assert.match(await page.locator('[data-map-id="Bnetwork"] .my-map-multipart').textContent(), /Multipart map.*X 100%.*Y -10%/);
    assert.match(await ready.locator('.my-map-coordinates').textContent(), /Coordinates adjusted.*60.*24/);
    await ready.locator('.edit-action').focus();
    await ready.screenshot({path: '.tmp/my-maps-card-default.png'});
    await ready.locator('.edit-action').click();
    await page.locator('#map-name-Bready').fill('Unsaved lesson name');
    release();
    await page.waitForFunction(() => !window.TMMapHistory.find('Bexpired'));
    await page.waitForFunction(() => window.TMMapHistory.find('Bready').progress === 100);
    assert.strictEqual(await page.locator('#map-name-Bready').inputValue(), 'Unsaved lesson name');
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'map-name-Bready');
    assert.strictEqual(await ready.locator('.my-map-status').isVisible(), false);
    assert(await page.evaluate(() => !!window.TMMapHistory.find('Bnetwork')));
    assert(await page.evaluate(() => !!window.TMMapHistory.find('Bpending')));
    await ready.locator('.my-map-edit-form .primary-action').click();
    assert.strictEqual(await ready.locator('h3').textContent(), 'Unsaved lesson name');
    await ready.getByRole('button', {name: /^Favorite:/}).click();
    assert.strictEqual(await ready.getByRole('button', {name: /^Unfavorite:/}).getAttribute('aria-pressed'), 'true');
    await ready.getByRole('button', {name: /^Unfavorite:/}).click();
    assert.strictEqual(await ready.getByRole('button', {name: /^Favorite:/}).getAttribute('aria-pressed'), 'false');
    await ready.getByRole('button', {name: /^Share:/}).click();
    assert((await ready.locator('input[type=url]').inputValue()).includes('Bready'));
    assert.strictEqual(await page.locator('.my-maps-link').getAttribute('aria-current'), 'page');
    assert.strictEqual(await page.locator('.my-maps-link').evaluate(el => getComputedStyle(el).borderBottomWidth), '1px');
    assert(await page.locator('.my-maps-link').evaluate(el => {
      const style = getComputedStyle(el);
      return Math.abs(parseFloat(style.marginLeft) - 10 - parseFloat(style.fontSize) * .2) < .1;
    }), 'Header spacing increases by 0.2 em, without Less folding mixed units');
    const centering = await page.locator('#my-maps-clear').evaluate(el => {
      const button = el.getBoundingClientRect();
      const parent = el.parentElement.getBoundingClientRect();
      return Math.abs(button.x + button.width / 2 - parent.x - parent.width / 2);
    });
    assert(centering < 1);
    await page.screenshot({path: '.tmp/my-maps-desktop.png', fullPage: true});
    await page.setViewportSize({width: 390, height: 844});
    await page.screenshot({path: '.tmp/my-maps-mobile.png', fullPage: true});
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    // Status refreshes also honor the active filter without stealing its focus.
    gate = new Promise(resolve => { release = resolve; });
    await page.evaluate(() => window.TMMapHistory.update('Bready', {status: 'in-progress', progress: 60}));
    await page.reload();
    await page.locator('#my-maps-status-filter').selectOption('in-progress');
    await page.locator('#my-maps-status-filter').focus();
    release();
    await page.waitForFunction(() => window.TMMapHistory.find('Bready').status === 'ready');
    await ready.waitFor({state: 'detached'});
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'my-maps-status-filter');
    await page.locator('#my-maps-status-filter').selectOption('');
    // A full store leaves existing history and controls accessible.
    await page.addInitScript(() => {
      Storage.prototype.setItem = function(){ throw new DOMException('Full', 'QuotaExceededError'); };
    });
    await page.reload();
    assert(await page.locator('#my-maps-clear').isVisible());
    await ready.locator('.edit-action').click();
    await page.locator('#map-name-Bready').fill('Cannot persist');
    await ready.locator('.my-map-edit-form .primary-action').click();
    await page.waitForFunction(() => document.getElementById('my-maps-live').textContent.includes('could not save'));
    assert.strictEqual(await page.evaluate(() => window.TMMapHistory.find('Bready').name), 'Unsaved lesson name');
    // New context removes the quota mock and checks real history -> form -> queue retry.
    const retryPage = await browser.newPage();
    await retryPage.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === base) return route.continue();
      if (url.searchParams.get('Action') === 'SendMessage') {
        submitted = JSON.parse(url.searchParams.get('MessageBody'));
        return route.fulfill({headers: {'access-control-allow-origin': '*'}, body: '<Success/>'});
      }
      return route.abort();
    });
    await retryPage.goto(base + '/en/maps');
    const saved = await page.evaluate(() => localStorage.getItem('tm-map-history-v1'));
    await retryPage.evaluate(value => localStorage.setItem('tm-map-history-v1', value), saved);
    await retryPage.reload();
    await retryPage.locator('[data-map-id="Bfailed"]').getByRole('button', {name: /^Try again/}).click();
    await retryPage.waitForURL('**/en/area');
    for (let count = 0; count < 100 && !submitted; count++) await retryPage.waitForTimeout(50);
    assert(submitted, 'Retry must reach the queue');
    assert.strictEqual(submitted.filterSourceRequestId, 'Bsource/Map');
    assert.deepStrictEqual(submitted.excludedFeatures, ['way/42']);
    assert.notStrictEqual(submitted.requestId, 'Bfailed/Map');
    await retryPage.goto(base + '/en/maps');
    retryPage.once('dialog', dialog => {
      assert(dialog.message().includes('Unsaved lesson name'));
      dialog.accept();
    });
    await retryPage.locator('[data-map-id="Bready"] .remove-action').click();
    assert.strictEqual(await retryPage.locator('[data-map-id="Bready"]').count(), 0);
    assert(await retryPage.evaluate(() => document.activeElement.tagName === 'H3'));
    await retryPage.evaluate(() => localStorage.setItem('tm-map-history-v1', '{unreadable'));
    await retryPage.goto(base + '/en/maps');
    assert(await retryPage.locator('#my-maps-storage-error').isVisible());
    assert.strictEqual(await retryPage.locator('#my-maps-empty').isVisible(), false);
    assert.strictEqual(await retryPage.evaluate(() => localStorage.getItem('tm-map-history-v1')), '{unreadable');
    await page.goto(base + '/en/help');
    assert(await page.locator('.help-link').isVisible());
    assert.strictEqual(await page.locator('.help-link').getAttribute('aria-current'), 'page');
    await page.screenshot({path: '.tmp/my-maps-help-mobile.png', fullPage: false});
    assert.deepStrictEqual(errors, []);
    console.log('My Maps browser checks passed');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
