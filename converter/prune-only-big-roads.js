#!/usr/bin/env node
'use strict';

const fs = require('fs');

const FLAG_ROAD = 1;
const FLAG_WATER_AREA = 2;
const FLAG_LINEAR_WATERWAY = 4;

const MEMBER_TYPE_NODE = 0;
const MEMBER_TYPE_WAY = 1;
const MEMBER_TYPE_RELATION = 2;
const ROAD_NAME_HASH_UNNAMED = -1;
const ROAD_SCORE_MIN = -100;
const ROAD_SCORE_MAX = 17;
const ROAD_SCORE_BUCKET_COUNT = ROAD_SCORE_MAX - ROAD_SCORE_MIN + 1;

const ROAD_BASE_RANK = {
  corridor: 0,
  steps: 1,
  path: 2,
  footway: 3,
  cycleway: 3,
  bridleway: 3,
  track: 4,
  service: 5,
  living_street: 6,
  residential: 7,
  unclassified: 8,
  tertiary: 9,
  tertiary_link: 9,
  secondary: 10,
  secondary_link: 10,
  primary: 11,
  primary_link: 11,
  trunk: 12,
  trunk_link: 12,
  motorway: 13,
  motorway_link: 13,
};

const PAVED_SURFACES = {
  asphalt: true,
  paved: true,
  concrete: true,
};

const PEDESTRIAN_NAV_HIGHWAYS = {
  path: 2,
  footway: 3,
  cycleway: 3,
};

function usage() {
  return [
    'Usage:',
    '  prune-only-big-roads.js --osm <path> --lon-min <n> --lat-min <n> --lon-max <n> --lat-max <n> [--target-density-km-per-km2 <n>] [--output <path>]',
  ].join('\n');
}

function parseArgs(argv) {
  const out = {
    osm: null,
    output: null,
    lonMin: null,
    latMin: null,
    lonMax: null,
    latMax: null,
    targetDensityKmPerKm2: 10.0,
  };

  function takeValue(i) {
    if (i + 1 >= argv.length) {
      throw new Error('Missing value for ' + argv[i]);
    }
    return argv[i + 1];
  }

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--osm') {
      out.osm = takeValue(i);
      i += 1;
    } else if (arg === '--output') {
      out.output = takeValue(i);
      i += 1;
    } else if (arg === '--lon-min') {
      out.lonMin = Number(takeValue(i));
      i += 1;
    } else if (arg === '--lat-min') {
      out.latMin = Number(takeValue(i));
      i += 1;
    } else if (arg === '--lon-max') {
      out.lonMax = Number(takeValue(i));
      i += 1;
    } else if (arg === '--lat-max') {
      out.latMax = Number(takeValue(i));
      i += 1;
    } else if (arg === '--target-density-km-per-km2') {
      out.targetDensityKmPerKm2 = Number(takeValue(i));
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      throw new Error(usage());
    } else {
      throw new Error('Unknown argument: ' + arg + '\n' + usage());
    }
  }

  if (!out.osm) {
    throw new Error('--osm is required\n' + usage());
  }
  if (!Number.isFinite(out.lonMin) || !Number.isFinite(out.latMin) || !Number.isFinite(out.lonMax) || !Number.isFinite(out.latMax)) {
    throw new Error('All bounds args are required and must be numeric\n' + usage());
  }
  if (!Number.isFinite(out.targetDensityKmPerKm2) || out.targetDensityKmPerKm2 < 0) {
    throw new Error('--target-density-km-per-km2 must be a non-negative number');
  }
  if (!out.output) {
    out.output = out.osm;
  }
  return out;
}

function decodeXmlEntities(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function escapeXmlAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;');
}

function parseTagToken(raw) {
  let text = String(raw || '').trim();
  if (!text) {
    return null;
  }
  if (text.startsWith('?')) {
    return null;
  }
  if (text.startsWith('!--')) {
    return null;
  }
  if (text.startsWith('!')) {
    return null;
  }

  let closing = false;
  if (text[0] === '/') {
    closing = true;
    text = text.slice(1).trim();
  }

  let selfClosing = false;
  if (!closing && text.endsWith('/')) {
    selfClosing = true;
    text = text.slice(0, -1).trim();
  }

  if (!text) {
    return null;
  }

  const spaceIdx = text.search(/\s/);
  const name = spaceIdx === -1 ? text : text.slice(0, spaceIdx);
  const attrsText = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1);
  const attrs = {};

  if (!closing && attrsText) {
    const attrRe = /([^\s=\/]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = attrRe.exec(attrsText)) !== null) {
      const key = m[1];
      const value = decodeXmlEntities(m[3] !== undefined ? m[3] : m[4]);
      attrs[key] = value;
    }
  }

  return {
    name,
    attrs,
    closing,
    selfClosing,
  };
}

function findXmlTokenEnd(buffer, startIndex) {
  if (startIndex < 0 || startIndex >= buffer.length || buffer[startIndex] !== '<') {
    return {
      complete: false,
      kind: 'tag',
      endIndex: -1,
    };
  }

  if (buffer.startsWith('<!--', startIndex)) {
    const endIdx = buffer.indexOf('-->', startIndex + 4);
    if (endIdx === -1) {
      return { complete: false, kind: 'comment', endIndex: -1 };
    }
    return { complete: true, kind: 'comment', endIndex: endIdx + 2 };
  }

  if (buffer.startsWith('<![CDATA[', startIndex)) {
    const endIdx = buffer.indexOf(']]>', startIndex + 9);
    if (endIdx === -1) {
      return { complete: false, kind: 'cdata', endIndex: -1 };
    }
    return { complete: true, kind: 'cdata', endIndex: endIdx + 2 };
  }

  if (buffer.startsWith('<?', startIndex)) {
    const endIdx = buffer.indexOf('?>', startIndex + 2);
    if (endIdx === -1) {
      return { complete: false, kind: 'processing-instruction', endIndex: -1 };
    }
    return { complete: true, kind: 'processing-instruction', endIndex: endIdx + 1 };
  }

  if (buffer.startsWith('<!', startIndex)) {
    let quote = null;
    let bracketDepth = 0;
    for (let i = startIndex + 2; i < buffer.length; i += 1) {
      const ch = buffer[i];
      if (quote !== null) {
        if (ch === quote) {
          quote = null;
        }
        continue;
      }

      if (ch === '\"' || ch === '\'') {
        quote = ch;
        continue;
      }
      if (ch === '[') {
        bracketDepth += 1;
        continue;
      }
      if (ch === ']') {
        if (bracketDepth > 0) {
          bracketDepth -= 1;
        }
        continue;
      }
      if (ch === '>' && bracketDepth === 0) {
        return { complete: true, kind: 'declaration', endIndex: i };
      }
    }
    return { complete: false, kind: 'declaration', endIndex: -1 };
  }

  let quote = null;
  for (let i = startIndex + 1; i < buffer.length; i += 1) {
    const ch = buffer[i];
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '\"' || ch === '\'') {
      quote = ch;
      continue;
    }
    if (ch === '>') {
      return { complete: true, kind: 'tag', endIndex: i };
    }
  }
  return { complete: false, kind: 'tag', endIndex: -1 };
}

function malformedXmlError(kind) {
  if (kind === 'comment') {
    return new Error('Malformed XML: unterminated comment');
  }
  if (kind === 'cdata') {
    return new Error('Malformed XML: unterminated CDATA');
  }
  if (kind === 'processing-instruction') {
    return new Error('Malformed XML: unterminated processing instruction');
  }
  if (kind === 'declaration') {
    return new Error('Malformed XML: unterminated declaration/doctype');
  }
  return new Error('Malformed XML: unterminated tag');
}

