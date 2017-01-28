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
    stack_name=TouchMapperDev${dev_env^}
    is_dev_env=true
    domain=$dev_env.touch-mapper.org
else

    stack_name=TouchMapper${environment^}
    is_dev_env=false
    if [[ $environment == prod ]]; then
        domain=touch-mapper.org
    else
        domain=$environment.touch-mapper.org
    fi
fi

set -v
aws cloudformation update-stack --stack-name $stack_name --template-body file://install/cloudformation.json \
    --parameters ParameterKey=Environment,ParameterValue=$environment \
                 ParameterKey=IsDevEnv,ParameterValue=$is_dev_env \
                 ParameterKey=Domain,ParameterValue=$domain

