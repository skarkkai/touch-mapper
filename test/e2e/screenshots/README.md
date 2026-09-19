# Reviewed UI baselines

These five PNGs are intentional visual expectations for basic settings,
advanced landscape settings, advanced portrait settings on mobile, and 2D/3D
results. They were captured and visually reviewed on Linux with Playwright
1.58.2's bundled Chromium, device scale 1, en-US/UTC, and locally installed
fallback fonts (the external Google Fonts request is blocked). These offline
checks do not reproduce Google's live font delivery. Use the same browser/runtime
and system fonts when comparing; differences
from another platform require investigation, not automatic baseline replacement.

The configuration fails on missing or changed snapshots. It allows antialiasing
color tolerance (0.2), but no pixels beyond that tolerance may differ. Browser
animations are disabled, fonts must finish loading, and external services are
blocked. The settings map tiles are absent; its footprint, border, marker and
coverage text remain visible. Only the WebGL canvas is masked in the 3D result;
its surrounding layout, controls and description remain compared. The existing
STL assertions and unmasked review artifacts cover rendered geometry separately.

Run comparisons after the full suite has built the UI, generated the local result
fixtures, and started the preview:

```bash
NODE_PATH=.tmp/e2e-playwright-runtime/node_modules node .tmp/e2e-playwright-runtime/node_modules/playwright/cli.js test --config=test/e2e/ui-regression.config.js
```

Failures write actual/expected/difference images and traces beneath
`.tmp/e2e/ui-regression/`. Inspect them before deciding whether the code or the
expectation is wrong. Never update screenshots just to make a test pass.

For an intentional UI change, explicitly regenerate only the affected cases:

```bash
NODE_PATH=.tmp/e2e-playwright-runtime/node_modules node .tmp/e2e-playwright-runtime/node_modules/playwright/cli.js test --config=test/e2e/ui-regression.config.js --grep 'visual: advanced' --update-snapshots=all
```

Visually inspect every changed PNG for layout, wrapping, clipping, focus and
meaning; include those files in the code review. Then rerun without the update
flag. Initial baselines were reviewed for all five views; this command is not
part of the normal test suite.

A failure probe reproduces the portrait border bug without modifying product
code or accepted screenshots. This command must fail and produce a visual diff:

```bash
TM_UI_FAILURE_PROBE=border NODE_PATH=.tmp/e2e-playwright-runtime/node_modules node .tmp/e2e-playwright-runtime/node_modules/playwright/cli.js test --config=test/e2e/ui-regression.config.js --grep advanced-portrait-mobile --output=.tmp/e2e/ui-probe
```

Browser commands need `sandbox_permissions: require_escalated` in a
socket-restricted agent environment, as documented in map-content-verification.