function streamParseXml(xmlSource, onToken) {
  return new Promise((resolve, reject) => {
    let buffer = '';

    function consume(finalChunk) {
      while (true) {
        const lt = buffer.indexOf('<');
        if (lt === -1) {
          buffer = finalChunk ? '' : buffer;
          return;
        }
        if (lt > 0) {
          buffer = buffer.slice(lt);
        }

        const tokenEnd = findXmlTokenEnd(buffer, 0);
        if (!tokenEnd.complete) {
          if (finalChunk) {
            throw malformedXmlError(tokenEnd.kind);
          }
          return;
        }
        const endIndex = tokenEnd.endIndex;

        if (tokenEnd.kind !== 'tag') {
          buffer = buffer.slice(endIndex + 1);
          continue;
        }

        const tokenRaw = buffer.slice(1, endIndex);
        buffer = buffer.slice(endIndex + 1);

        const token = parseTagToken(tokenRaw);
        if (token !== null) {
          onToken(token);
        }
      }
    }

    function onChunk(chunk) {
      buffer += String(chunk);
      try {
        consume(false);
      } catch (err) {
        throw err;
      }
    }

    function onEnd() {
      consume(true);
      resolve();
    }

    if (Array.isArray(xmlSource)) {
      try {
        for (let i = 0; i < xmlSource.length; i += 1) {
          onChunk(xmlSource[i]);
        }
        onEnd();
      } catch (err) {
        reject(err);
      }
      return;
    }

    const stream = fs.createReadStream(xmlSource, { encoding: 'utf8' });
    stream.on('data', (chunk) => {
      try {
        onChunk(chunk);
      } catch (err) {
        stream.destroy(err);
      }
    });

    stream.on('end', () => {
      try {
        onEnd();
      } catch (err) {
        reject(err);
      }
    });

    stream.on('error', reject);
  });
}

function tokenToSignature(token) {
  const attrs = token.attrs || {};
  const keys = Object.keys(attrs).sort();
  const attrText = keys.map((key) => key + '=' + String(attrs[key])).join(',');
  return (
    (token.closing ? '/' : '') +
    token.name +
    (token.selfClosing ? '/' : '') +
    (attrText ? '{' + attrText + '}' : '')
  );
}

function assertEqualArray(label, got, expected) {
  if (got.length !== expected.length) {
    throw new Error(
      'streamParseXml self-test ' + label + ': token count mismatch got=' + got.length + ' expected=' + expected.length +
      ' got=' + JSON.stringify(got) + ' expected=' + JSON.stringify(expected)
    );
  }
  for (let i = 0; i < got.length; i += 1) {
    if (got[i] !== expected[i]) {
      throw new Error(
        'streamParseXml self-test ' + label + ': mismatch at index ' + i +
        ' got=' + got[i] + ' expected=' + expected[i]
      );
    }
  }
}

async function runStreamParseXmlSelfTest() {
  const cases = [
    {
      label: 'normal-osm-tags',
      chunks: [
        '<osm version=\"0.6\">',
        '<node id=\"1\" lat=\"60.1\" lon=\"24.9\"/>',
        '<way id=\"2\"><nd ref=\"1\"/><tag k=\"highway\" v=\"residential\"/></way>',
        '</osm>',
      ],
      expected: [
        'osm{version=0.6}',
        'node/{id=1,lat=60.1,lon=24.9}',
        'way{id=2}',
        'nd/{ref=1}',
        'tag/{k=highway,v=residential}',
        '/way',
        '/osm',
      ],
    },
    {
      label: 'comment-with-angle-brackets',
      chunks: [
        '<osm>',
        '<!-- a comment with > and < and <<>> -->',
        '<node id=\"1\"/>',
        '</osm>',
      ],
      expected: [
        'osm',
        'node/{id=1}',
        '/osm',
      ],
    },
    {
      label: 'quoted-attribute-with-split-chunks',
      chunks: [
        '<osm><node id=\"1\" note=\"left ',
        '&gt; right\" name=\"a',
        '>b\" /></osm>',
      ],
      expected: [
        'osm',
        'node/{id=1,name=a>b,note=left > right}',
        '/osm',
      ],
    },
    {
      label: 'cdata-with-tag-text',
      chunks: [
        '<osm>',
        '<![CDATA[<tag k=\"x\" v=\"y\">not-a-tag</tag>]]>',
        '<way id=\"9\"/>',
        '</osm>',
      ],
      expected: [
        'osm',
        'way/{id=9}',
        '/osm',
      ],
    },
  ];

  for (let i = 0; i < cases.length; i += 1) {
    const testCase = cases[i];
    const got = [];
    await streamParseXml(testCase.chunks, (token) => {
      got.push(tokenToSignature(token));
    });
    assertEqualArray(testCase.label, got, testCase.expected);
  }

  console.log('streamParseXml self-test passed: ' + cases.length + ' cases');
}

function parseOsmId(raw) {
  if (raw === null || raw === undefined || raw === '') {
    return null;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return null;
  }
  return n;
}

function createState() {
  return {
    rootAttrs: null,
    nodeIdToIx: new Map(),
    nodeIdByIx: [],
    nodeLat: null,
    nodeLon: null,
    nodeHasCoord: null,
    nodeTags: null,

    wayIdToIx: new Map(),
    wayIds: [],
    wayFlags: [],
    wayRank: [],
    wayRoadNameHash: [],
    wayRefStart: [],
    wayRefLen: [],
    wayTags: [],
    wayNodeRefIxFlat: [],

    relationIdToIx: new Map(),
    relationIds: [],
    relationIsWaterTag: [],
    relationTags: [],
    relationMembers: [],

    keepWay: null,
    keptRoadWay: null,
    keepNode: null,
    keepRelation: null,
  };
}

function finalizeWayIntoState(state, wayData) {
  const wayTagsMap = wayTagPairsToMap(wayData.tags);
  let flags = 0;
  let rank = 0;
  const highway = wayTagsMap.highway;
  const linearWaterway = hasLinearWaterwayTags(wayTagsMap);

  if (linearWaterway) {
    flags |= FLAG_LINEAR_WATERWAY;
  }
  if (highway !== null && highway !== undefined && highway !== '' && !linearWaterway) {
    flags |= FLAG_ROAD;
    rank = adjustedRoadRank(wayTagsMap);
  }
  if (hasWaterAreaTags(wayTagsMap)) {
    flags |= FLAG_WATER_AREA;
  }

  const wayIx = state.wayIds.length;
  state.wayIdToIx.set(wayData.id, wayIx);
  state.wayIds.push(wayData.id);
  state.wayFlags.push(flags);
  state.wayRank.push(rank);
  state.wayRoadNameHash.push(roadNameHashFromWayTags(wayTagsMap, (flags & FLAG_ROAD) !== 0));
  state.wayRefStart.push(wayData.refStart);
  state.wayRefLen.push(wayData.refLen);
  state.wayTags.push(wayData.tags);
}

function ensureNodeIx(state, nodeId) {
  let ix = state.nodeIdToIx.get(nodeId);
  if (ix !== undefined) {
    return ix;
  }
  ix = state.nodeIdByIx.length;
  state.nodeIdToIx.set(nodeId, ix);
  state.nodeIdByIx.push(nodeId);
  return ix;
}

function hasWaterAreaTags(tags) {
  return (
    tags.natural === 'water' ||
    (Object.prototype.hasOwnProperty.call(tags, 'water') && tags.water !== null && tags.water !== '') ||
    tags.landuse === 'reservoir' ||
    tags.waterway === 'riverbank'
  );
}

function hasLinearWaterwayTags(tags) {
  const raw = tags.waterway;
  if (raw === null || raw === undefined) {
    return false;
  }
  const normalized = String(raw).trim().toLowerCase();
  return normalized !== '' && normalized !== 'riverbank';
}

function parseLanes(tags) {
  const raw = tags.lanes;
  if (raw === null || raw === undefined) {
    return null;
  }
  const m = String(raw).match(/^\s*([0-9]+)/);
  if (!m) {
    return null;
  }
  const n = Number(m[1]);
  if (!Number.isFinite(n)) {
    return null;
  }
  return n;
}

