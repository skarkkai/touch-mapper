# OSM Parser Compatibility Check

This test compares the custom streaming parser in `converter/prune-only-big-roads.js`
against the `sax` library parser on the same OSM XML input.

It computes a canonical summary (counts + stable hash) from both parsers and fails
if any field differs.

## Run

From repo root:

```bash
node test/osm-parser-compat/compare-osm-parsers.js
```

Optional explicit OSM path:

```bash
node test/osm-parser-compat/compare-osm-parsers.js /path/to/map.osm
```

## Dependency notes

Preferred setup:

```bash
cd test/osm-parser-compat
npm install
```

The script also supports fallback loading of `sax` from:

1. `.tmp/osm-parser-verify/node_modules/sax`
2. local npm cache extraction via npm's internal `cacache` module

This keeps the verifier runnable even when external npm registry DNS is flaky.
