#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

function parseArgs(argv) {
  const opts = {
    baseUrl: "https://test.touch-mapper.org",
    address: "Helsinki Central Railway Station",
    headless: true,
    timeoutMs: 420000
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base-url") {
      opts.baseUrl = argv[i + 1];
      i += 1;
    } else if (arg === "--address") {
      opts.address = argv[i + 1];
      i += 1;
    } else if (arg === "--headed") {
      opts.headless = false;
    } else if (arg === "--timeout-ms") {
      opts.timeoutMs = Number(argv[i + 1]);
      i += 1;
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error("Unknown argument: " + arg);
    }
  }

  if (!opts.baseUrl) {
    throw new Error("--base-url cannot be empty");
  }
  if (!opts.address) {
    throw new Error("--address cannot be empty");
  }
  if (!Number.isFinite(opts.timeoutMs) || opts.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number");
  }

  return opts;
}

function printHelp() {
  console.log(
    [
      "Usage: node test/e2e/touch-mapper-settings-regression.js [options]",
      "",
      "Options:",
      "  --base-url <url>     Base URL to test (default: https://test.touch-mapper.org)",
      "  --address <text>      Address query to submit",
      "  --timeout-ms <n>      Max wait for map generation (default: 420000)",
      "  --headed              Run with visible browser",
      "  --help                Show this help"
    ].join("\n")
  );
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeNumericString(value) {
  if (value === null || value === undefined) {
    return "";
  }
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? String(parsed) : String(value);
}

function expectEqual(label, actual, expected, failures, normalizeNumeric) {
  const lhs = normalizeNumeric ? normalizeNumericString(actual) : String(actual);
  const rhs = normalizeNumeric ? normalizeNumericString(expected) : String(expected);
  if (lhs !== rhs) {
    failures.push({ label, expected: String(expected), actual: String(actual) });
  }
}

async function readAreaSettings(page) {
  return page.evaluate(() => {
    const q = (selector) => document.querySelector(selector);
    const getValue = (selector) => {
      const el = q(selector);
      return el ? el.value : null;
    };
    const isChecked = (selector) => {
      const el = q(selector);
      return el ? Boolean(el.checked) : null;
    };
    const getText = (selector) => {
      const el = q(selector);
      return el ? (el.textContent || "").trim() : null;
    };

    let printingTech = null;
    if (isChecked("#printing-tech-2d")) printingTech = "2d";
    if (isChecked("#printing-tech-3d")) printingTech = "3d";

    return {
      url: location.href,
      address: getText(".first-address"),
      printingTech,
      mapSizePreset: getValue("#map-size-preset"),
      mapScalePreset: getValue("#map-scale-preset"),
      contentMode: getValue("#content-mode"),
      hideLocationMarker: isChecked("#hide-location-marker"),
      advanced: isChecked("#advanced-input"),
      lon: getValue("#lon-input"),
      lat: getValue("#lat-input"),
      xOffset: getValue("#x-offset-input"),
      yOffset: getValue("#y-offset-input"),
      mapSizeInput: getValue("#map-size-input"),
      scaleInput: getValue("#scale-input"),
      multipart: isChecked("#multipart-map-input"),
      multipartAdjustmentX: getText(".multipart-adjustment-x"),
      multipartAdjustmentY: getText(".multipart-adjustment-y")
    };
  });
}

async function setSelectValueByDom(page, selector, value) {
  await page.$eval(
    selector,
    (el, nextValue) => {
      el.value = nextValue;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    value
  );
}

(async () => {
  const options = parseArgs(process.argv.slice(2));
  const runId = "settings-regression-" + Date.now();
  const outDir = path.join(".tmp", "e2e", runId);
  fs.mkdirSync(outDir, { recursive: true });

  const logs = {
    startedAt: nowIso(),
    console: [],
    pageErrors: [],
    requestFailures: []
  };

  const expectedSettings = {
    printingTech: "2d",
    mapSizePreset: "20",
    mapScalePreset: "5600",
    contentMode: "only-big-roads",
    hideLocationMarker: true,
    advanced: true,
    xOffset: "120",
    yOffset: "-80",
    mapSizeInput: "28.0",
    scaleInput: "5600",
    multipart: true,
    multipartAdjustmentX: "10",
    multipartAdjustmentY: "10"
  };

  const browser = await chromium.launch({ headless: options.headless });
  const context = await browser.newContext({ viewport: { width: 1440, height: 2200 } });
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "warning" || msg.type() === "error") {
      logs.console.push({ type: msg.type(), text: msg.text() });
    }
  });
  page.on("pageerror", (err) => {
    logs.pageErrors.push(String(err));
  });
  page.on("requestfailed", (req) => {
    logs.requestFailures.push({
      method: req.method(),
      url: req.url(),
      failure: req.failure() ? req.failure().errorText : "unknown"
    });
  });

  let report;
  try {
    await page.goto(options.baseUrl + "/", { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForURL(/\/en\/?$/, { timeout: 120000 });
    await page.waitForSelector("#address-input", { timeout: 120000 });

    await page.fill("#address-input", options.address);
    await Promise.all([
      page.waitForURL(/\/en\/area/, { timeout: 180000 }),
      page.click("#address-search-submit")
    ]);

    await page.waitForSelector("#submit-button", { timeout: 120000 });
    await page.waitForFunction(() => {
      const first = document.querySelector(".first-address");
      return Boolean(first && (first.textContent || "").trim());
    }, { timeout: 120000 });

    await page.screenshot({ path: path.join(outDir, "01-area-initial.png"), fullPage: true });

    await setSelectValueByDom(page, "#map-size-preset", expectedSettings.mapSizePreset);
    await setSelectValueByDom(page, "#map-scale-preset", expectedSettings.mapScalePreset);
    await setSelectValueByDom(page, "#content-mode", expectedSettings.contentMode);

    await page.check("#printing-tech-2d");
    await page.check("#hide-location-marker");

    await page.check("#advanced-input");
    await page.waitForSelector("#advanced-controls", { state: "visible", timeout: 120000 });

    await page.fill("#x-offset-input", expectedSettings.xOffset);
    await page.fill("#y-offset-input", expectedSettings.yOffset);
    await page.fill("#map-size-input", expectedSettings.mapSizeInput);
    await page.fill("#scale-input", expectedSettings.scaleInput);
    await page.check("#multipart-map-input");

    await page.click(".area-movement-buttons .right-10");
    await page.click(".area-movement-buttons .up-10");

    const beforeSubmit = await readAreaSettings(page);
    await page.screenshot({ path: path.join(outDir, "02-area-configured.png"), fullPage: true });

    await Promise.all([
      page.waitForURL(/\/en\/map\?map=/, { timeout: options.timeoutMs }),
      page.click("#submit-button")
    ]);

    await page.waitForLoadState("domcontentloaded", { timeout: 180000 });
    await page.waitForSelector(".map-content", { timeout: 180000 });
    await page.waitForTimeout(6000);

    const mapChecks = await page.evaluate(() => {
      const q = (selector) => document.querySelector(selector);
      const cssDisplay = (selector) => {
        const el = q(selector);
        return el ? window.getComputedStyle(el).display : null;
      };
      return {
        url: location.href,
        title: document.title,
        noDataDisplay: cssDisplay(".no-data-available-msg"),
        has3dPreviewContainer: Boolean(q(".preview-3d")),
        downloadMapHref: q("#download-map") ? q("#download-map").getAttribute("href") : null,
        mapContentHref: q("#download-map-content") ? q("#download-map-content").getAttribute("href") : null,
        summaryItems: Array.from(document.querySelectorAll(".map-content-summary li")).length,
        backLinkText: q("a.back-to-previous-page") ? (q("a.back-to-previous-page").textContent || "").trim() : ""
      };
    });

    await page.screenshot({ path: path.join(outDir, "03-map-created.png"), fullPage: true });

    await page.click("a.back-to-previous-page");
    await page.waitForURL(/\/en\/area/, { timeout: 120000 });
    await page.waitForSelector("#submit-button", { timeout: 120000 });

    const afterReturn = await readAreaSettings(page);
    await page.screenshot({ path: path.join(outDir, "04-area-returned.png"), fullPage: true });

    const failures = [];

    if (mapChecks.noDataDisplay !== "none") {
      failures.push({
        label: "map-page.no-data-msg",
        expected: "none",
        actual: String(mapChecks.noDataDisplay)
      });
    }
    if (!mapChecks.downloadMapHref) {
      failures.push({ label: "map-page.download-map-href", expected: "non-empty", actual: "empty" });
    }
    if (!mapChecks.mapContentHref) {
      failures.push({ label: "map-page.map-content-href", expected: "non-empty", actual: "empty" });
    }
    if (mapChecks.summaryItems < 1) {
      failures.push({ label: "map-page.summary-items", expected: ">= 1", actual: String(mapChecks.summaryItems) });
    }

    expectEqual("settings.printingTech", afterReturn.printingTech, expectedSettings.printingTech, failures);
    expectEqual("settings.mapSizePreset", afterReturn.mapSizePreset, expectedSettings.mapSizePreset, failures);
    expectEqual("settings.mapScalePreset", afterReturn.mapScalePreset, expectedSettings.mapScalePreset, failures);
    expectEqual("settings.contentMode", afterReturn.contentMode, expectedSettings.contentMode, failures);
    expectEqual("settings.hideLocationMarker", afterReturn.hideLocationMarker, expectedSettings.hideLocationMarker, failures);
    expectEqual("settings.advanced", afterReturn.advanced, expectedSettings.advanced, failures);
    expectEqual("settings.xOffset", afterReturn.xOffset, expectedSettings.xOffset, failures);
    expectEqual("settings.yOffset", afterReturn.yOffset, expectedSettings.yOffset, failures);
    expectEqual("settings.mapSizeInput", afterReturn.mapSizeInput, expectedSettings.mapSizeInput, failures, true);
    expectEqual("settings.scaleInput", afterReturn.scaleInput, expectedSettings.scaleInput, failures);
    expectEqual("settings.multipart", afterReturn.multipart, expectedSettings.multipart, failures);
    expectEqual("settings.multipartAdjustmentX", afterReturn.multipartAdjustmentX, expectedSettings.multipartAdjustmentX, failures);
    expectEqual("settings.multipartAdjustmentY", afterReturn.multipartAdjustmentY, expectedSettings.multipartAdjustmentY, failures);

    logs.finishedAt = nowIso();

    report = {
      success: failures.length === 0,
      outDir,
      options,
      expectedSettings,
      beforeSubmit,
      afterReturn,
      mapChecks,
      failures,
      logCounts: {
        consoleWarningsOrErrors: logs.console.length,
        pageErrors: logs.pageErrors.length,
        requestFailures: logs.requestFailures.length
      },
      logs
    };

    fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));

    if (failures.length > 0) {
      console.error("Regression test FAILED. See " + path.join(outDir, "report.json"));
      failures.forEach((f) => {
        console.error(" - " + f.label + " expected=" + f.expected + " actual=" + f.actual);
      });
      process.exitCode = 1;
    } else {
      console.log("Regression test PASSED. See " + path.join(outDir, "report.json"));
    }
  } catch (error) {
    logs.finishedAt = nowIso();
    report = {
      success: false,
      outDir,
      options,
      error: String(error),
      stack: error && error.stack ? String(error.stack) : null,
      logs
    };
    fs.writeFileSync(path.join(outDir, "report-error.json"), JSON.stringify(report, null, 2));
    console.error("Regression test crashed. See " + path.join(outDir, "report-error.json"));
    console.error(String(error));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