function parseMaxspeedKmh(tags) {
  const raw = tags.maxspeed;
  if (raw === null || raw === undefined) {
    return null;
  }
  const text = String(raw).trim().toLowerCase();
  if (!text) {
    return null;
  }
  const primary = text.split(/[;,|]/)[0].trim();
  const m = primary.match(/^([0-9]+(?:\.[0-9]+)?)\s*(mph|mi\/h|km\/h|kmh|kph)?$/);
  if (!m) {
    return null;
  }
  let n = Number(m[1]);
  if (!Number.isFinite(n)) {
    return null;
  }
  const unit = m[2];
  if (unit === 'mph' || unit === 'mi/h') {
    n *= 1.60934;
  }
  return n;
}

function isTruthyOsm(tags, key) {
  const raw = tags[key];
  if (raw === null || raw === undefined) {
    return false;
  }
  const normalized = String(raw).trim().toLowerCase();
  return normalized === 'yes' || normalized === 'true' || normalized === '1';
}

function normalizedTagValue(tags, key) {
  const raw = tags[key];
  if (raw === null || raw === undefined) {
    return '';
  }
  return String(raw).trim().toLowerCase();
}

function hasNonEmptyName(tags) {
  const raw = tags.name;
  if (raw === null || raw === undefined) {
    return false;
  }
  return String(raw).trim() !== '';
}

function clampRoadScore(score) {
  const n = Math.round(Number(score));
  if (!Number.isFinite(n)) {
    return ROAD_SCORE_MIN;
  }
  if (n < ROAD_SCORE_MIN) {
    return ROAD_SCORE_MIN;
  }
  if (n > ROAD_SCORE_MAX) {
    return ROAD_SCORE_MAX;
  }
  return n;
}

function scoreToBucketIx(score) {
  return clampRoadScore(score) - ROAD_SCORE_MIN;
}

function bucketIxToScore(bucketIx) {
  return ROAD_SCORE_MIN + bucketIx;
}

function baseRoadRank(highwayValue) {
  if (highwayValue === null || highwayValue === undefined) {
    return ROAD_SCORE_MIN;
  }
  const normalized = String(highwayValue).trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(ROAD_BASE_RANK, normalized)) {
    return ROAD_SCORE_MIN;
  }
  return ROAD_BASE_RANK[normalized];
}

function adjustedRoadRank(tags) {
  const highway = normalizedTagValue(tags, 'highway');
  let rank = baseRoadRank(highway);

  if (Object.prototype.hasOwnProperty.call(PEDESTRIAN_NAV_HIGHWAYS, highway)) {
    if (hasNonEmptyName(tags)) {
      rank += 6;
    }
    if (normalizedTagValue(tags, 'foot') === 'designated' || normalizedTagValue(tags, 'bicycle') === 'designated') {
      rank += 4;
    }
    if (normalizedTagValue(tags, 'footway') === 'crossing' || normalizedTagValue(tags, 'crossing') !== '') {
      rank += 4;
    }
    if (normalizedTagValue(tags, 'public_transport') === 'platform' || normalizedTagValue(tags, 'railway') === 'platform') {
      rank = Math.max(rank, 10);
    }
  }

  if (highway === 'service') {
    const service = normalizedTagValue(tags, 'service');
    const isPrivate = normalizedTagValue(tags, 'access') === 'private' || normalizedTagValue(tags, 'motor_vehicle') === 'private';
    if (service === 'driveway') {
      rank -= 3;
    }
    if (service === 'parking_aisle') {
      rank -= 2;
    }
    if (isPrivate) {
      rank -= 3;
    }
    if (hasNonEmptyName(tags)) {
      rank += 3;
    }
    if (service === 'alley') {
      rank += 2;
    }
    if (!isPrivate && Object.prototype.hasOwnProperty.call(PAVED_SURFACES, normalizedTagValue(tags, 'surface'))) {
      rank += 1;
    }
  }

  if (highway === 'track') {
    const tracktype = normalizedTagValue(tags, 'tracktype');
    const surface = normalizedTagValue(tags, 'surface');
    if (tracktype === 'grade1' || Object.prototype.hasOwnProperty.call(PAVED_SURFACES, surface)) {
      rank += 2;
    }
    if (hasNonEmptyName(tags)) {
      rank += 3;
    }
  }

  return clampRoadScore(rank);
}

function normalizeRoadNameForGrouping(raw) {
  if (raw === null || raw === undefined) {
    return null;
  }
  const normalized = String(raw).trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) {
    return null;
  }
  return normalized;
}

function hashRoadName32(normalizedRoadName) {
  // 32-bit hash keeps memory small; rare collisions are acceptable.
  return hashUpdate(2166136261 >>> 0, normalizedRoadName) >>> 0;
}

function roadNameHashFromWayTags(wayTagsMap, isRoadWay) {
  if (!isRoadWay) {
    return ROAD_NAME_HASH_UNNAMED;
  }
  const normalizedRoadName = normalizeRoadNameForGrouping(wayTagsMap.name);
  if (normalizedRoadName === null) {
    return ROAD_NAME_HASH_UNNAMED;
  }
  return hashRoadName32(normalizedRoadName);
}

function computeHaversineM(lat1, lon1, lat2, lon2) {
  const earthRadiusM = 6371000.0;
  const phi1 = (lat1 * Math.PI) / 180.0;
  const phi2 = (lat2 * Math.PI) / 180.0;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180.0;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180.0;
  const a =
    Math.sin(deltaPhi / 2.0) * Math.sin(deltaPhi / 2.0) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2.0) * Math.sin(deltaLambda / 2.0);
  const c = 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0.0, 1.0 - a)));
  return earthRadiusM * c;
}

function computeEffectiveAreaM2(bounds) {
  const latMin = Number(bounds.latMin);
  const latMax = Number(bounds.latMax);
  const lonMin = Number(bounds.lonMin);
  const lonMax = Number(bounds.lonMax);
  if (!Number.isFinite(latMin) || !Number.isFinite(latMax) || !Number.isFinite(lonMin) || !Number.isFinite(lonMax)) {
    return 0.0;
  }

  const nsM = computeHaversineM(latMin, lonMin, latMax, lonMin);
  const latMid = (latMin + latMax) / 2.0;
  const ewM = computeHaversineM(latMid, lonMin, latMid, lonMax);
  const area = Math.abs(nsM * ewM);
  return Number.isFinite(area) ? area : 0.0;
}

function deriveRemovedRankBuckets(lengthByRank, areaM2, targetDensityKmPerKm2) {
  const removed = new Set();
  if (!(areaM2 > 0)) {
    return removed;
  }
  const targetM = targetDensityKmPerKm2 * 1000.0 * (areaM2 / 1000000.0);
  let remainingM = 0.0;
  for (let bucketIx = 0; bucketIx < lengthByRank.length; bucketIx += 1) {
    remainingM += Number(lengthByRank[bucketIx] || 0.0);
  }

  for (let bucketIx = 0; bucketIx < lengthByRank.length; bucketIx += 1) {
    if (remainingM <= targetM) {
      break;
    }
    const bucketM = Number(lengthByRank[bucketIx] || 0.0);
    if (remainingM - bucketM >= targetM) {
      removed.add(bucketIxToScore(bucketIx));
      remainingM -= bucketM;
    } else {
      break;
    }
  }
  return removed;
}

function wayTagPairsToMap(tagPairs) {
  const tags = Object.create(null);
  for (let i = 0; i < tagPairs.length; i += 1) {
    const pair = tagPairs[i];
    tags[pair[0]] = pair[1];
  }
  return tags;
}

