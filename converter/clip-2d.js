#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");

const DEFAULT_Q = 1e6;
const GROUP_ORDER = [
  "roads_car",
  "roads_ped",
  "road_areas_car",
  "road_areas_ped",
  "rails",
  "buildings",
  "waterways",
  "water_areas",
  "other",
];

function parseArgs(argv) {
  const args = {
    inputObj: "",
    outDir: "",
    basename: "map-clip",
    report: "",
    minX: Number.NaN,
    minY: Number.NaN,
    maxX: Number.NaN,
    maxY: Number.NaN,
    quantization: DEFAULT_Q,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--input-obj") {
      args.inputObj = next || "";
      i += 1;
      continue;
    }
    if (arg === "--out-dir") {
      args.outDir = next || "";
      i += 1;
      continue;
    }
    if (arg === "--basename") {
      args.basename = next || "";
      i += 1;
      continue;
    }
    if (arg === "--report") {
      args.report = next || "";
      i += 1;
      continue;
    }
    if (arg === "--min-x") {
      args.minX = Number(next);
      i += 1;
      continue;
    }
    if (arg === "--min-y") {
      args.minY = Number(next);
      i += 1;
      continue;
    }
    if (arg === "--max-x") {
      args.maxX = Number(next);
      i += 1;
      continue;
    }
    if (arg === "--max-y") {
      args.maxY = Number(next);
      i += 1;
      continue;
    }
    if (arg === "--quantization") {
      args.quantization = Number(next);
      i += 1;
      continue;
    }
    throw new Error("Unknown argument: " + arg);
  }

  if (!args.inputObj) {
    throw new Error("--input-obj is required");
  }
  if (!args.outDir) {
    throw new Error("--out-dir is required");
  }
  if (!args.report) {
    throw new Error("--report is required");
  }
  ["minX", "minY", "maxX", "maxY", "quantization"].forEach(function(key) {
    if (!Number.isFinite(args[key])) {
      throw new Error("Argument " + key + " must be numeric");
    }
  });
  if (!(args.minX < args.maxX) || !(args.minY < args.maxY)) {
    throw new Error("Invalid clipping bounds");
  }
  if (!(args.quantization > 0)) {
    throw new Error("--quantization must be > 0");
  }

  return args;
}

function isPedestrianName(name) {
  return name.endsWith("::pedestrian");
}

function classifyObject(name) {
  if (name.startsWith("BuildingEntrance")) {
    return "skip";
  }
  if (name.startsWith("Building")) {
    return "buildings";
  }
  if (name.startsWith("RoadArea")) {
    return isPedestrianName(name) ? "road_areas_ped" : "road_areas_car";
  }
  if (name.startsWith("Road")) {
    return isPedestrianName(name) ? "roads_ped" : "roads_car";
  }
  if (name.startsWith("Rail")) {
    return "rails";
  }
  if (name.startsWith("Waterway") || name.startsWith("River")) {
    return "waterways";
  }
  if (name.startsWith("Water") || name.startsWith("AreaFountain")) {
    return "water_areas";
  }
  return "other";
}

function signedArea2(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function parseObj(inputObjPath) {
  const raw = fs.readFileSync(inputObjPath, "utf8");
  const lines = raw.split(/\r?\n/);
  const vertices = [];
  const triangles = [];
  let currentObjectName = "null";
  let currentObjectOrdinal = 0;

  for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
    const line = lines[lineNo].trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    if (line.startsWith("o ")) {
      currentObjectName = line.slice(2).trim() || "unnamed";
      currentObjectOrdinal += 1;
      continue;
    }
    if (line.startsWith("v ")) {
      const parts = line.split(/\s+/);
      if (parts.length < 4) {
        continue;
      }
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      const z = Number(parts[3]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        continue;
      }
      // Match Blender OBJ import axis mapping (-Z forward, Y up): map plane is (x, -z).
      vertices.push({
        x: x,
        y: -z,
      });
      continue;
    }
    if (line.startsWith("f ")) {
      const parts = line.slice(2).trim().split(/\s+/).filter(Boolean);
      if (parts.length < 3) {
        continue;
      }
      const faceVertexIndices = [];
      for (let i = 0; i < parts.length; i += 1) {
        const token = parts[i];
        const firstField = token.split("/")[0];
        if (!firstField) {
          continue;
        }
        const rawIndex = Number(firstField);
        if (!Number.isInteger(rawIndex) || rawIndex === 0) {
          continue;
        }
        let idx = -1;
        if (rawIndex > 0) {
          idx = rawIndex - 1;
        } else {
          idx = vertices.length + rawIndex;
        }
        if (idx < 0 || idx >= vertices.length) {
          continue;
        }
        faceVertexIndices.push(idx);
      }
      if (faceVertexIndices.length < 3) {
        continue;
      }
      for (let i = 1; i < faceVertexIndices.length - 1; i += 1) {
        triangles.push({
          objectName: currentObjectName,
          objectOrdinal: currentObjectOrdinal,
          indices: [faceVertexIndices[0], faceVertexIndices[i], faceVertexIndices[i + 1]],
        });
      }
    }
  }

  return {
    vertices,
    triangles,
  };
}

