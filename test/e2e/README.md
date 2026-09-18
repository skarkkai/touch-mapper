# Browser regression checks

The normal offline smoke is included in `make test-regression-full`. It exercises
keyboard search, settings, the real Create button, stubbed queue/polling responses,
automatic result navigation, generated STL preview, map description and download
links using Chromium. Setup and fixture coverage are documented in
`doc/map-content-verification.md`. After generating the fixtures and building the
web UI, run it alone with `bash test/e2e/run-offline-map-smoke.sh`.

## Live settings persistence regression

This end-to-end regression test automates the Touch Mapper UI flow:

1. Open address search
2. Search for a real address
3. Change map settings
4. Create a map
5. Return to the settings page
6. Verify settings persisted

The test includes an explicit assertion for `mapSizePreset` persistence.

## Run

From repo root:

```bash
bash test/e2e/run-touch-mapper-settings-regression.sh
```

Options are passed through to the Node runner:

```bash
bash test/e2e/run-touch-mapper-settings-regression.sh \
  --base-url https://test.touch-mapper.org \
  --address "Helsinki Central Railway Station"
```

Use `--headed` to run with a visible browser.

## Output

Artifacts are written under `.tmp/e2e/settings-regression-<timestamp>/`:

- `01-area-initial.png`
- `02-area-configured.png`
- `03-map-created.png`
- `04-area-returned.png`
- `report.json` (or `report-error.json` on crash)
