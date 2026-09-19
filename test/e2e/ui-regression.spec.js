'use strict';
const {test, expect} = require('playwright/test');
const fs = require('fs');
const path = require('path');
const base = 'http://127.0.0.1:9000';
const artifacts = path.resolve(__dirname, '../../.tmp/rectangular-maps');
const settings = '/en/area?origin=BlindSquare&lat=60.001&lon=24.002&addrName=Fixture';

// All service responses come from deterministic local fixtures; no live network.
async function offline(page, result) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    const headers = {'access-control-allow-origin': '*'};
    if (url.pathname === '/scripts/environment.js') return route.fulfill({contentType: 'application/javascript',
      body: "window.TM_ENVIRONMENT='test';window.TM_DOMAIN='fixture.invalid';window.TM_REGION='eu-west-1';window.TM_MAP_REQUEST_SQS_QUEUE='https://fixture.invalid/queue';"});
    if (url.origin === base) return route.continue();
    if (result && url.pathname.includes('/map/info/')) return route.fulfill({headers, json: result.info});
    if (result) {
      for (const [suffix, filename, contentType] of [
        ['.map-content.json', 'map-content.json', 'application/json'],
        ['.stl', 'map.stl', 'application/sla'], ['.svg', 'map.svg', 'image/svg+xml']
      ]) {
        if (url.pathname.endsWith(suffix)) return route.fulfill({headers, contentType,
          body: fs.readFileSync(path.join(result.folder, filename))});
      }
    }
    return route.abort();
  });
}

// Shared checks cover every visible form field, rather than selected dimension IDs.
async function checkLayoutAndLabels(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const problems = await page.locator('input, select, textarea, button').evaluateAll(controls => controls.flatMap(control => {
    const rect = control.getBoundingClientRect();
    if (!rect.width || !rect.height || getComputedStyle(control).visibility === 'hidden') return [];
    const labels = Array.from(control.labels || []).map(label => label.textContent.trim()).join(' ');
    const referenced = (control.getAttribute('aria-labelledby') || '').split(/\s+/)
      .map(id => document.getElementById(id)?.textContent.trim() || '').join(' ').trim();
    const name = control.getAttribute('aria-label') || referenced || labels ||
      (['button', 'submit', 'reset'].includes(control.type) ? (control.textContent.trim() || control.value) : '');
    const problems = [];
    if (!name) problems.push('Unlabeled control: ' + (control.id || control.outerHTML));
    if (rect.left < -1 || rect.right > innerWidth + 1) problems.push('Clipped control: ' + control.id);
    return problems;
  }));
  expect(problems).toEqual([]);
  expect(await page.evaluate(() => {
    const active = document.activeElement;
    if (active === document.body) return true;
    const rect = active.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && !active.closest('[hidden], [aria-hidden="true"]');
  })).toBe(true);
}

// Screenshot capture waits for fonts and removes time-dependent jQuery transitions.
async function settle(page) {
  await page.evaluate(async () => { $.fx.off = true; await document.fonts.ready; });
}

async function dimensions(page, width, height) {
  await expect.poll(() => page.evaluate(() => [data.get('printWidthCm'), data.get('printHeightCm')])).toEqual([width, height]);
}

test.beforeEach(async ({page}) => {
  page.on('pageerror', error => { throw error; });
});

for (const scenario of [
  {name: 'basic-settings', query: '&size=17&advancedMode=false'},
  {name: 'advanced-landscape', query: '&printWidthCm=20&printHeightCm=10', focus: true},
  {name: 'advanced-portrait-mobile', query: '&printWidthCm=10&printHeightCm=20', mobile: true, focus: true}
]) {
  test('visual: ' + scenario.name, async ({page}) => {
    if (scenario.mobile) await page.setViewportSize({width: 390, height: 844});
    await offline(page);
    await page.goto(base + settings + scenario.query);
    await expect(page.locator('#submit-button')).toBeVisible();
    await settle(page);
    if (scenario.focus) {
      await page.locator('#print-width-input').focus();
      await page.keyboard.press('Tab');
      await expect(page.locator('#print-height-input')).toBeFocused();
      await expect(page.locator('#print-height-input')).toBeVisible();
    }
    await checkLayoutAndLabels(page);
    // Deliberate mutation used to prove the visual gate detects the original border bug.
    if (process.env.TM_UI_FAILURE_PROBE === 'border' && scenario.mobile) {
      await page.addStyleTag({content: '#map-area-preview {outline: none !important} #map-area-preview-container {outline: 1px solid #888}'});
    }
    await expect(page).toHaveScreenshot(scenario.name + '.png', {fullPage: true});
  });
}