function makeInsideFn(plane, bounds, eps) {
  if (plane === "x>=") {
    return function(v) { return v.x >= bounds.minX - eps; };
  }
  if (plane === "x<=") {
    return function(v) { return v.x <= bounds.maxX + eps; };
  }
  if (plane === "y>=") {
    return function(v) { return v.y >= bounds.minY - eps; };
  }
  if (plane === "y<=") {
    return function(v) { return v.y <= bounds.maxY + eps; };
  }
  throw new Error("Unknown plane " + plane);
}

function intersectionWithPlane(a, b, plane, bounds, eps) {
  if (plane === "x>=" || plane === "x<=") {
    const k = plane === "x>=" ? bounds.minX : bounds.maxX;
    const den = b.x - a.x;
    if (Math.abs(den) < eps) {
      return null;
    }
    let t = (k - a.x) / den;
    if (t < 0) {
      t = 0;
    } else if (t > 1) {
      t = 1;
    }
    let y = a.y + t * (b.y - a.y);
    if (Math.abs(y - bounds.minY) <= eps) {
      y = bounds.minY;
    } else if (Math.abs(y - bounds.maxY) <= eps) {
      y = bounds.maxY;
    }
    return { x: k, y: y };
  }

  if (plane === "y>=" || plane === "y<=") {
    const k = plane === "y>=" ? bounds.minY : bounds.maxY;
    const den = b.y - a.y;
    if (Math.abs(den) < eps) {
      return null;
    }
    let t = (k - a.y) / den;
    if (t < 0) {
      t = 0;
    } else if (t > 1) {
      t = 1;
    }
    let x = a.x + t * (b.x - a.x);
    if (Math.abs(x - bounds.minX) <= eps) {
      x = bounds.minX;
    } else if (Math.abs(x - bounds.maxX) <= eps) {
      x = bounds.maxX;
    }
    return { x: x, y: k };
  }

  throw new Error("Unknown plane " + plane);
}

function clipPolygonAgainstPlane(poly, plane, bounds, eps) {
  if (poly.length === 0) {
    return poly;
  }
  const inside = makeInsideFn(plane, bounds, eps);
  const out = [];
  let prev = poly[poly.length - 1];
  let prevInside = inside(prev);

  for (let i = 0; i < poly.length; i += 1) {
    const curr = poly[i];
    const currInside = inside(curr);

    if (currInside) {
      if (!prevInside) {
        const p = intersectionWithPlane(prev, curr, plane, bounds, eps);
        if (p) {
          out.push(p);
        }
      }
      out.push(curr);
    } else if (prevInside) {
      const p = intersectionWithPlane(prev, curr, plane, bounds, eps);
      if (p) {
        out.push(p);
      }
    }

    prev = curr;
    prevInside = currInside;
  }

  return out;
}

function clipTriangleToBounds(tri, bounds, eps) {
  let poly = tri;
  poly = clipPolygonAgainstPlane(poly, "x>=", bounds, eps);
  poly = clipPolygonAgainstPlane(poly, "x<=", bounds, eps);
  poly = clipPolygonAgainstPlane(poly, "y>=", bounds, eps);
  poly = clipPolygonAgainstPlane(poly, "y<=", bounds, eps);
  return poly;
}

function ensureBucket(buckets, key, group, sourceName, sourceOrdinal) {
  if (!buckets[key]) {
    buckets[key] = {
      key,
      group,
      sourceName,
      sourceOrdinal,
      triangles: [],
      inputTriangles: 0,
      clippedTriangles: 0,
      droppedTriangles: 0,
      droppedDegenerate: 0,
      droppedCollapsed: 0,
      verticesBeforeDedupe: 0,
      verticesAfterDedupe: 0,
      writtenFaces: 0,
      path: "",
    };
  }
  return buckets[key];
}

