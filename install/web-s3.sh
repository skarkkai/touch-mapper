#!/bin/bash

set -e

if [[ $# != 2 ]]; then
    echo "Usage: $0 ENVIRONMENT DOMAIN_SUFFIX"
    exit 1
fi
environment=$1
suffix=$2
url=s3://${suffix}touch-mapper.org

cd "$( dirname "${BASH_SOURCE[0]}" )"
cd ../web

# build => dist
rm -rf dist
cp -a build dist
for lang in $(cd dist; find ?? -type d); do
    (
        cd dist/$lang
        rename 's/\.html//' *.html
        mv index index.html
    )
done
rm -f dist/.gitignore
cp -p src/scripts/environment.js.$environment dist/scripts/environment.js

# Sync dist to S3
aws s3 sync --delete --cache-control must-revalidate dist/ $url
for lang in $( cd dist; find ?? -maxdepth 0 -type d ); do
    aws s3 rm --quiet --recursive $url/$lang
    aws s3 sync --cache-control must-revalidate --content-type text/html dist/$lang/ $url/$lang
done


# Invalidate CloudFront
case $environment in
dev)
  aws cloudfront create-invalidation --distribution-id E1MTV53V6GWMYK --paths '/*'
  ;;
test)
  aws cloudfront create-invalidation --distribution-id E2Q2FFANJQFQ8G --paths '/*'
  ;;
prod)
  aws cloudfront create-invalidation --distribution-id E394513QCS44IG --paths '/*'
  ;;
*)
  echo "don't know how to invalidate CloudFront for $environment"
  exit 1
esac