function memberTypeFromString(typeValue) {
  if (typeValue === 'node') {
    return MEMBER_TYPE_NODE;
  }
  if (typeValue === 'way') {
    return MEMBER_TYPE_WAY;
  }
  if (typeValue === 'relation') {
    return MEMBER_TYPE_RELATION;
  }
  return null;
}

function memberTypeToString(typeCode) {
  if (typeCode === MEMBER_TYPE_NODE) {
    return 'node';
  }
  if (typeCode === MEMBER_TYPE_WAY) {
    return 'way';
  }
  if (typeCode === MEMBER_TYPE_RELATION) {
    return 'relation';
  }
  return '';
}

// Step 1: First pass over OSM XML.
// Build compact indexes for ways/relations and intern all referenced node IDs,
// while collecting tags and member/ref lists needed later for ranking and output.
async function firstPassCollectIndexes(state, osmPath) {
  let currentWay = null;
  let currentRelation = null;

  await streamParseXml(osmPath, (token) => {
    if (token.name === 'osm' && !token.closing && state.rootAttrs === null) {
      state.rootAttrs = token.attrs;
    }

    if (currentWay !== null) {
      if (!token.closing && token.name === 'nd') {
        const nodeId = parseOsmId(token.attrs.ref);
        if (nodeId !== null) {
          const nodeIx = ensureNodeIx(state, nodeId);
          state.wayNodeRefIxFlat.push(nodeIx);
          currentWay.refLen += 1;
        }
      } else if (!token.closing && token.name === 'tag') {
        const key = token.attrs.k;
        const value = token.attrs.v;
        if (key !== undefined && value !== undefined) {
          currentWay.tags.push([key, value]);
        }
      }

      if ((token.closing && token.name === 'way') || (token.selfClosing && token.name === 'way')) {
        finalizeWayIntoState(state, currentWay);
        currentWay = null;
      }
      return;
    }

    if (currentRelation !== null) {
      if (!token.closing && token.name === 'member') {
        const typeCode = memberTypeFromString(token.attrs.type);
        const refId = parseOsmId(token.attrs.ref);
        if (typeCode !== null && refId !== null) {
          if (typeCode === MEMBER_TYPE_NODE) {
            ensureNodeIx(state, refId);
          }
          currentRelation.members.push({
            type: typeCode,
            ref: refId,
            role: token.attrs.role || '',
          });
        }
      } else if (!token.closing && token.name === 'tag') {
        const key = token.attrs.k;
        const value = token.attrs.v;
        if (key !== undefined && value !== undefined) {
          currentRelation.tags.push([key, value]);
        }
      }

      if ((token.closing && token.name === 'relation') || (token.selfClosing && token.name === 'relation')) {
        const relationTagsMap = wayTagPairsToMap(currentRelation.tags);
        const relIx = state.relationIds.length;
        state.relationIdToIx.set(currentRelation.id, relIx);
        state.relationIds.push(currentRelation.id);
        state.relationIsWaterTag.push(hasWaterAreaTags(relationTagsMap));
        state.relationTags.push(currentRelation.tags);
        state.relationMembers.push(currentRelation.members);
        currentRelation = null;
      }
      return;
    }

    if (!token.closing && token.name === 'way') {
      const wayId = parseOsmId(token.attrs.id);
      if (wayId === null) {
        return;
      }
      currentWay = {
        id: wayId,
        tags: [],
        refStart: state.wayNodeRefIxFlat.length,
        refLen: 0,
      };
      if (token.selfClosing) {
        finalizeWayIntoState(state, currentWay);
        currentWay = null;
      }
      return;
    }

    if (!token.closing && token.name === 'relation') {
      const relationId = parseOsmId(token.attrs.id);
      if (relationId === null) {
        return;
      }
      currentRelation = {
        id: relationId,
        tags: [],
        members: [],
      };
      if (token.selfClosing) {
        const relationTagsMap = wayTagPairsToMap(currentRelation.tags);
        const relIx = state.relationIds.length;
        state.relationIdToIx.set(currentRelation.id, relIx);
        state.relationIds.push(currentRelation.id);
        state.relationIsWaterTag.push(hasWaterAreaTags(relationTagsMap));
        state.relationTags.push(currentRelation.tags);
        state.relationMembers.push(currentRelation.members);
        currentRelation = null;
      }
    }
  });
}

// Step 2: Second pass over OSM XML.
// Load coordinates (and optional node tags) only for interned node IDs from step 1.
async function secondPassLoadNodeCoordinates(state, osmPath) {
  const nodeCount = state.nodeIdByIx.length;
  state.nodeLat = new Float64Array(nodeCount);
  state.nodeLon = new Float64Array(nodeCount);
  state.nodeHasCoord = new Uint8Array(nodeCount);
  state.nodeTags = new Array(nodeCount);

  let currentNode = null;

  await streamParseXml(osmPath, (token) => {
    if (currentNode !== null) {
      if (!token.closing && token.name === 'tag' && currentNode.ix !== null) {
        const key = token.attrs.k;
        const value = token.attrs.v;
        if (key !== undefined && value !== undefined) {
          currentNode.tags.push([key, value]);
        }
      }
      if ((token.closing && token.name === 'node') || (token.selfClosing && token.name === 'node')) {
        if (currentNode.ix !== null && currentNode.tags.length > 0) {
          state.nodeTags[currentNode.ix] = currentNode.tags;
        }
        currentNode = null;
      }
      return;
    }

    if (!token.closing && token.name === 'node') {
      const nodeId = parseOsmId(token.attrs.id);
      let ix = null;
      if (nodeId !== null) {
        const gotIx = state.nodeIdToIx.get(nodeId);
        if (gotIx !== undefined) {
          ix = gotIx;
          const lat = Number(token.attrs.lat);
          const lon = Number(token.attrs.lon);
          if (Number.isFinite(lat) && Number.isFinite(lon)) {
            state.nodeLat[ix] = lat;
            state.nodeLon[ix] = lon;
            state.nodeHasCoord[ix] = 1;
          }
        }
      }

      if (!token.selfClosing) {
        currentNode = {
          ix,
          tags: [],
        };
      }
    }
  });
}

function clipSegmentToLonLatBounds(aLon, aLat, bLon, bLat, bounds) {
  const lonMin = Number(bounds.lonMin);
  const lonMax = Number(bounds.lonMax);
  const latMin = Number(bounds.latMin);
  const latMax = Number(bounds.latMax);
  if (
    !Number.isFinite(lonMin) || !Number.isFinite(lonMax) ||
    !Number.isFinite(latMin) || !Number.isFinite(latMax)
  ) {
    return null;
  }

  const dx = bLon - aLon;
  const dy = bLat - aLat;
  let t0 = 0.0;
  let t1 = 1.0;
  const eps = 1e-12;

  function clipEdge(p, q) {
    if (Math.abs(p) <= eps) {
      return q >= 0.0;
    }
    const r = q / p;
    if (p < 0.0) {
      if (r > t1) {
        return false;
      }
      if (r > t0) {
        t0 = r;
      }
    } else {
      if (r < t0) {
        return false;
      }
      if (r < t1) {
        t1 = r;
      }
    }
    return true;
  }

  if (!clipEdge(-dx, aLon - lonMin)) {
    return null;
  }
  if (!clipEdge(dx, lonMax - aLon)) {
    return null;
  }
  if (!clipEdge(-dy, aLat - latMin)) {
    return null;
  }
  if (!clipEdge(dy, latMax - aLat)) {
    return null;
  }
  if (t1 < t0) {
    return null;
  }

  return {
    lon0: aLon + t0 * dx,
    lat0: aLat + t0 * dy,
    lon1: aLon + t1 * dx,
    lat1: aLat + t1 * dy,
  };
}

function segmentLengthWithinBoundsMeters(aLon, aLat, bLon, bLat, bounds) {
  const clipped = clipSegmentToLonLatBounds(aLon, aLat, bLon, bLat, bounds);
  if (clipped === null) {
    return 0.0;
  }
  return computeHaversineM(clipped.lat0, clipped.lon0, clipped.lat1, clipped.lon1);
}

