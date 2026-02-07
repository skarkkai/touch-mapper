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
    tests: [],
    jobs: null,
    offline: false,
    keepExistingOut: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--all") {
      args.all = true;
      continue;
    }
    if (arg === "--test") {
      args.tests.push(argv[i + 1] || "");
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
    throw new Error("Unknown argument: " + arg);
  }
  if (!args.all && args.tests.length === 0) {
    throw new Error("Select tests with --all or one/more --test <name>");
  }
  if (args.jobs !== null && (!Number.isFinite(args.jobs) || args.jobs < 1)) {
    throw new Error("--jobs must be a positive integer");
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function stageStart(testName, stageName) {
  const start = Date.now();
  process.stdout.write("[" + testName + "] START " + stageName + "\n");
  return start;
}

function stageDone(testName, stageName, startMs) {
  const elapsed = (Date.now() - startMs) / 1000;
  process.stdout.write("[" + testName + "] DONE " + stageName + " (" + elapsed.toFixed(2) + "s)\n");
  return elapsed;
}

function stageFail(testName, stageName, startMs, error) {
  const elapsed = (Date.now() - startMs) / 1000;
  process.stdout.write("[" + testName + "] FAIL " + stageName + " (" + elapsed.toFixed(2) + "s): " + error.message + "\n");
  return elapsed;
}

async function runStage(testName, stageName, timings, fn) {
  const start = stageStart(testName, stageName);
  try {
    const result = await fn();
    timings[stageName] = stageDone(testName, stageName, start);
    return result;
  } catch (error) {
    timings[stageName] = stageFail(testName, stageName, start, error);
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
  const urls = [
    "https://api.openstreetmap.org/api/0.6/map?bbox=" + encodeURIComponent(bbox),
    "https://overpass-api.de/api/map?bbox=" + encodeURIComponent(bbox),
    "https://overpass.kumi.systems/api/map?bbox=" + encodeURIComponent(bbox)
  ];
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

function runGenerator(repoRoot, testName, sourceOsmPath, pipelineDir, requestBody) {
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
    "[" + testName + "]"
  ];
  if (requestBody.excludeBuildings) {
    args.push("--exclude-buildings");
  }

  return new Promise(function(resolve, reject) {
    const child = spawn("python3", args, {
      cwd: repoRoot,
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
    throw new Error("Test '" + testDef.name + "' missing requestBody object");
  }
  const area = testDef.requestBody.effectiveArea;
  if (!area || !Number.isFinite(Number(area.lonMin)) || !Number.isFinite(Number(area.lonMax)) ||
      !Number.isFinite(Number(area.latMin)) || !Number.isFinite(Number(area.latMax))) {
    throw new Error("Test '" + testDef.name + "' has invalid requestBody.effectiveArea values");
  }
}

async function runSingleTest(repoRoot, testDef, args, locales) {
  const testName = testDef.name;
  const timings = {};
  const totalStart = Date.now();

  const cacheDir = path.join(repoRoot, "test", "map-content", "cache", testName);
  const outDir = path.join(repoRoot, "test", "map-content", "out", testName);
  const sourceDir = path.join(outDir, "source");
  const pipelineDir = path.join(outDir, "pipeline");
  const descriptionsDir = path.join(outDir, "descriptions");
  const cacheMapInfoPath = path.join(cacheDir, "map-info.json");
  const cacheOsmPath = path.join(cacheDir, "map.osm");

  try {
    await runStage(testName, "resolve-test-config", timings, async function() {
      ensureRequestBody(testDef);
      if (!args.keepExistingOut) {
        fs.rmSync(outDir, { recursive: true, force: true });
      }
      fs.mkdirSync(sourceDir, { recursive: true });
      fs.mkdirSync(pipelineDir, { recursive: true });
      fs.mkdirSync(descriptionsDir, { recursive: true });
      fs.mkdirSync(cacheDir, { recursive: true });
    });

    const mapInfo = await runStage(testName, "fetch-map-info", timings, async function() {
      const info = {
        name: testDef.name,
        requestBody: testDef.requestBody
      };
      writeJson(cacheMapInfoPath, info);
      writeJson(path.join(sourceDir, "map-info.json"), info);
      return info;
    });

    const sourceOsmPath = await runStage(testName, "fetch-map-osm", timings, async function() {
      await fetchOsmToCache(cacheOsmPath, mapInfo.requestBody, args.offline);
      const sourcePath = path.join(sourceDir, "map.osm");
      fs.copyFileSync(cacheOsmPath, sourcePath);
      return sourcePath;
    });

    const generation = await runStage(testName, "generate-map-content", timings, async function() {
      return runGenerator(repoRoot, testName, sourceOsmPath, pipelineDir, mapInfo.requestBody);
    });
    if (generation && generation.timings && typeof generation.timings === "object") {
      Object.keys(generation.timings).forEach(function(key) {
        const value = generation.timings[key];
        if (Number.isFinite(value)) {
          timings["generate-map-content." + key] = value;
        }
      });
    }

    const structuredByLocale = await runStage(testName, "render-structured-models", timings, async function() {
      const byLocale = {};
      locales.forEach(function(locale) {
        const artifact = inspect.inspectMapDescription({
          repoRoot: repoRoot,
          locale: locale,
          mapContentPath: generation.mapContentPath
        });
        artifact.source.testName = testName;
        artifact.source.requestBody = testDef.requestBody;
        byLocale[locale] = artifact;

        const localeDir = path.join(descriptionsDir, locale);
        fs.mkdirSync(localeDir, { recursive: true });
        writeJson(path.join(localeDir, "structured.json"), artifact);
      });
      return byLocale;
    });

    await runStage(testName, "render-text-simulations", timings, async function() {
      locales.forEach(function(locale) {
        const artifact = structuredByLocale[locale];
        const localeDir = path.join(descriptionsDir, locale);
        const simulationText = renderSimulationText(artifact.mapDescriptionModel);
        fs.writeFileSync(path.join(localeDir, "simulated.txt"), simulationText, "utf8");
      });
    });

    await runStage(testName, "write-manifest-and-timings", timings, async function() {
      writeJson(path.join(outDir, "manifest.json"), {
        test: {
          name: testDef.name
        },
        locales: locales,
        files: listFilesRecursive(outDir),
        generatedAt: new Date().toISOString()
      });
    });

    const totalSeconds = (Date.now() - totalStart) / 1000;
    const timingsWithTotal = Object.assign({}, timings, { total: totalSeconds });
    writeJson(path.join(outDir, "timings.json"), timingsWithTotal);

    return {
      name: testName,
      status: "ok",
      durationSec: (Date.now() - totalStart) / 1000,
      error: null
    };
  } catch (error) {
    return {
      name: testName,
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
      result.name,
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
  const byName = {};
  allTests.forEach(function(testDef) {
    byName[testDef.name] = testDef;
  });

  const selectedTests = args.all
    ? allTests.slice()
    : args.tests.map(function(name) {
        if (!byName[name]) {
          throw new Error("Unknown test name: " + name);
        }
        return byName[name];
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
