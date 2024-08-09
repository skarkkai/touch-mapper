#!/bin/bash

if [[ $# != 1 ]]; then
    echo "Usage: $0 ENVIRONMENT"
    exit 1
fi
environment=$1

cd "$( dirname "${BASH_SOURCE[0]}" )"

eval $( ../install/parameters.sh $environment )
if [[ $is_dev_env == true ]]; then
    tm_domain=$( aws cloudfront list-distributions | jq --raw-output ".DistributionList.Items[] | select(.Origins.Items[].DomainName == \"$env_name.maps.touch-mapper.s3.amazonaws.com\") | .DomainName" )
    if [[ ! $tm_domain ]]; then
        echo "$0: no CloudFront distribution for '$env_name' found" >&2
        exit 1
    fi
else
    tm_domain=$domain
fi

map_request_sqs_queue=$( aws sqs list-queues | jq --raw-output ".QueueUrls[]" | egrep "$environment-requests-touch-mapper" )

echo "window.TM_ENVIRONMENT = '$env_name';"
echo "window.TM_DOMAIN = '$tm_domain';"
echo "window.TM_REGION = '$(aws configure get region)';"
echo "window.TM_MAP_REQUEST_SQS_QUEUE = '$map_request_sqs_queue';"
