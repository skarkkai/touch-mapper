#!/bin/bash

set -e

cd "$( dirname "${BASH_SOURCE[0]}" )"

if [[ $# != 1 ]]; then
    echo "Usage: $0 ENVIRONMENT"
    exit 1
fi
environment=$1

eval $( ./parameters.sh $environment )

rm -f lambda-email-sending.zip
zip lambda-email-sending.zip lambda-email-sending.py

bucket=$env_name.internal.touch-mapper
region=$(aws configure get region)

cmd="aws s3api create-bucket --bucket $bucket --region $region --create-bucket-configuration LocationConstraint=$region"
$cmd 2>/dev/null || true

cmd="aws s3 cp lambda-email-sending.zip s3://$bucket"
$cmd

