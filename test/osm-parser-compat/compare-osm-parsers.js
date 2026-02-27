#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const pruneModulePath = path.join(repoRoot, 'converter', 'prune-only-big-roads.js');
const pruneParser = require(pruneModulePath);

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

function normalizeSaxAttrs(attrs) {
  const out = {};
  const keys = Object.keys(attrs || {});
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const value = attrs[key];
    if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')) {
      out[key] = String(value.value);
    } else {
      out[key] = String(value);
    }
  }
  return out;
}

function ensureSaxFromCache(vendorDir) {
  const cacheDir = path.join(process.env.HOME || '', '.npm', '_cacache');
  const possibleKeys = [
    'make-fetch-happen:request-cache:https://registry.npmjs.org/sax/-/sax-1.2.4.tgz',
    'make-fetch-happen:request-cache:https://registry.npmjs.org/sax/-/sax-1.4.1.tgz',
  ];
  const cacachePath = '/usr/lib/node_modules/npm/node_modules/cacache';

  let cacache = null;
  try {
    cacache = require(cacachePath);
  } catch (_) {
    return null;
  }

  if (!fs.existsSync(vendorDir)) {
    fs.mkdirSync(vendorDir, { recursive: true });
  }
  const vendorSaxDir = path.join(vendorDir, 'sax');

  for (let i = 0; i < possibleKeys.length; i += 1) {
    const key = possibleKeys[i];
    try {
      const entry = cacache.get.sync(cacheDir, key);
      if (!entry || !entry.data) {
        continue;
      }

      const tgzPath = path.join(vendorDir, 'sax.tgz');
      fs.writeFileSync(tgzPath, entry.data);

      if (fs.existsSync(vendorSaxDir)) {
        fs.rmSync(vendorSaxDir, { recursive: true, force: true });
      }
      fs.mkdirSync(vendorSaxDir, { recursive: true });

      const { spawnSync } = require('child_process');
      const untar = spawnSync('tar', ['-xzf', tgzPath, '-C', vendorSaxDir, '--strip-components=1'], {
        stdio: 'pipe',
      });
      if (untar.status !== 0) {
        continue;
      }

      return vendorSaxDir;
    } catch (_) {
      continue;
    }
  }

  return null;
}

function loadSaxModule() {
  try {
    return require('sax');
  } catch (_) {}

  const fallbackLocations = [
    path.join(repoRoot, '.tmp', 'osm-parser-verify', 'node_modules', 'sax'),
    path.join(__dirname, 'node_modules', 'sax'),
  ];
  for (let i = 0; i < fallbackLocations.length; i += 1) {
    const p = fallbackLocations[i];
    try {
      return require(p);
    } catch (_) {}
  }

  const vendorDir = path.join(__dirname, '.vendor');
  const cachedSaxDir = ensureSaxFromCache(vendorDir);
  if (cachedSaxDir) {
    try {
      return require(cachedSaxDir);
    } catch (_) {}
  }

  throw new Error(
    [
      'Could not load sax parser.',
      'Tried: local node_modules, .tmp/osm-parser-verify/node_modules/sax, and npm cache extraction.',
      'Install with: cd test/osm-parser-compat && npm install',
    ].join(' ')
  );
}

function collectSummaryWithSaxParser(osmPath) {
  const sax = loadSaxModule();

  return new Promise((resolve, reject) => {
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

    function addHash(text) {
      summary.hash = hashUpdate(summary.hash, text);
    }

    let currentNode = false;
    let currentWay = false;
    let currentRelation = false;

    const parser = sax.createStream(true, {
      trim: false,
      normalize: false,
      xmlns: false,
      lowercase: true,
      position: false,
      strictEntities: false,
    });

    parser.on('opentag', (tag) => {
      const name = String(tag.name || '').toLowerCase();
      const attrs = normalizeSaxAttrs(tag.attributes || {});
      const selfClosing = !!tag.isSelfClosing;

      if (currentNode) {
        if (name === 'tag') {
          summary.tags += 1;
          addHash('N:TAG:' + attrsToCanonicalString(attrs));
        }
        return;
      }

      if (currentWay) {
        if (name === 'nd') {
          summary.ndRefs += 1;
          addHash('W:ND:' + attrsToCanonicalString(attrs));
        } else if (name === 'tag') {
          summary.tags += 1;
          addHash('W:TAG:' + attrsToCanonicalString(attrs));
        }
        return;
      }

      if (currentRelation) {
        if (name === 'member') {
          summary.relationMembers += 1;
          const memberType = attrs.type || '';
          if (memberType === 'node') {
            summary.relationMemberNode += 1;
          } else if (memberType === 'way') {
            summary.relationMemberWay += 1;
          } else if (memberType === 'relation') {
            summary.relationMemberRelation += 1;
          }
          addHash('R:MEM:' + attrsToCanonicalString(attrs));
        } else if (name === 'tag') {
          summary.tags += 1;
          addHash('R:TAG:' + attrsToCanonicalString(attrs));
        }
        return;
      }

      if (name === 'node') {
        summary.nodes += 1;
        if (selfClosing) {
          summary.selfClosingNodes += 1;
        }
        addHash('N:OPEN:' + attrsToCanonicalString(attrs));
        if (!selfClosing) {
          currentNode = true;
        }
        return;
      }

      if (name === 'way') {
        summary.ways += 1;
        if (selfClosing) {
          summary.selfClosingWays += 1;
        }
        addHash('W:OPEN:' + attrsToCanonicalString(attrs));
        if (!selfClosing) {
          currentWay = true;
        }
        return;
      }

      if (name === 'relation') {
        summary.relations += 1;
        if (selfClosing) {
          summary.selfClosingRelations += 1;
        }
        addHash('R:OPEN:' + attrsToCanonicalString(attrs));
        if (!selfClosing) {
          currentRelation = true;
        }
      }
    });

    parser.on('closetag', (rawName) => {
      const name = String(rawName || '').toLowerCase();
      if (name === 'node' && currentNode) {
        addHash('N:CLOSE');
        currentNode = false;
      } else if (name === 'way' && currentWay) {
        addHash('W:CLOSE');
        currentWay = false;
      } else if (name === 'relation' && currentRelation) {
        addHash('R:CLOSE');
        currentRelation = false;
      }
    });

    parser.on('error', (err) => reject(err));
    parser.on('end', () => {
      summary.hashHex = (summary.hash >>> 0).toString(16).padStart(8, '0');
      resolve(summary);
    });

    fs.createReadStream(osmPath, { encoding: 'utf8' })
      .on('error', reject)
      .pipe(parser);
  });
}