function writeBinaryPly(filePath, vertsX, vertsY, faces) {
  const header = [
    "ply",
    "format binary_little_endian 1.0",
    "element vertex " + vertsX.length,
    "property float x",
    "property float y",
    "property float z",
    "element face " + faces.length,
    "property list uchar int vertex_indices",
    "end_header\n",
  ].join("\n");

  const headerBuf = Buffer.from(header, "ascii");
  const vertexBytes = vertsX.length * 12;
  const faceBytes = faces.length * 13;
  const out = Buffer.allocUnsafe(headerBuf.length + vertexBytes + faceBytes);

  let offset = 0;
  headerBuf.copy(out, offset);
  offset += headerBuf.length;

  for (let i = 0; i < vertsX.length; i += 1) {
    out.writeFloatLE(vertsX[i], offset);
    offset += 4;
    out.writeFloatLE(vertsY[i], offset);
    offset += 4;
    out.writeFloatLE(0.0, offset);
    offset += 4;
  }

  for (let i = 0; i < faces.length; i += 1) {
    const f = faces[i];
    out.writeUInt8(3, offset);
    offset += 1;
    out.writeInt32LE(f[0], offset);
    offset += 4;
    out.writeInt32LE(f[1], offset);
    offset += 4;
    out.writeInt32LE(f[2], offset);
    offset += 4;
  }

  fs.writeFileSync(filePath, out);
}

function dedupeAndWriteBucket(bucket, outPath, quantization) {
  const keyToIndex = new Map();
  const vertsX = [];
  const vertsY = [];
  const faces = [];

  function getIndex(x, y) {
    const qx = Math.round(x * quantization);
    const qy = Math.round(y * quantization);
    const key = qx + "," + qy;
    const existing = keyToIndex.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const idx = vertsX.length;
    keyToIndex.set(key, idx);
    vertsX.push(x);
    vertsY.push(y);
    return idx;
  }

  for (let i = 0; i < bucket.triangles.length; i += 1) {
    const tri = bucket.triangles[i];
    const a = getIndex(tri[0].x, tri[0].y);
    const b = getIndex(tri[1].x, tri[1].y);
    const c = getIndex(tri[2].x, tri[2].y);
    if (a === b || b === c || a === c) {
      bucket.droppedCollapsed += 1;
      continue;
    }
    faces.push([a, b, c]);
  }

  bucket.verticesBeforeDedupe = bucket.triangles.length * 3;
  bucket.verticesAfterDedupe = vertsX.length;
  bucket.writtenFaces = faces.length;

  writeBinaryPly(outPath, vertsX, vertsY, faces);
}

function prepareTmpDir(outDir) {
  const tmpDir = path.join(outDir, "tmp");
  // clip-2d outputs are ephemeral intermediates; clear before each run.
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
}

