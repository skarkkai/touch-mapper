#!/usr/bin/env node

"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { spawnSync } = require("child_process");
const inspect = require("./inspect-map-description.js");
const { renderSimulationText } = require("./render-text-simulation.js");

function parseArgs(argv) {
  const args = {
    all: false,
    categories: [],
    jobs: null,
    offline: false,
    keepExistingOut: false,
    withBlender: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--all") {
      args.all = true;
      continue;
    }
    if (arg === "--category") {
      args.categories.push(argv[i + 1] || "");
      i += 1;
      continue;
    }
    if (arg === "--jobs") {
      args.jobs = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--offline") {
      args.offline = true;
      continue;
    }
    if (arg === "--keep-existing-out") {
      args.keepExistingOut = true;
      continue;
    }
    if (arg === "--with-blender") {
      args.withBlender = true;
      continue;
    }
    throw new Error("Unknown argument: " + arg);
  }
  if (!args.all && args.categories.length === 0) {
    throw new Error("Select categories with --all or one/more --category <simple|average|complex>");
  }
  if (args.jobs !== null && (!Number.isFinite(args.jobs) || args.jobs < 1)) {
    throw new Error("--jobs must be a positive integer");
  }
  return args;
}

function buildMarkerArg(requestBody) {
  if (!requestBody || typeof requestBody !== "object") {
    return null;
  }
  if (requestBody.hideLocationMarker || requestBody.multipartMode || !requestBody.marker1) {
    return null;
  }
  const area = requestBody.effectiveArea;
  if (!area || typeof area !== "object") {
    return null;
  }
  const lonMin = Number(area.lonMin);
  const lonMax = Number(area.lonMax);
  const latMin = Number(area.latMin);
  const latMax = Number(area.latMax);
  const markerLon = Number(requestBody.marker1.lon);
  const markerLat = Number(requestBody.marker1.lat);
  if (!Number.isFinite(lonMin) || !Number.isFinite(lonMax) || !Number.isFinite(latMin) || !Number.isFinite(latMax)) {
    return null;
  }
  if (!Number.isFinite(markerLon) || !Number.isFinite(markerLat)) {
    return null;
  }
  const width = lonMax - lonMin;
  const height = latMax - latMin;
  if (width === 0 || height === 0) {
    return null;
  }
  const marker1x = (markerLon - lonMin) / width;
  const marker1y = (markerLat - latMin) / height;
  if (!(marker1x > 0.04 && marker1x < 0.96 && marker1y > 0.04 && marker1y < 0.96)) {
    return null;
  }
  return JSON.stringify({ x: marker1x, y: marker1y });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function prettyPrintJsonFiles(rootDir) {
  listFilesRecursive(rootDir).forEach(function(fileInfo) {
    if (!fileInfo.path.toLowerCase().endsWith(".json")) {
      return;
    }
    const absPath = path.join(rootDir, fileInfo.path);
    let parsed = null;
    try {
      parsed = JSON.parse(fs.readFileSync(absPath, "utf8"));
    } catch (error) {
      throw new Error("Could not parse JSON file for pretty-printing: " + absPath + " (" + error.message + ")");
    }
    fs.writeFileSync(absPath, JSON.stringify(parsed, null, 2) + "\n", "utf8");
  });
}

function stageStart(testCategory, stageName) {
  const start = Date.now();
  process.stdout.write("[" + testCategory + "] START " + stageName + "\n");
  return start;
}

function childTimingTotalSeconds(timings, stageName) {
  const prefix = stageName + ".";
  let total = 0;
  Object.keys(timings).forEach(function(key) {
    if (!key.startsWith(prefix)) {
      return;
    }
    const suffix = key.slice(prefix.length);
    if (!suffix || suffix === "total" || suffix.indexOf(".") !== -1) {
      return;
    }
    const value = timings[key];
    if (!Number.isFinite(value)) {
      return;
    }
    total += value;
  });
  return total;
}

function stageDone(testCategory, stageName, startMs) {
  const elapsed = (Date.now() - startMs) / 1000;
  process.stdout.write("[" + testCategory + "] DONE " + stageName + " (" + elapsed.toFixed(2) + "s)\n");
  return elapsed;
}

function stageDoneWithTimings(testCategory, stageName, startMs, timings) {
  const elapsed = (Date.now() - startMs) / 1000;
  const childTotal = childTimingTotalSeconds(timings, stageName);
  const selfTime = Math.max(0, elapsed - childTotal);
  if (childTotal > 0.0005) {
    process.stdout.write(
      "[" + testCategory + "] DONE " + stageName +
      " (total " + elapsed.toFixed(2) + "s, self " + selfTime.toFixed(2) + "s, child " + childTotal.toFixed(2) + "s)\n"
    );
  } else {
    process.stdout.write("[" + testCategory + "] DONE " + stageName + " (" + elapsed.toFixed(2) + "s)\n");
  }
  return elapsed;
}

function stageFail(testCategory, stageName, startMs, error, timings) {
  const elapsed = (Date.now() - startMs) / 1000;
  const childTotal = childTimingTotalSeconds(timings, stageName);
  const selfTime = Math.max(0, elapsed - childTotal);
  if (childTotal > 0.0005) {
    process.stdout.write(
      "[" + testCategory + "] FAIL " + stageName +
      " (total " + elapsed.toFixed(2) + "s, self " + selfTime.toFixed(2) + "s, child " + childTotal.toFixed(2) + "s): " +
      error.message + "\n"
    );
  } else {
    process.stdout.write("[" + testCategory + "] FAIL " + stageName + " (" + elapsed.toFixed(2) + "s): " + error.message + "\n");
  }
  return elapsed;
}

async function runStage(testCategory, stageName, timings, fn) {
  const start = stageStart(testCategory, stageName);
  try {
    const result = await fn();
    timings[stageName] = stageDoneWithTimings(testCategory, stageName, start, timings);
    return result;
  } catch (error) {
    timings[stageName] = stageFail(testCategory, stageName, start, error, timings);
    throw error;
  }
}

function discoverLocales(repoRoot) {
  const localesDir = path.join(repoRoot, "web", "locales");
  return fs.readdirSync(localesDir).filter(function(name) {
    const localeDir = path.join(localesDir, name);
    return fs.statSync(localeDir).isDirectory() && fs.existsSync(path.join(localeDir, "tm.json"));
  }).sort();
}

function listFilesRecursive(rootDir) {
  const files = [];
  function walk(currentDir) {
    fs.readdirSync(currentDir).forEach(function(entry) {
      const abs = path.join(currentDir, entry);
      const rel = path.relative(rootDir, abs);
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        walk(abs);
      } else {
        files.push({
          path: rel,
          size: stat.size
        });
      }
    });
  }
  if (fs.existsSync(rootDir)) {
    walk(rootDir);
  }
  files.sort(function(a, b) { return a.path.localeCompare(b.path); });
  return files;
}

