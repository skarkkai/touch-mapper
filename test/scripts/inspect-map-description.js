#!/usr/bin/env node

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { spawnSync } = require("child_process");

function parseArgs(argv) {
  const args = {
    locale: "en",
    out: null,
    osm: null,
    workDir: null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--osm") {
      args.osm = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (arg === "--locale") {
      args.locale = argv[i + 1] || "en";
      i += 1;
      continue;
    }
    if (arg === "--out") {
      args.out = argv[i + 1] || null;
      i += 1;
      continue;
    }
    if (arg === "--work-dir") {
      args.workDir = argv[i + 1] || null;
      i += 1;
      continue;
    }
    throw new Error("Unknown argument: " + arg);
  }
  if (!args.osm) {
    throw new Error("Missing required argument: --osm <path-to-map.osm>");
  }
  if (!args.out) {
    throw new Error("Missing required argument: --out <path-to-output.json>");
  }
  return args;
}

function readJson(jsonPath) {
  const raw = fs.readFileSync(jsonPath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error("Failed to parse JSON file: " + jsonPath + " (" + error.message + ")");
  }
}

function loadScriptIntoContext(context, scriptPath) {
  const source = fs.readFileSync(scriptPath, "utf8");
  vm.runInContext(source, context, { filename: scriptPath });
}

function makeTranslator(localeDict, enDict) {
  return function t(key, fallback) {
    if (localeDict[key] !== undefined && localeDict[key] !== null && localeDict[key] !== "") {
      return localeDict[key];
    }
    if (enDict[key] !== undefined && enDict[key] !== null && enDict[key] !== "") {
      return enDict[key];
    }
    return fallback !== undefined ? fallback : key;
  };
}

function ensureFileExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(label + " not found: " + filePath);
  }
}

function runPythonGenerator(repoRoot, osmPath, workDir) {
  const generatorPath = path.join(repoRoot, "test", "scripts", "generate-map-content-from-osm.py");
  ensureFileExists(generatorPath, "Python generator");
  const outputDir = workDir || fs.mkdtempSync(path.join(os.tmpdir(), "tm-map-desc-"));
  fs.mkdirSync(outputDir, { recursive: true });

  const cmdArgs = [
    generatorPath,
    "--osm",
    osmPath,
    "--out-dir",
    outputDir
  ];
  const result = spawnSync("python3", cmdArgs, {
    cwd: repoRoot,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    throw new Error(
      "Failed to generate map-content.json.\nstdout:\n" + stdout + "\nstderr:\n" + stderr
    );
  }
  return JSON.parse(result.stdout);
}

function resolveLocaleDict(repoRoot, locale) {
  const enPath = path.join(repoRoot, "web", "locales", "en", "tm.json");
  ensureFileExists(enPath, "English locale dictionary");
  const enDict = readJson(enPath);

  const localePath = path.join(repoRoot, "web", "locales", locale, "tm.json");
  if (!fs.existsSync(localePath)) {
    throw new Error("Locale dictionary not found for locale '" + locale + "': " + localePath);
  }
  const localeDict = readJson(localePath);
  return { localeDict, enDict };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, "..", "..");
  const osmPath = path.resolve(args.osm);
  ensureFileExists(osmPath, "Input OSM file");

  const generation = runPythonGenerator(repoRoot, osmPath, args.workDir ? path.resolve(args.workDir) : null);
  const mapContentPath = generation.mapContentPath;
  ensureFileExists(mapContentPath, "Generated map-content.json");
  const mapContent = readJson(mapContentPath);

  const localeData = resolveLocaleDict(repoRoot, args.locale);
  const translator = makeTranslator(localeData.localeDict, localeData.enDict);
  const helpers = { t: translator };

  const sandbox = {
    window: {
      TM: {
        translations: localeData.localeDict
      }
    },
    console: console,
    isNaN: isNaN,
    isFinite: isFinite,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout
  };
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);

  loadScriptIntoContext(context, path.join(repoRoot, "web", "src", "scripts", "map-desc-ways.js"));
  loadScriptIntoContext(context, path.join(repoRoot, "web", "src", "scripts", "map-desc-areas.js"));
  loadScriptIntoContext(context, path.join(repoRoot, "web", "src", "scripts", "map-description.js"));

  const tmApi = sandbox.window && sandbox.window.TM ? sandbox.window.TM : {};
  if (!tmApi.mapDescWays || typeof tmApi.mapDescWays.buildModel !== "function") {
    throw new Error("window.TM.mapDescWays.buildModel is not available");
  }
  if (!tmApi.mapDescAreas || typeof tmApi.mapDescAreas.buildModel !== "function") {
    throw new Error("window.TM.mapDescAreas.buildModel is not available");
  }
  if (!tmApi.mapDescription || typeof tmApi.mapDescription.buildModel !== "function") {
    throw new Error("window.TM.mapDescription.buildModel is not available");
  }

  const waysModel = tmApi.mapDescWays.buildModel(mapContent, helpers);
  const areasModel = tmApi.mapDescAreas.buildModel(mapContent, helpers);
  const mapDescriptionModel = tmApi.mapDescription.buildModel(mapContent, helpers, {
    maxVisibleBuildings: 10
  });

  const artifact = {
    source: {
      inputOsmPath: osmPath,
      locale: args.locale,
      generation: generation
    },
    mapContentPath: mapContentPath,
    waysModel: waysModel,
    areasModel: areasModel,
    mapDescriptionModel: mapDescriptionModel
  };

  const outPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");
  process.stdout.write(JSON.stringify({ outPath: outPath, mapContentPath: mapContentPath }, null, 2) + "\n");
}

try {
  main();
} catch (error) {
  process.stderr.write((error && error.message ? error.message : String(error)) + "\n");
  process.exit(1);
}
