# Development Setup

This document contains local setup and deployment-oriented developer workflows.

## Install dependencies

```bash
./init.sh
```

## Setup AWS CLI

```bash
aws configure
```

## Create AWS resources

```bash
make dev-aws-install
```

API Gateway for email-sending Lambda is currently not created automatically.
The same API Gateway endpoints can be reused across Touch Mapper instances.

## Install static website to S3

```bash
make dev-web-s3-install
```

The last output line includes the CloudFront URL (for example `https://something.cloudfront.net`) for accessing the web UI.

## Run OSM -> STL converter service

Run in a separate terminal tab:

```bash
install/run-dev-converter.sh
```

## Local web development

In `web/`, run these in separate terminal tabs:

```bash
make watch
make serve
```

Then open `http://localhost:9000`.
