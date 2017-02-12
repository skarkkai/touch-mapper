# Touch Mapper

Tactile map maker. Creates 3D-printable files from OpenStreetMap data. See https://touch-mapper.org

## Feature roadmap

List is in a rough priority order.

- Allow printing a QR sticker that points to touch-mapper.org/?map=deadbeef
- Allow inspecting maps on a touch device.
  - APH's Nearby Explorer, and other apps
- Describe map contents in the web UI.
  - Roads: intersections between roads, and between roads and map borders; street numbers
  - Points of interest, esp. bus stops: https://developers.google.com/maps/documentation/javascript/places#place_search_requests
  - May be difficult when using OSM2World
  - Separate app would be able to do a better job. There are some plans for such apps.
- Print labels for roads and/or points of interest
  - Maybe use short labels, and offer a separate legend that maps the labels to longer descriptions. The legend could be electronic.
- Replace spinning 3D preview with one or more larger static images, create using Blender Render, using ambient occlusion
  - 3D preview is too small and unclear, and doesn't work on all devices
- Allow selecting which things are included. Most important would be to allow excluding buildings.
- Make selected address (indicated by the marker) draggable
- Avoid significant overlaps between roads and buildings. This would enable reliable two-color 3D printing.
  - Maybe use https://sourceforge.net/projects/jts-topo-suite/ from OSM2World
- Print a compass star into corner of the map
- Indicate map scale using small dots on map borders
- Smaller scale modes: only show water/land/green areads; N largest roads; city borders
- Non-square maps

Technical TODO:

- Move converter from EC2 to Lambda

## Development

### Install dependencies

    ./init.sh

### Setup AWS CLI

    aws configure

### Create AWS resources

    make dev-aws-install

API Gateway for accessing email sending Lambda is for now not created
automatically. The same API GW endpoints can be used by all Touch Mapper
instances.

### Install static website to S3

    make dev-web-s3-install

Last line of output gives the URL (https://something.cloudfront.net) where
the web UI can be accessed.

### Run OSM -> STL converter service

In a tab of its own:

    install/run-dev-converter.sh

### Local web development

In `web` dir, in separate tabs:

    make watch
    make serve

You can now access the web UI in http://localhost:9000

