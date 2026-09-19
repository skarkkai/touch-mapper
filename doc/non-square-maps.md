# Rectangular maps

Basic print presets still select squares. Advanced settings expose Width (X)
and Height (Y) in centimeters, from 1 to 99.9 in increments of 0.1. Disabling
Advanced restores the selected square preset (27.9 cm for 2D). Changing printing
technology resets both dimensions to its default. Scale remains isotropic.

Coverage is width/100 × scale by height/100 × scale meters. Multipart X shifts
are percentages of coverage width; Y shifts are percentages of coverage height.
Manual offsets must be strictly inside the respective half extent. The selection
preview fits the rectangle into the available width and a maximum height of
500 pixels. The result's 3D camera viewport remains square; the 2D preview uses
the SVG's intrinsic proportions, including the extra north-indicator strip.

## Direct URL interface

The existing BlindSquare parameter entry point accepts:

`/en/area?origin=BlindSquare&lat=60.17&lon=24.94&addrName=Example&printWidthCm=20&printHeightCm=10&scale=2400`

Both explicit dimensions are required together and override `size`, `mapSize`
or `map_size`. Those legacy aliases still select squares. Rectangular and custom
sizes enable Advanced so their dimensions are visible. Map-ID URLs are unchanged.
Old `info.json` and localStorage `size` values initialize both axes only if neither
explicit dimension exists. Invalid, missing-partner, nonfinite and out-of-range
dimensions are rejected, without guessing a square.

Email metadata includes both numeric dimensions. The Lambda accepts old square
metadata too and displays W × H cm. Partner ordering is already absent from the
current result template; remaining ordering code rejects rectangles. Downloads
and email sharing remain available. The converter and email Lambda must be
updated before the web release; the Lambda CloudFormation runtime moves from
obsolete Python 2.7 to Python 3.12 with its Python 3 URL handling; no external service was deployed by this change.

## Verification

`make test-regression` covers normalization, malformed pairs, metadata persistence,
legacy CLI input, axis-relative multipart movement and area-based road density.
`make test-regression-full` additionally runs real rectangular conversions and
Chromium form/request/preview checks. Artifacts and reviewed screenshots are in
`.tmp/rectangular-maps/`. OSM tile requests are blocked in offline browser checks;
the map footprint, marker, controls and coverage text are still exercised.

The converter check covers 20 × 10, 10 × 20, borderless 20 × 10, and 50 × 5 cm.
It checks actual STL/base extents, unchanged base thickness, location marker
placement/edge suppression, split STLs, SVG/viewBox, PDF page size, and request
metadata. Bounds allow existing projection error: 1 mm or 0.3%, whichever is
larger. The browser additionally checks extreme aspect ratios, mobile layout,
all locales, old storage migration, presets, bounds and per-axis offset limits.