function computeWayLengthMetersWithinBounds(state, wayIx, bounds) {
  const start = state.wayRefStart[wayIx];
  const len = state.wayRefLen[wayIx];
  let total = 0.0;
  let prevIx = null;

  for (let i = start; i < start + len; i += 1) {
    const nodeIx = state.wayNodeRefIxFlat[i];
    if (state.nodeHasCoord[nodeIx] !== 1) {
      prevIx = null;
      continue;
    }
    if (prevIx !== null) {
      total += segmentLengthWithinBoundsMeters(
        state.nodeLon[prevIx],
        state.nodeLat[prevIx],
        state.nodeLon[nodeIx],
        state.nodeLat[nodeIx],
        bounds
      );
    }
    prevIx = nodeIx;
  }

  return total;
}

// Step 3: Build road-meter totals by rank and decide all-or-none bucket pruning.
// This uses rank-adjusted ways and map-area density target to compute removed buckets.
function thirdStepComputePruningDecision(state, bounds, targetDensityKmPerKm2) {
  const wayCount = state.wayIds.length;
  const lengthByRank = new Float64Array(ROAD_SCORE_BUCKET_COUNT);
  const roadGroupLength = [];
  const roadGroupMaxRank = [];
  const roadGroupIxByNameHash = new Map();
  const wayRoadGroupIx = new Int32Array(wayCount);
  const roadWayLengthWithinBounds = new Float64Array(wayCount);
  wayRoadGroupIx.fill(-1);

  for (let wayIx = 0; wayIx < wayCount; wayIx += 1) {
    if ((state.wayFlags[wayIx] & FLAG_ROAD) === 0) {
      continue;
    }
    const rank = state.wayRank[wayIx];
    const nameHash = state.wayRoadNameHash[wayIx];
    const wayLengthMeters = computeWayLengthMetersWithinBounds(state, wayIx, bounds);
    roadWayLengthWithinBounds[wayIx] = wayLengthMeters;

    let roadGroupIx;
    if (nameHash === ROAD_NAME_HASH_UNNAMED) {
      roadGroupIx = roadGroupLength.length;
      roadGroupLength.push(0.0);
      roadGroupMaxRank.push(rank);
    } else {
      roadGroupIx = roadGroupIxByNameHash.get(nameHash);
      if (roadGroupIx === undefined) {
        roadGroupIx = roadGroupLength.length;
        roadGroupIxByNameHash.set(nameHash, roadGroupIx);
        roadGroupLength.push(0.0);
        roadGroupMaxRank.push(rank);
      }
    }

    roadGroupLength[roadGroupIx] += wayLengthMeters;
    if (rank > roadGroupMaxRank[roadGroupIx]) {
      roadGroupMaxRank[roadGroupIx] = rank;
    }
    wayRoadGroupIx[wayIx] = roadGroupIx;
  }

  for (let roadGroupIx = 0; roadGroupIx < roadGroupLength.length; roadGroupIx += 1) {
    const groupRank = roadGroupMaxRank[roadGroupIx];
    lengthByRank[scoreToBucketIx(groupRank)] += roadGroupLength[roadGroupIx];
  }

  const removedRanks = deriveRemovedRankBuckets(
    lengthByRank,
    computeEffectiveAreaM2(bounds),
    targetDensityKmPerKm2
  );

  state.keepWay = new Uint8Array(wayCount);
  state.keptRoadWay = new Uint8Array(wayCount);

  for (let wayIx = 0; wayIx < wayCount; wayIx += 1) {
    if ((state.wayFlags[wayIx] & FLAG_ROAD) !== 0) {
      const roadGroupIx = wayRoadGroupIx[wayIx];
      const roadGroupRank = roadGroupIx >= 0 ? roadGroupMaxRank[roadGroupIx] : state.wayRank[wayIx];
      if (!removedRanks.has(roadGroupRank) && roadWayLengthWithinBounds[wayIx] > 0.0) {
        state.keepWay[wayIx] = 1;
        state.keptRoadWay[wayIx] = 1;
      }
    }
    if ((state.wayFlags[wayIx] & FLAG_WATER_AREA) !== 0) {
      state.keepWay[wayIx] = 1;
    }
  }
}

// Step 4: Apply relation-driven keep logic.
// Keep road relations that reference kept roads, keep water relations recursively,
// and include relation-member ways/nodes needed by those kept relations.
function fourthStepApplyRelationKeepLogic(state) {
  const keepRelation = new Set();
  const waterRelationClosure = new Set();
  const keepNodeFromRelations = new Uint8Array(state.nodeIdByIx.length);

  for (let relIx = 0; relIx < state.relationIds.length; relIx += 1) {
    const relId = state.relationIds[relIx];
    if (state.relationIsWaterTag[relIx]) {
      keepRelation.add(relId);
      waterRelationClosure.add(relId);
    }

    const members = state.relationMembers[relIx];
    for (let j = 0; j < members.length; j += 1) {
      const member = members[j];
      if (member.type !== MEMBER_TYPE_WAY) {
        continue;
      }
      const wayIx = state.wayIdToIx.get(member.ref);
      if (wayIx === undefined) {
        continue;
      }
      if (state.keptRoadWay[wayIx] === 1) {
        keepRelation.add(relId);
        break;
      }
    }
  }

  const queue = Array.from(waterRelationClosure);
  for (let qi = 0; qi < queue.length; qi += 1) {
    const relId = queue[qi];
    const relIx = state.relationIdToIx.get(relId);
    if (relIx === undefined) {
      continue;
    }
    const members = state.relationMembers[relIx];

    for (let j = 0; j < members.length; j += 1) {
      const member = members[j];
      if (member.type === MEMBER_TYPE_NODE) {
        const nodeIx = state.nodeIdToIx.get(member.ref);
        if (nodeIx !== undefined) {
          keepNodeFromRelations[nodeIx] = 1;
        }
      } else if (member.type === MEMBER_TYPE_WAY) {
        const wayIx = state.wayIdToIx.get(member.ref);
        if (wayIx !== undefined) {
          const isLinearWaterway = (state.wayFlags[wayIx] & FLAG_LINEAR_WATERWAY) !== 0;
          if (!isLinearWaterway) {
            state.keepWay[wayIx] = 1;
          }
        }
      } else if (member.type === MEMBER_TYPE_RELATION) {
        if (!waterRelationClosure.has(member.ref)) {
          waterRelationClosure.add(member.ref);
          keepRelation.add(member.ref);
          queue.push(member.ref);
        }
      }
    }
  }

  for (const relId of keepRelation) {
    const relIx = state.relationIdToIx.get(relId);
    if (relIx === undefined) {
      continue;
    }
    const members = state.relationMembers[relIx];
    for (let j = 0; j < members.length; j += 1) {
      const member = members[j];
      if (member.type === MEMBER_TYPE_NODE) {
        const nodeIx = state.nodeIdToIx.get(member.ref);
        if (nodeIx !== undefined) {
          keepNodeFromRelations[nodeIx] = 1;
        }
      }
    }
  }

  state.keepRelation = keepRelation;
  return keepNodeFromRelations;
}

// Step 5: Mark nodes required by all kept ways and kept relation-node members.
// This produces the final node keep-mask for output writing.
function fifthStepMarkKeptNodes(state, keepNodeFromRelations) {
  const keepNode = new Uint8Array(state.nodeIdByIx.length);
  for (let i = 0; i < keepNodeFromRelations.length; i += 1) {
    if (keepNodeFromRelations[i] === 1) {
      keepNode[i] = 1;
    }
  }

  for (let wayIx = 0; wayIx < state.wayIds.length; wayIx += 1) {
    if (state.keepWay[wayIx] !== 1) {
      continue;
    }
    const start = state.wayRefStart[wayIx];
    const len = state.wayRefLen[wayIx];
    for (let j = start; j < start + len; j += 1) {
      const nodeIx = state.wayNodeRefIxFlat[j];
      keepNode[nodeIx] = 1;
    }
  }

  state.keepNode = keepNode;
}

