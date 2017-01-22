#!/bin/bash
### BEGIN INIT INFO
# Provides:          touch-mapper
# Required-Start:    $all
# Required-Stop:
# Default-Start:
# Default-Stop:
# Short-Description: Init and start Touch Mapper converter poller
### END INIT INFO
#
# Update apt packages.
# Runs N instances of poller.sh, passing correct execmode from EC2 user-data
#

nice apt-get update
nice apt-get upgrade -y

set -e

cd ~ubuntu/touch-mapper
aws s3 cp s3://meta.touch-mapper/converter-dist.tgz .
tar xf converter-dist.tgz 

exec sudo -u ubuntu ~ubuntu/touch-mapper/dist/ec2-restart-pollers.sh

