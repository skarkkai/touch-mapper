#!/usr/bin/env node
'use strict';

const fs = require('fs');

const FLAG_ROAD = 1;
const FLAG_WATER_AREA = 2;
const FLAG_LINEAR_WATERWAY = 4;

const MEMBER_TYPE_NODE = 0;
const MEMBER_TYPE_WAY = 1;
const MEMBER_TYPE_RELATION = 2;

const ROAD_BASE_RANK = {
  service: 0,
  track: 1,
  path: 2,
  footway: 2,
  cycleway: 2,
  bridleway: 2,
  steps: 2,
  corridor: 2,
  pedestrian: 3,
  living_street: 3,
  residential: 4,
  unclassified: 5,
  tertiary: 6,
  tertiary_link: 6,
  secondary: 7,
  secondary_link: 7,
  primary: 8,
  primary_link: 8,
  trunk: 9,
  trunk_link: 9,
  motorway: 10,
  motorway_link: 10,
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
    targetDensityKmPerKm2: 120.0,
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

function baseRoadRank(highwayValue) {
  if (highwayValue === null || highwayValue === undefined) {
    return 5;
  }
  const normalized = String(highwayValue).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ROAD_BASE_RANK, normalized) ? ROAD_BASE_RANK[normalized] : 5;
}

function adjustedRoadRank(tags) {
  const highway = String(tags.highway || '').trim().toLowerCase();
  let rank = baseRoadRank(highway);
  const lanes = parseLanes(tags);
  const maxspeedKmh = parseMaxspeedKmh(tags);

  if (lanes !== null && lanes >= 2) {
    rank += 1;
  }
  if (isTruthyOsm(tags, 'oneway')) {
    rank += 1;
  }
  if (maxspeedKmh !== null && maxspeedKmh >= 70) {
    rank += 1;
  }
  if (highway === 'motorway' || highway === 'trunk' || highway === 'primary') {
    if ((lanes !== null && lanes >= 3) || (maxspeedKmh !== null && maxspeedKmh >= 90)) {
      rank += 2;
    }
  }

  if (String(tags.access || '').trim().toLowerCase() === 'private') {
    rank -= 1;
  }
  if (highway === 'service') {
    const service = String(tags.service || '').trim().toLowerCase();
    if (service === 'driveway' || service === 'parking_aisle') {
      rank -= 2;
    }
  }
  if (highway === 'track') {
    const tracktype = String(tags.tracktype || '').trim().toLowerCase();
    if (tracktype === 'grade4' || tracktype === 'grade5') {
      rank -= 1;
    }
  }

  if (rank < 0) {
    return 0;
  }
  if (rank > 10) {
    return 10;
  }
  return rank;
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
  for (let rank = 0; rank <= 10; rank += 1) {
    remainingM += Number(lengthByRank[rank] || 0.0);
  }

  for (let rank = 0; rank <= 10; rank += 1) {
    if (remainingM <= targetM) {
      break;
    }
    const bucketM = Number(lengthByRank[rank] || 0.0);
    if (remainingM - bucketM >= targetM) {
      removed.add(rank);
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
        const wayTagsMap = wayTagPairsToMap(currentWay.tags);
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
        state.wayIdToIx.set(currentWay.id, wayIx);
        state.wayIds.push(currentWay.id);
        state.wayFlags.push(flags);
        state.wayRank.push(rank);
        state.wayRefStart.push(currentWay.refStart);
        state.wayRefLen.push(currentWay.refLen);
        state.wayTags.push(currentWay.tags);

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
        const relike = { closing: true, name: 'way', selfClosing: true };
        // Trigger finalization block above on the next cycle.
        if (relike) {
          const wayTagsMap = wayTagPairsToMap(currentWay.tags);
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
          state.wayIdToIx.set(currentWay.id, wayIx);
          state.wayIds.push(currentWay.id);
          state.wayFlags.push(flags);
          state.wayRank.push(rank);
          state.wayRefStart.push(currentWay.refStart);
          state.wayRefLen.push(currentWay.refLen);
          state.wayTags.push(currentWay.tags);
          currentWay = null;
        }
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

function computeWayLengthMeters(state, wayIx) {
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
      total += computeHaversineM(
        state.nodeLat[prevIx],
        state.nodeLon[prevIx],
        state.nodeLat[nodeIx],
        state.nodeLon[nodeIx]
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
  const lengthByRank = new Float64Array(11);

  for (let wayIx = 0; wayIx < wayCount; wayIx += 1) {
    if ((state.wayFlags[wayIx] & FLAG_ROAD) === 0) {
      continue;
    }
    const rank = state.wayRank[wayIx];
    lengthByRank[rank] += computeWayLengthMeters(state, wayIx);
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
      const rank = state.wayRank[wayIx];
      if (!removedRanks.has(rank)) {
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

function formatRelationXml(state, relIx) {
  const relId = state.relationIds[relIx];
  const tags = state.relationTags[relIx];
  const members = state.relationMembers[relIx];

  const lines = [];
  lines.push('  <relation id="' + relId + '">');
  for (let i = 0; i < members.length; i += 1) {
    const m = members[i];
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

module.exports = {
  parseTagToken,
  streamParseXml,
  collectSummaryWithCustomParser,
  runStreamParseXmlSelfTest,
};

if (require.main === module) {
  if (process.argv.indexOf('--self-test-stream-parse-xml') !== -1) {
    runStreamParseXmlSelfTest().catch((err) => {
      console.error(String(err && err.stack ? err.stack : err));
      process.exit(1);
    });
  } else {
    run().catch((err) => {
      console.error(String(err && err.stack ? err.stack : err));
      process.exit(1);
    });
  }
}