function formatBoundsXml(bounds) {
  return (
    '  <bounds minlat="' + escapeXmlAttr(bounds.latMin) +
    '" minlon="' + escapeXmlAttr(bounds.lonMin) +
    '" maxlat="' + escapeXmlAttr(bounds.latMax) +
    '" maxlon="' + escapeXmlAttr(bounds.lonMax) +
    '"/>'
  );
}

function formatTagXml(indent, key, value) {
  return indent + '<tag k="' + escapeXmlAttr(key) + '" v="' + escapeXmlAttr(value) + '"/>';
}

function formatNodeXml(state, nodeIx) {
  const id = state.nodeIdByIx[nodeIx];
  const lat = state.nodeLat[nodeIx];
  const lon = state.nodeLon[nodeIx];
  const tags = state.nodeTags[nodeIx] || [];

  if (tags.length === 0) {
    return '  <node id="' + id + '" lat="' + lat + '" lon="' + lon + '"/>';
  }

  const lines = [];
  lines.push('  <node id="' + id + '" lat="' + lat + '" lon="' + lon + '">');
  for (let i = 0; i < tags.length; i += 1) {
    lines.push(formatTagXml('    ', tags[i][0], tags[i][1]));
  }
  lines.push('  </node>');
  return lines.join('\n');
}

function formatWayXml(state, wayIx) {
  const wayId = state.wayIds[wayIx];
  const tags = state.wayTags[wayIx];
  const start = state.wayRefStart[wayIx];
  const len = state.wayRefLen[wayIx];

  const lines = [];
  lines.push('  <way id="' + wayId + '">');
  for (let i = start; i < start + len; i += 1) {
    const nodeIx = state.wayNodeRefIxFlat[i];
    const nodeId = state.nodeIdByIx[nodeIx];
    lines.push('    <nd ref="' + nodeId + '"/>');
  }
  for (let i = 0; i < tags.length; i += 1) {
    lines.push(formatTagXml('    ', tags[i][0], tags[i][1]));
  }
  lines.push('  </way>');
  return lines.join('\n');
}

function isRelationMemberKept(state, member) {
  if (member.type === MEMBER_TYPE_NODE) {
    const nodeIx = state.nodeIdToIx.get(member.ref);
    if (nodeIx === undefined) {
      return false;
    }
    return state.keepNode[nodeIx] === 1 && state.nodeHasCoord[nodeIx] === 1;
  }
  if (member.type === MEMBER_TYPE_WAY) {
    const wayIx = state.wayIdToIx.get(member.ref);
    if (wayIx === undefined) {
      return false;
    }
    return state.keepWay[wayIx] === 1;
  }
  if (member.type === MEMBER_TYPE_RELATION) {
    return state.keepRelation.has(member.ref);
  }
  return false;
}

function formatRelationXml(state, relIx) {
  const relId = state.relationIds[relIx];
  const tags = state.relationTags[relIx];
  const members = state.relationMembers[relIx];

  const lines = [];
  lines.push('  <relation id="' + relId + '">');
  for (let i = 0; i < members.length; i += 1) {
    const m = members[i];
    if (!isRelationMemberKept(state, m)) {
      continue;
    }
    const typeString = memberTypeToString(m.type);
    if (!typeString) {
      continue;
    }
    lines.push(
      '    <member type="' + typeString +
      '" ref="' + m.ref +
      '" role="' + escapeXmlAttr(m.role || '') +
      '"/>'
    );
  }
  for (let i = 0; i < tags.length; i += 1) {
    lines.push(formatTagXml('    ', tags[i][0], tags[i][1]));
  }
  lines.push('  </relation>');
  return lines.join('\n');
}

