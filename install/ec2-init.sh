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

exec sudo -H -u ubuntu ~ubuntu/touch-mapper/test/dist/ec2-restart-pollers.sh

