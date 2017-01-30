#!/bin/bash

set -e

cd "$( dirname "${BASH_SOURCE[0]}" )"

if [[ $# != 1 ]]; then
    echo "Usage: $0 ENVIRONMENT"
    exit 1
fi
environment=$1

eval $( parameters.sh )

if aws cloudformation describe-stacks --stack-name $stack_name >&/dev/null; then
    mode=update
else
    mode=create
fi

echo "mode: $mode"
echo "stack_name: $stack_name"
echo "env_name: $env_name"
echo "is_dev_env: $is_dev_env"
echo "domain: $domain"

set -v
aws cloudformation $mode-stack --stack-name $stack_name --template-body file://cloudformation.json \
    --parameters ParameterKey=Environment,ParameterValue=$env_name \
                 ParameterKey=IsDevEnv,ParameterValue=$is_dev_env \
                 ParameterKey=Domain,ParameterValue=$domain