function writeText(stream, text) {
  return new Promise((resolve, reject) => {
    stream.write(text, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function endStream(stream) {
  return new Promise((resolve, reject) => {
    stream.end(() => resolve());
    stream.on('error', reject);
  });
}

// Step 6: Write pruned output OSM XML from compact indexed structures.
// Emit kept nodes/ways/relations and refreshed bounds without reloading full XML trees.
async function sixthStepWritePrunedOsm(state, bounds, outputPath) {
  const stream = fs.createWriteStream(outputPath, { encoding: 'utf8' });

  let rootAttrs = state.rootAttrs;
  if (!rootAttrs) {
    rootAttrs = { version: '0.6', generator: 'touch-mapper-prune-only-big-roads' };
  }
  if (!Object.prototype.hasOwnProperty.call(rootAttrs, 'version')) {
    rootAttrs.version = '0.6';
  }
  if (!Object.prototype.hasOwnProperty.call(rootAttrs, 'generator')) {
    rootAttrs.generator = 'touch-mapper-prune-only-big-roads';
  }

  const rootAttrParts = [];
  const rootKeys = Object.keys(rootAttrs);
  for (let i = 0; i < rootKeys.length; i += 1) {
    const key = rootKeys[i];
    rootAttrParts.push(' ' + key + '="' + escapeXmlAttr(rootAttrs[key]) + '"');
  }

  await writeText(stream, '<?xml version="1.0" encoding="UTF-8"?>\n');
  await writeText(stream, '<osm' + rootAttrParts.join('') + '>\n');
  await writeText(stream, formatBoundsXml(bounds) + '\n');

  for (let nodeIx = 0; nodeIx < state.nodeIdByIx.length; nodeIx += 1) {
    if (state.keepNode[nodeIx] !== 1) {
      continue;
    }
    if (state.nodeHasCoord[nodeIx] !== 1) {
      continue;
    }
    await writeText(stream, formatNodeXml(state, nodeIx) + '\n');
  }

  for (let wayIx = 0; wayIx < state.wayIds.length; wayIx += 1) {
    if (state.keepWay[wayIx] !== 1) {
      continue;
    }
    await writeText(stream, formatWayXml(state, wayIx) + '\n');
  }

  for (let relIx = 0; relIx < state.relationIds.length; relIx += 1) {
    const relId = state.relationIds[relIx];
    if (!state.keepRelation.has(relId)) {
      continue;
    }
    await writeText(stream, formatRelationXml(state, relIx) + '\n');
  }

  await writeText(stream, '</osm>\n');
  await endStream(stream);
}

async function run() {
  const args = parseArgs(process.argv);
  const bounds = {
    lonMin: args.lonMin,
    latMin: args.latMin,
    lonMax: args.lonMax,
    latMax: args.latMax,
  };

  const state = createState();

  await firstPassCollectIndexes(state, args.osm);
  await secondPassLoadNodeCoordinates(state, args.osm);
  thirdStepComputePruningDecision(state, bounds, args.targetDensityKmPerKm2);
  const keepNodeFromRelations = fourthStepApplyRelationKeepLogic(state);
  fifthStepMarkKeptNodes(state, keepNodeFromRelations);

  const outputPath = args.output;
  const inplace = outputPath === args.osm;
  const tempPath = inplace ? (outputPath + '.pruned.tmp') : outputPath;

  await sixthStepWritePrunedOsm(state, bounds, tempPath);

  if (inplace) {
    fs.renameSync(tempPath, outputPath);
  }
}

function hashUpdate(current, text) {
  let hash = current >>> 0;
  const s = String(text);
  for (let i = 0; i < s.length; i += 1) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function attrsToCanonicalString(attrs) {
  const keys = Object.keys(attrs || {}).sort();
  const parts = [];
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    parts.push(key + '=' + String(attrs[key]));
  }
  return parts.join('|');
}

async function collectSummaryWithCustomParser(osmPath) {
  const summary = {
    nodes: 0,
    ways: 0,
    relations: 0,
    tags: 0,
    ndRefs: 0,
    relationMembers: 0,
    relationMemberNode: 0,
    relationMemberWay: 0,
    relationMemberRelation: 0,
    selfClosingNodes: 0,
    selfClosingWays: 0,
    selfClosingRelations: 0,
    hash: 2166136261 >>> 0,
  };

  let currentNode = null;
  let currentWay = null;
  let currentRelation = null;

  function addHash(text) {
    summary.hash = hashUpdate(summary.hash, text);
  }

  await streamParseXml(osmPath, (token) => {
    if (currentNode !== null) {
      if (!token.closing && token.name === 'tag') {
        summary.tags += 1;
        addHash('N:TAG:' + attrsToCanonicalString(token.attrs));
      }
      if ((token.closing && token.name === 'node') || (token.selfClosing && token.name === 'node')) {
        addHash('N:CLOSE');
        currentNode = null;
      }
      return;
    }

    if (currentWay !== null) {
      if (!token.closing && token.name === 'nd') {
        summary.ndRefs += 1;
        addHash('W:ND:' + attrsToCanonicalString(token.attrs));
      } else if (!token.closing && token.name === 'tag') {
        summary.tags += 1;
        addHash('W:TAG:' + attrsToCanonicalString(token.attrs));
      }
      if ((token.closing && token.name === 'way') || (token.selfClosing && token.name === 'way')) {
        addHash('W:CLOSE');
        currentWay = null;
      }
      return;
    }

    if (currentRelation !== null) {
      if (!token.closing && token.name === 'member') {
        summary.relationMembers += 1;
        const memberType = token.attrs.type || '';
        if (memberType === 'node') {
          summary.relationMemberNode += 1;
        } else if (memberType === 'way') {
          summary.relationMemberWay += 1;
        } else if (memberType === 'relation') {
          summary.relationMemberRelation += 1;
        }
        addHash('R:MEM:' + attrsToCanonicalString(token.attrs));
      } else if (!token.closing && token.name === 'tag') {
        summary.tags += 1;
        addHash('R:TAG:' + attrsToCanonicalString(token.attrs));
      }
      if ((token.closing && token.name === 'relation') || (token.selfClosing && token.name === 'relation')) {
        addHash('R:CLOSE');
        currentRelation = null;
      }
      return;
    }

    if (!token.closing && token.name === 'node') {
      summary.nodes += 1;
      if (token.selfClosing) {
        summary.selfClosingNodes += 1;
      }
      addHash('N:OPEN:' + attrsToCanonicalString(token.attrs));
      if (!token.selfClosing) {
        currentNode = {};
      }
      return;
    }

    if (!token.closing && token.name === 'way') {
      summary.ways += 1;
      if (token.selfClosing) {
        summary.selfClosingWays += 1;
      }
      addHash('W:OPEN:' + attrsToCanonicalString(token.attrs));
      if (!token.selfClosing) {
        currentWay = {};
      }
      return;
    }

    if (!token.closing && token.name === 'relation') {
      summary.relations += 1;
      if (token.selfClosing) {
        summary.selfClosingRelations += 1;
      }
      addHash('R:OPEN:' + attrsToCanonicalString(token.attrs));
      if (!token.selfClosing) {
        currentRelation = {};
      }
      return;
    }
  });

  summary.hashHex = (summary.hash >>> 0).toString(16).padStart(8, '0');
  return summary;
}

function assertTrue(label, condition) {
  if (!condition) {
    throw new Error(label);
  }
}

function computeRoadGroupingKeep(roadEntries, areaM2, targetDensityKmPerKm2) {
  const lengthByRank = new Float64Array(ROAD_SCORE_BUCKET_COUNT);
  const roadGroupLength = [];
  const roadGroupMaxRank = [];
  const roadGroupIxByNameHash = new Map();
  const entryRoadGroupIx = new Int32Array(roadEntries.length);
  entryRoadGroupIx.fill(-1);

  for (let i = 0; i < roadEntries.length; i += 1) {
    const entry = roadEntries[i];
    let roadGroupIx;
    if (entry.nameHash === ROAD_NAME_HASH_UNNAMED) {
      roadGroupIx = roadGroupLength.length;
      roadGroupLength.push(0.0);
      roadGroupMaxRank.push(entry.rank);
    } else {
      roadGroupIx = roadGroupIxByNameHash.get(entry.nameHash);
      if (roadGroupIx === undefined) {
        roadGroupIx = roadGroupLength.length;
        roadGroupIxByNameHash.set(entry.nameHash, roadGroupIx);
        roadGroupLength.push(0.0);
        roadGroupMaxRank.push(entry.rank);
      }
    }
    roadGroupLength[roadGroupIx] += entry.lengthMeters;
    if (entry.rank > roadGroupMaxRank[roadGroupIx]) {
      roadGroupMaxRank[roadGroupIx] = entry.rank;
    }
    entryRoadGroupIx[i] = roadGroupIx;
  }

  for (let roadGroupIx = 0; roadGroupIx < roadGroupLength.length; roadGroupIx += 1) {
    const rank = roadGroupMaxRank[roadGroupIx];
    lengthByRank[scoreToBucketIx(rank)] += roadGroupLength[roadGroupIx];
  }

  const removedRanks = deriveRemovedRankBuckets(lengthByRank, areaM2, targetDensityKmPerKm2);
  const kept = new Array(roadEntries.length);
  for (let i = 0; i < roadEntries.length; i += 1) {
    const roadGroupIx = entryRoadGroupIx[i];
    kept[i] = !removedRanks.has(roadGroupMaxRank[roadGroupIx]);
  }
  return {
    kept,
    entryRoadGroupIx,
  };
}

function runRoadGroupingSelfTest() {
  const mainStreetHash = hashRoadName32(normalizeRoadNameForGrouping('Main Street'));
  const otherStreetHash = hashRoadName32(normalizeRoadNameForGrouping('Other Street'));
  const areaM2 = 1000000;
  const targetDensityKmPerKm2 = 0.12;

  const sameNameMixedRanks = computeRoadGroupingKeep(
    [
      { rank: 4, nameHash: mainStreetHash, lengthMeters: 100.0 },
      { rank: 8, nameHash: mainStreetHash, lengthMeters: 100.0 },
      { rank: 4, nameHash: otherStreetHash, lengthMeters: 120.0 },
    ],
    areaM2,
    targetDensityKmPerKm2
  );
  assertTrue('same-name ways should share one group', sameNameMixedRanks.entryRoadGroupIx[0] === sameNameMixedRanks.entryRoadGroupIx[1]);
  assertTrue('same-name mixed-rank segment A should be kept', sameNameMixedRanks.kept[0] === true);
  assertTrue('same-name mixed-rank segment B should be kept', sameNameMixedRanks.kept[1] === true);
  assertTrue('other lower-rank road should be pruned', sameNameMixedRanks.kept[2] === false);

  const unnamedFallback = computeRoadGroupingKeep(
    [
      { rank: 4, nameHash: ROAD_NAME_HASH_UNNAMED, lengthMeters: 100.0 },
      { rank: 8, nameHash: ROAD_NAME_HASH_UNNAMED, lengthMeters: 100.0 },
    ],
    areaM2,
    0.10
  );
  assertTrue('unnamed ways should not share a group', unnamedFallback.entryRoadGroupIx[0] !== unnamedFallback.entryRoadGroupIx[1]);
  assertTrue('unnamed lower-rank road should be pruned independently', unnamedFallback.kept[0] === false);
  assertTrue('unnamed higher-rank road should be kept independently', unnamedFallback.kept[1] === true);

  const normalizedA = normalizeRoadNameForGrouping(' Main  Street ');
  const normalizedB = normalizeRoadNameForGrouping('main street');
  assertTrue('name normalization should collapse case and whitespace', normalizedA === normalizedB);
  assertTrue('normalized names should produce identical hash', hashRoadName32(normalizedA) === hashRoadName32(normalizedB));

  const groupCheck = computeRoadGroupingKeep(
    [
      { rank: 5, nameHash: hashRoadName32(normalizeRoadNameForGrouping('Alpha Way')), lengthMeters: 20.0 },
      { rank: 5, nameHash: hashRoadName32(normalizeRoadNameForGrouping('Beta Way')), lengthMeters: 20.0 },
    ],
    areaM2,
    0.01
  );
  assertTrue('distinct names should map to distinct groups', groupCheck.entryRoadGroupIx[0] !== groupCheck.entryRoadGroupIx[1]);

  // Ranking behavior tests for OSM-tag-only scoring.
  const genericFootwayRank = adjustedRoadRank({ highway: 'footway' });
  const genericServiceRank = adjustedRoadRank({ highway: 'service' });
  const residentialRank = adjustedRoadRank({ highway: 'residential' });
  assertTrue('generic footway should rank below generic service', genericFootwayRank < genericServiceRank);
  assertTrue('generic service should rank below residential', genericServiceRank < residentialRank);

  const primaryRank = adjustedRoadRank({ highway: 'primary' });
  const primaryLinkRank = adjustedRoadRank({ highway: 'primary_link' });
  assertTrue('primary_link should rank at least primary', primaryLinkRank >= primaryRank);

  const namedFootwayRank = adjustedRoadRank({ highway: 'footway', name: 'Main Footway' });
  const serviceDrivewayRank = adjustedRoadRank({ highway: 'service', service: 'driveway' });
  assertTrue('named footway should outrank generic service driveway', namedFootwayRank > serviceDrivewayRank);

  const unknownRank = adjustedRoadRank({ highway: 'mystery_road' });
  assertTrue('unknown highway should be assigned very low score', unknownRank === ROAD_SCORE_MIN);

  const platformFootwayRank = adjustedRoadRank({ highway: 'footway', public_transport: 'platform' });
  assertTrue('platform footway should be promoted to secondary threshold or above', platformFootwayRank >= 10);

  console.log('road-grouping self-test passed');
}

function assertAlmostEqual(label, actual, expected, tolerance) {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(label + ': got=' + actual + ' expected=' + expected + ' tolerance=' + tolerance);
  }
}

function runBboxLengthSelfTest() {
  const bounds = {
    lonMin: 24.0,
    lonMax: 25.0,
    latMin: 60.0,
    latMax: 61.0,
  };

  const insideSegmentLength = segmentLengthWithinBoundsMeters(24.1, 60.1, 24.2, 60.2, bounds);
  const expectedInsideLength = computeHaversineM(60.1, 24.1, 60.2, 24.2);
  assertAlmostEqual('inside segment length', insideSegmentLength, expectedInsideLength, 1e-6);

  const outsideSegmentLength = segmentLengthWithinBoundsMeters(23.0, 59.0, 23.1, 59.1, bounds);
  assertAlmostEqual('outside segment length', outsideSegmentLength, 0.0, 1e-12);

  const crossingSegmentLength = segmentLengthWithinBoundsMeters(23.5, 60.5, 24.5, 60.5, bounds);
  const expectedCrossingLength = computeHaversineM(60.5, 24.0, 60.5, 24.5);
  assertAlmostEqual('crossing segment clipped length', crossingSegmentLength, expectedCrossingLength, 1e-6);

  const edgeTouchSegmentLength = segmentLengthWithinBoundsMeters(24.0, 60.2, 24.8, 60.2, bounds);
  const expectedEdgeTouchLength = computeHaversineM(60.2, 24.0, 60.2, 24.8);
  assertAlmostEqual('edge-touch segment length', edgeTouchSegmentLength, expectedEdgeTouchLength, 1e-6);

  const multiSegmentLength =
    segmentLengthWithinBoundsMeters(23.9, 60.5, 24.2, 60.5, bounds) +
    segmentLengthWithinBoundsMeters(24.2, 60.5, 24.3, 60.5, bounds);
  const expectedMultiSegmentLength =
    computeHaversineM(60.5, 24.0, 60.5, 24.2) +
    computeHaversineM(60.5, 24.2, 60.5, 24.3);
  assertAlmostEqual('multi-segment clipped length', multiSegmentLength, expectedMultiSegmentLength, 1e-6);

  const mainStreetHash = hashRoadName32(normalizeRoadNameForGrouping('Main Street'));
  const areaM2 = 1000000;
  const targetDensityKmPerKm2 = 0.12;
  const groupedWithOutsideSegment = computeRoadGroupingKeep(
    [
      { rank: 8, nameHash: mainStreetHash, lengthMeters: 100.0 },
      { rank: 4, nameHash: mainStreetHash, lengthMeters: 0.0 },
      { rank: 4, nameHash: hashRoadName32(normalizeRoadNameForGrouping('Other Street')), lengthMeters: 120.0 },
    ],
    areaM2,
    targetDensityKmPerKm2
  );
  assertTrue('same-name mixed-rank group should stay kept with outside zero-length segment', groupedWithOutsideSegment.kept[0] === true);
  assertTrue('same-name outside zero-length segment follows group keep decision', groupedWithOutsideSegment.kept[1] === true);

  const relationFilterState = {
    nodeIdToIx: new Map([[1, 0], [2, 1]]),
    keepNode: new Uint8Array([1, 0]),
    nodeHasCoord: new Uint8Array([1, 1]),
    wayIdToIx: new Map([[10, 0], [11, 1]]),
    keepWay: new Uint8Array([1, 0]),
    keepRelation: new Set([100]),
  };
  assertTrue('kept node relation member should be kept', isRelationMemberKept(relationFilterState, { type: MEMBER_TYPE_NODE, ref: 1 }) === true);
  assertTrue('removed node relation member should be dropped', isRelationMemberKept(relationFilterState, { type: MEMBER_TYPE_NODE, ref: 2 }) === false);
  assertTrue('kept way relation member should be kept', isRelationMemberKept(relationFilterState, { type: MEMBER_TYPE_WAY, ref: 10 }) === true);
  assertTrue('removed way relation member should be dropped', isRelationMemberKept(relationFilterState, { type: MEMBER_TYPE_WAY, ref: 11 }) === false);
  assertTrue('kept relation member should be kept', isRelationMemberKept(relationFilterState, { type: MEMBER_TYPE_RELATION, ref: 100 }) === true);
  assertTrue('removed relation member should be dropped', isRelationMemberKept(relationFilterState, { type: MEMBER_TYPE_RELATION, ref: 101 }) === false);

  console.log('bbox-length self-test passed');
}

module.exports = {
  parseTagToken,
  streamParseXml,
  collectSummaryWithCustomParser,
  runStreamParseXmlSelfTest,
  runRoadGroupingSelfTest,
  runBboxLengthSelfTest,
  normalizeRoadNameForGrouping,
  hashRoadName32,
  segmentLengthWithinBoundsMeters,
  clipSegmentToLonLatBounds,
};

if (require.main === module) {
  if (process.argv.indexOf('--self-test-stream-parse-xml') !== -1) {
    runStreamParseXmlSelfTest().catch((err) => {
      console.error(String(err && err.stack ? err.stack : err));
      process.exit(1);
    });
  } else if (process.argv.indexOf('--self-test-grouping') !== -1) {
    try {
      runRoadGroupingSelfTest();
    } catch (err) {
      console.error(String(err && err.stack ? err.stack : err));
      process.exit(1);
    }
  } else if (process.argv.indexOf('--self-test-bbox-length') !== -1) {
    try {
      runBboxLengthSelfTest();
    } catch (err) {
      console.error(String(err && err.stack ? err.stack : err));
      process.exit(1);
    }
  } else {
    run().catch((err) => {
      console.error(String(err && err.stack ? err.stack : err));
      process.exit(1);
    });
  }
}