function diffSummaries(left, right) {
  const diffs = [];
  const keys = Object.keys(left);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (!Object.prototype.hasOwnProperty.call(right, key)) {
      diffs.push(key + ': missing from sax summary');
      continue;
    }
    if (left[key] !== right[key]) {
      diffs.push(key + ': custom=' + JSON.stringify(left[key]) + ' sax=' + JSON.stringify(right[key]));
    }
  }
  return diffs;
}

async function compareOne(label, osmPath) {
  const custom = await pruneParser.collectSummaryWithCustomParser(osmPath);
  const sax = await collectSummaryWithSaxParser(osmPath);
  const diffs = diffSummaries(custom, sax);

  console.log('--- ' + label + ' ---');
  console.log('file:', osmPath);
  console.log('custom:', JSON.stringify(custom));
  console.log('sax:   ', JSON.stringify(sax));

  if (diffs.length > 0) {
    console.log('DIFFS:');
    for (let i = 0; i < diffs.length; i += 1) {
      console.log('  - ' + diffs[i]);
    }
    return false;
  }

  console.log('MATCH: summaries are identical');
  return true;
}

function writeFixture(pathname, text) {
  fs.mkdirSync(path.dirname(pathname), { recursive: true });
  fs.writeFileSync(pathname, text, 'utf8');
}

function ensureEdgeFixtures() {
  const fixturesDir = path.join(__dirname, 'fixtures');

  writeFixture(
    path.join(fixturesDir, 'edge-self-closing.osm'),
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<osm version="0.6" generator="fixture">\n' +
    '  <node id="1" lat="60" lon="24"/>\n' +
    '  <way id="10"/>\n' +
    '  <relation id="20"/>\n' +
    '</osm>\n'
  );

  writeFixture(
    path.join(fixturesDir, 'edge-nested.osm'),
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<osm version="0.6" generator="fixture">\n' +
    '  <node id="1" lat="60" lon="24"><tag k="name" v="A &amp; B"/></node>\n' +
    '  <node id="2" lat="60.1" lon="24.1"/>\n' +
    '  <way id="10"><nd ref="1"/><nd ref="2"/><tag k="highway" v="residential"/></way>\n' +
    '  <relation id="20"><member type="way" ref="10" role="outer"/><tag k="type" v="multipolygon"/></relation>\n' +
    '</osm>\n'
  );

  writeFixture(
    path.join(fixturesDir, 'edge-entities.osm'),
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<osm version="0.6" generator="fixture">\n' +
    '  <!-- comment -->\n' +
    '  <node id="3" lat="61" lon="25">\n' +
    '    <tag k="note" v="Tom &apos;N&apos; Jerry &quot;Q&quot;"/>\n' +
    '  </node>\n' +
    '  <relation id="30">\n' +
    '    <member type="node" ref="3" role=""/>\n' +
    '    <member type="relation" ref="20" role="sub"/>\n' +
    '  </relation>\n' +
    '</osm>\n'
  );

  return [
    { label: 'edge-self-closing', path: path.join(fixturesDir, 'edge-self-closing.osm') },
    { label: 'edge-nested', path: path.join(fixturesDir, 'edge-nested.osm') },
    { label: 'edge-entities', path: path.join(fixturesDir, 'edge-entities.osm') },
  ];
}

async function main() {
  const explicitOsm = process.argv[2];
  const complexOsm = path.join(repoRoot, 'test', 'map-content', 'cache', 'complex', 'map.osm');
  const fixtures = ensureEdgeFixtures();

  const targets = [];
  targets.push({ label: 'complex', path: explicitOsm || complexOsm });
  for (let i = 0; i < fixtures.length; i += 1) {
    targets.push(fixtures[i]);
  }

  let ok = true;
  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    const oneOk = await compareOne(target.label, target.path);
    if (!oneOk) {
      ok = false;
    }
  }

  if (!ok) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
