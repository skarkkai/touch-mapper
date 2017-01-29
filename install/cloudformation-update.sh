#!/bin/bash

set -e

if [[ $# != 1 ]]; then
    echo "Usage: $0 ENVIRONMENT"
    exit 1
fi
environment=$1

if [[ $environment == dev ]]; then
    dev_env=${TOUCH_MAPPER_DEV_ENV:-$USER}
    if [[ ! $dev_env ]]; then
        echo "Environment variables TOUCH_MAPPER_DEV_ENV and USER are both unset, aborting"
    fi
    env_name=dev-$dev_env
    stack_name=TouchMapperDev${dev_env^}
    is_dev_env=true
    domain=dev-$dev_env.touch-mapper.org
else
    stack_name=TouchMapper${environment^}
    is_dev_env=false
    if [[ $environment == prod ]]; then
        domain=touch-mapper.org
    else
        domain=$environment.touch-mapper.org
    fi
fi

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
aws cloudformation $mode-stack --stack-name $stack_name --template-body file://install/cloudformation.json \
    --parameters ParameterKey=Environment,ParameterValue=$env_name \
                 ParameterKey=IsDevEnv,ParameterValue=$is_dev_env \
                 ParameterKey=Domain,ParameterValue=$domain