function fetchWithCurl(url) {
  const result = spawnSync("curl", ["-sSfL", url], {
    encoding: null
  });
  if (result.status !== 0) {
    const errorText = result.stderr ? String(result.stderr) : "curl failed";
    throw new Error(errorText.trim() || "curl failed");
  }
  return result.stdout;
}

function overpassMapUrls(bbox) {
  // Public instances from OSM wiki (current list), using map endpoint for bbox export.
  return [
    "https://overpass.private.coffee/api/map?bbox=" + encodeURIComponent(bbox),
    "https://overpass-api.de/api/map?bbox=" + encodeURIComponent(bbox),
    "https://maps.mail.ru/osm/tools/overpass/api/map?bbox=" + encodeURIComponent(bbox)
  ];
}

async function fetchOsmToCache(cacheOsmPath, requestBody, offline) {
  if (fs.existsSync(cacheOsmPath)) {
    return;
  }
  if (offline) {
    throw new Error("Offline mode enabled and cached OSM not found: " + cacheOsmPath);
  }
  const area = requestBody && requestBody.effectiveArea ? requestBody.effectiveArea : null;
  if (!area) {
    throw new Error("requestBody.effectiveArea is required to fetch OSM");
  }
  const bbox = [area.lonMin, area.latMin, area.lonMax, area.latMax].join(",");
  const urls = overpassMapUrls(bbox).concat([
    "https://api.openstreetmap.org/api/0.6/map?bbox=" + encodeURIComponent(bbox)
  ]);
  let response = null;
  let lastError = null;
  for (let i = 0; i < urls.length; i += 1) {
    try {
      response = fetchWithCurl(urls[i]);
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!response) {
    throw new Error("Could not fetch OSM from any endpoint: " + (lastError ? lastError.message : "unknown error"));
  }
  fs.mkdirSync(path.dirname(cacheOsmPath), { recursive: true });
  fs.writeFileSync(cacheOsmPath, response);
}

function runGenerator(repoRoot, testCategory, sourceOsmPath, pipelineDir, requestBody) {
  const generatorPath = path.join(repoRoot, "test", "map-content", "generate-map-content-from-osm.py");
  const args = [
    generatorPath,
    "--osm",
    sourceOsmPath,
    "--out-dir",
    pipelineDir,
    "--scale",
    String(Number(requestBody.scale || 1400)),
    "--log-prefix",
    "[" + testCategory + "]  "
  ];
  if (requestBody.excludeBuildings) {
    args.push("--exclude-buildings");
  }
  if (requestBody.noBorders) {
    args.push("--no-borders");
  }
  if (Number.isFinite(Number(requestBody.diameter))) {
    args.push("--diameter", String(Number(requestBody.diameter)));
  }
  if (Number.isFinite(Number(requestBody.size))) {
    args.push("--size", String(Number(requestBody.size)));
  }
  const marker1 = buildMarkerArg(requestBody);
  if (marker1) {
    args.push("--marker1", marker1);
  }
  if (requestBody.withBlender) {
    args.push("--with-blender");
  }

  return new Promise(function(resolve, reject) {
    const child = spawn("python3", args, {
      cwd: repoRoot,
      env: Object.assign({}, process.env, {
        TOUCH_MAPPER_PRETTY_JSON: "1"
      }),
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", function(chunk) { stdout += String(chunk); });
    child.stderr.on("data", function(chunk) {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });

    child.on("error", reject);
    child.on("close", function(code) {
      if (code !== 0) {
        reject(new Error("Generator failed with code " + code + "\n" + stderr));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error("Could not parse generator JSON output: " + error.message + "\nstdout:\n" + stdout));
      }
    });
  });
}

function ensureRequestBody(testDef) {
  if (!testDef.requestBody || typeof testDef.requestBody !== "object") {
    throw new Error("Category '" + testDef.category + "' missing requestBody object");
  }
  const area = testDef.requestBody.effectiveArea;
  if (!area || !Number.isFinite(Number(area.lonMin)) || !Number.isFinite(Number(area.lonMax)) ||
      !Number.isFinite(Number(area.latMin)) || !Number.isFinite(Number(area.latMax))) {
    throw new Error("Category '" + testDef.category + "' has invalid requestBody.effectiveArea values");
  }
}

async function runSingleTest(repoRoot, testDef, args, locales) {
  const testCategory = testDef.category;
  const timings = {};
  const totalStart = Date.now();

  const cacheDir = path.join(repoRoot, "test", "map-content", "cache", testCategory);
  const outDir = path.join(repoRoot, "test", "map-content", "out", testCategory);
  const sourceDir = path.join(outDir, "source");
  const pipelineDir = path.join(outDir, "pipeline");
  const descriptionsDir = path.join(outDir, "descriptions");
  const cacheMapInfoPath = path.join(cacheDir, "map-info.json");
  const cacheOsmPath = path.join(cacheDir, "map.osm");

  try {
    await runStage(testCategory, "resolve-test-config", timings, async function() {
      ensureRequestBody(testDef);
      if (!args.keepExistingOut) {
        fs.rmSync(outDir, { recursive: true, force: true });
      }
      fs.mkdirSync(sourceDir, { recursive: true });
      fs.mkdirSync(pipelineDir, { recursive: true });
      fs.mkdirSync(descriptionsDir, { recursive: true });
      fs.mkdirSync(cacheDir, { recursive: true });
    });

    const mapInfo = await runStage(testCategory, "fetch-map-info", timings, async function() {
      const info = {
        category: testDef.category,
        requestBody: testDef.requestBody
      };
      writeJson(cacheMapInfoPath, info);
      writeJson(path.join(sourceDir, "map-info.json"), info);
      return info;
    });

    const sourceOsmPath = await runStage(testCategory, "fetch-map-osm", timings, async function() {
      await fetchOsmToCache(cacheOsmPath, mapInfo.requestBody, args.offline);
      const sourcePath = path.join(sourceDir, "map.osm");
      fs.copyFileSync(cacheOsmPath, sourcePath);
      return sourcePath;
    });

    const generation = await runStage(testCategory, "generate-map-content", timings, async function() {
      const requestBody = Object.assign({}, mapInfo.requestBody, {
        withBlender: args.withBlender
      });
      const generated = await runGenerator(repoRoot, testCategory, sourceOsmPath, pipelineDir, requestBody);
      if (generated && generated.timings && typeof generated.timings === "object") {
        Object.keys(generated.timings).forEach(function(key) {
          const value = generated.timings[key];
          if (Number.isFinite(value)) {
            timings["generate-map-content." + key] = value;
          }
        });
      }
      return generated;
    });

    const structuredByLocale = await runStage(testCategory, "render-structured-models", timings, async function() {
      const byLocale = {};
      locales.forEach(function(locale) {
        const artifact = inspect.inspectMapDescription({
          repoRoot: repoRoot,
          locale: locale,
          mapContentPath: generation.mapContentPath
        });
        artifact.source.testCategory = testCategory;
        artifact.source.requestBody = testDef.requestBody;
        byLocale[locale] = artifact;

        const localeDir = path.join(descriptionsDir, locale);
        fs.mkdirSync(localeDir, { recursive: true });
        writeJson(path.join(localeDir, "structured.json"), artifact);
      });
      return byLocale;
    });

    await runStage(testCategory, "render-text-simulations", timings, async function() {
      locales.forEach(function(locale) {
        const artifact = structuredByLocale[locale];
        const localeDir = path.join(descriptionsDir, locale);
        const simulationText = renderSimulationText(artifact.mapDescriptionModel);
        fs.writeFileSync(path.join(localeDir, "simulated.txt"), simulationText, "utf8");
      });
    });

    await runStage(testCategory, "write-manifest-and-timings", timings, async function() {
      writeJson(path.join(outDir, "manifest.json"), {
        test: {
          category: testDef.category
        },
        locales: locales,
        files: listFilesRecursive(outDir),
        generatedAt: new Date().toISOString()
      });
    });

    const totalSeconds = (Date.now() - totalStart) / 1000;
    const timingsWithTotal = Object.assign({}, timings, { total: totalSeconds });
    writeJson(path.join(outDir, "timings.json"), timingsWithTotal);
    await runStage(testCategory, "pretty-print-json-outputs", timings, async function() {
      prettyPrintJsonFiles(outDir);
    });

    return {
      category: testCategory,
      status: "ok",
      durationSec: (Date.now() - totalStart) / 1000,
      error: null
    };
  } catch (error) {
    return {
      category: testCategory,
      status: "failed",
      durationSec: (Date.now() - totalStart) / 1000,
      error: error.message
    };
  }
}

async function runWithConcurrency(items, maxParallel, workerFn) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await workerFn(items[index]);
    }
  }

  const workerCount = Math.min(maxParallel, items.length);
  const workers = [];
  for (let i = 0; i < workerCount; i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

function printSummary(results) {
  process.stdout.write("\nSummary\n");
  results.forEach(function(result) {
    const line = [
      result.status.toUpperCase(),
      result.category,
      result.durationSec.toFixed(2) + "s"
    ];
    if (result.error) {
      line.push(result.error);
    }
    process.stdout.write(line.join("\t") + "\n");
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, "..", "..");
  const testsPath = path.join(repoRoot, "test", "map-content", "tests.json");
  const testsFile = readJson(testsPath);
  const allTests = Array.isArray(testsFile.tests) ? testsFile.tests : [];
  const byCategory = {};
  allTests.forEach(function(testDef) {
    byCategory[testDef.category] = testDef;
  });

  const selectedTests = args.all
    ? allTests.slice()
    : args.categories.map(function(category) {
        if (!byCategory[category]) {
          throw new Error("Unknown category: " + category);
        }
        return byCategory[category];
      });

  if (selectedTests.length === 0) {
    throw new Error("No tests selected");
  }

  const locales = discoverLocales(repoRoot);
  const jobs = args.jobs === null ? selectedTests.length : Math.min(args.jobs, selectedTests.length);

  const results = await runWithConcurrency(selectedTests, jobs, function(testDef) {
    return runSingleTest(repoRoot, testDef, args, locales);
  });

  printSummary(results);
  const failed = results.filter(function(result) { return result.status !== "ok"; });
  if (failed.length) {
    process.exitCode = 1;
  }
}

main().catch(function(error) {
  process.stderr.write((error && error.message ? error.message : String(error)) + "\n");
  process.exit(1);
});