function main() {
  const started = performance.now();
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.outDir, { recursive: true });
  const tmpOutDir = prepareTmpDir(args.outDir);

  const bounds = {
    minX: args.minX,
    minY: args.minY,
    maxX: args.maxX,
    maxY: args.maxY,
  };
  const extent = Math.max(1, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const eps = 1e-9 * extent;
  const areaEps = 1e-12 * extent * extent;

  const parseStart = performance.now();
  const parsed = parseObj(args.inputObj);
  const parseSeconds = (performance.now() - parseStart) / 1000;

  const clipStart = performance.now();
  const buckets = {};
  const objectStats = {
    seen: 0,
    skipped: 0,
  };
  const seenObjectKeys = new Set();
  const skippedObjectKeys = new Set();

  let inputTriangles = 0;
  let clippedTriangles = 0;
  let droppedTriangles = 0;
  let droppedDegenerate = 0;

  for (let i = 0; i < parsed.triangles.length; i += 1) {
    const triRecord = parsed.triangles[i];
    inputTriangles += 1;

    const sourceName = triRecord.objectName || "null";
    const sourceOrdinal = triRecord.objectOrdinal;
    const sourceKey = sourceOrdinal + "::" + sourceName;
    if (!seenObjectKeys.has(sourceKey)) {
      seenObjectKeys.add(sourceKey);
      objectStats.seen += 1;
    }

    const group = classifyObject(sourceName);
    if (group === "skip") {
      droppedTriangles += 1;
      if (!skippedObjectKeys.has(sourceKey)) {
        skippedObjectKeys.add(sourceKey);
        objectStats.skipped += 1;
      }
      continue;
    }

    const v0 = parsed.vertices[triRecord.indices[0]];
    const v1 = parsed.vertices[triRecord.indices[1]];
    const v2 = parsed.vertices[triRecord.indices[2]];

    const origArea2 = signedArea2(v0.x, v0.y, v1.x, v1.y, v2.x, v2.y);
    if (Math.abs(origArea2) <= areaEps) {
      droppedTriangles += 1;
      droppedDegenerate += 1;
      continue;
    }

    const clipped = clipTriangleToBounds([v0, v1, v2], bounds, eps);
    if (clipped.length < 3) {
      droppedTriangles += 1;
      continue;
    }

    let bucketKey = group;
    if (group === "water_areas") {
      bucketKey = group + "#" + String(sourceOrdinal).padStart(4, "0");
    }
    const bucket = ensureBucket(buckets, bucketKey, group, sourceName, sourceOrdinal);
    bucket.inputTriangles += 1;

    for (let j = 1; j < clipped.length - 1; j += 1) {
      const a = clipped[0];
      const b = clipped[j];
      const c = clipped[j + 1];
      let area2 = signedArea2(a.x, a.y, b.x, b.y, c.x, c.y);
      if (Math.abs(area2) <= areaEps) {
        droppedTriangles += 1;
        droppedDegenerate += 1;
        bucket.droppedDegenerate += 1;
        continue;
      }
      if (area2 * origArea2 < 0) {
        bucket.triangles.push([a, c, b]);
        area2 = -area2;
      } else {
        bucket.triangles.push([a, b, c]);
      }
      clippedTriangles += 1;
      bucket.clippedTriangles += 1;
    }
  }
  const clipSeconds = (performance.now() - clipStart) / 1000;

  const dedupeWriteStart = performance.now();
  const files = [];

  const sortedBucketKeys = Object.keys(buckets).sort(function(a, b) {
    const ga = buckets[a].group;
    const gb = buckets[b].group;
    const ia = GROUP_ORDER.indexOf(ga);
    const ib = GROUP_ORDER.indexOf(gb);
    if (ia !== ib) {
      return ia - ib;
    }
    if (ga === "water_areas") {
      return buckets[a].sourceOrdinal - buckets[b].sourceOrdinal;
    }
    return a.localeCompare(b);
  });

  const waterAreaFiles = [];
  for (let i = 0; i < sortedBucketKeys.length; i += 1) {
    const key = sortedBucketKeys[i];
    const bucket = buckets[key];
    if (bucket.triangles.length === 0) {
      continue;
    }

    let filename = "";
    if (bucket.group === "water_areas") {
      filename = args.basename + "-water-areas-" + String(waterAreaFiles.length + 1).padStart(4, "0") + ".ply";
    } else {
      filename = args.basename + "-" + bucket.group.replace(/_/g, "-") + ".ply";
    }
    const outPath = path.join(tmpOutDir, filename);
    dedupeAndWriteBucket(bucket, outPath, args.quantization);
    bucket.path = outPath;
    files.push({
      group: bucket.group,
      path: outPath,
      inputTriangles: bucket.inputTriangles,
      clippedTriangles: bucket.clippedTriangles,
      droppedDegenerate: bucket.droppedDegenerate,
      droppedCollapsed: bucket.droppedCollapsed,
      verticesBeforeDedupe: bucket.verticesBeforeDedupe,
      verticesAfterDedupe: bucket.verticesAfterDedupe,
      writtenFaces: bucket.writtenFaces,
    });
    if (bucket.group === "water_areas") {
      waterAreaFiles.push(outPath);
    }
  }

  const dedupeWriteSeconds = (performance.now() - dedupeWriteStart) / 1000;
  const totalSeconds = (performance.now() - started) / 1000;

  const report = {
    inputObjPath: path.resolve(args.inputObj),
    outDir: path.resolve(args.outDir),
    tmpOutDir: path.resolve(tmpOutDir),
    bounds,
    quantization: args.quantization,
    eps,
    areaEps,
    timings: {
      parseSeconds,
      clipSeconds,
      dedupeWriteSeconds,
      totalSeconds,
    },
    objects: objectStats,
    triangles: {
      input: inputTriangles,
      clippedOutput: clippedTriangles,
      dropped: droppedTriangles,
      droppedDegenerate,
    },
    files,
  };

  fs.writeFileSync(args.report, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ reportPath: path.resolve(args.report), files: files.map(function(f) { return f.path; }) }));
}

main();