for (const technology of ['2d', '3d']) {
  test('visual: result-' + technology, async ({page}) => {
    const folder = path.join(artifacts, technology === '2d' ? '10x20' : '20x10');
    const info = {...JSON.parse(fs.readFileSync(path.join(folder, 'info.json'))), printingTech: technology};
    await offline(page, {folder, info});
    await page.goto(base + '/en/map?map=' + info.requestId.split('/')[0]);
    await expect(page.locator('.map-content-summary li').first()).toBeVisible();
    if (technology === '2d') await expect.poll(() => page.locator('#svg-preview').evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
    else await expect(page.locator('.preview-3d canvas')).toBeVisible();
    await settle(page);
    await checkLayoutAndLabels(page);
    // Preserve viewer layout in the snapshot, but leave WebGL pixels to geometry tests and manual review.
    await expect(page).toHaveScreenshot('result-' + technology + '.png', {fullPage: true,
      mask: technology === '3d' ? [page.locator('.preview-3d canvas')] : []});
    await page.goto(base + '/en/area?map=' + info.requestId.split('/')[0]);
    await dimensions(page, info.printWidthCm, info.printHeightCm);
    await expect(page.locator('#printing-tech-' + technology)).toBeChecked();
    await expect(page.locator('#advanced-input')).toBeChecked();
  });
}

test('settings transitions preserve or reset the whole footprint consistently', async ({page}) => {
  await offline(page);
  await page.goto(base + settings + '&printWidthCm=20&printHeightCm=10&scale=3200');
  await settle(page);
  await dimensions(page, 20, 10);
  await page.goto(base + '/en/area');
  await dimensions(page, 20, 10);
  await expect(page.locator('#scale-input')).toHaveValue('3200');
  await page.reload();
  await dimensions(page, 20, 10);
  await page.check('#multipart-map-input');
  await page.locator('.right-100').click();
  await page.locator('.up-10').click();
  await expect.poll(() => page.evaluate(() => [data.get('multipartXpc'), data.get('multipartYpc')])).toEqual([100, 10]);
  await page.uncheck('#advanced-input');
  await dimensions(page, 17, 17);
  await expect(page.locator('#multipart-map-input')).not.toBeChecked();
  await expect(page.locator('#x-offset-input')).toHaveValue('0');
  await expect(page.locator('#y-offset-input')).toHaveValue('0');
  await page.locator('#map-size-preset').selectOption('20');
  await dimensions(page, 20, 20);
  await page.check('#printing-tech-2d');
  await dimensions(page, 27.9, 27.9);
  await page.check('#advanced-input');
  for (const [axis, value] of [['width', '12.5'], ['height', '8']]) {
    await page.locator('#print-' + axis + '-input').fill(value);
    await page.locator('#print-' + axis + '-input').press('Tab');
  }
  await page.reload();
  await dimensions(page, 12.5, 8);
  await page.uncheck('#advanced-input');
  await dimensions(page, 27.9, 27.9);
  await page.check('#printing-tech-3d');
  await dimensions(page, 20, 20);
  await checkLayoutAndLabels(page);
});

test('invalid parameters expose a textual alert and no creation action', async ({page}) => {
  await offline(page);
  await page.goto(base + settings + '&printWidthCm=0.9&printHeightCm=10');
  const alert = page.getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('at least 1 cm');
  await expect(page.locator('#submit-button')).not.toBeVisible();
  await checkLayoutAndLabels(page);
});
