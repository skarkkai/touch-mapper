'use strict';
const path = require('path');
const {defineConfig} = require('playwright/test');
const assert = require('assert');
assert.strictEqual(require('playwright/package.json').version, '1.58.2', 'Use the documented pinned Playwright runtime');

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: 'ui-regression.spec.js',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 20000,
  outputDir: path.resolve(__dirname, '../../.tmp/e2e/ui-regression'),
  snapshotPathTemplate: '{testDir}/screenshots/{arg}{ext}',
  updateSnapshots: 'none', // Missing baselines must fail, never silently become accepted.
  reporter: 'list',
  expect: {timeout: 5000, toHaveScreenshot: {animations: 'disabled', caret: 'hide', threshold: 0.2, maxDiffPixels: 0}},
  use: {
    browserName: 'chromium', headless: true,
    viewport: {width: 1100, height: 1000}, deviceScaleFactor: 1,
    locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', reducedMotion: 'reduce',
    screenshot: 'only-on-failure', trace: 'retain-on-failure'
  }
});
