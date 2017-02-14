#!/bin/bash

sudo bash -c "echo LC_ALL=en_US.UTF-8 >>/etc/default/locale"
. /etc/default/locale 
export LC_ALL

sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get -y install awscli openjdk-8-jre-headless libglu1-mesa libxi6
aws configure
sudo cp -r /home/ubuntu/.aws /root/

mkdir -p touch-mapper/runtime
cd touch-mapper
aws s3 cp s3://meta.touch-mapper/converter-dist.tgz /tmp
tar xf /tmp/converter-dist.tgz dist/ec2-init.sh
sudo ln -s $PWD/dist/ec2-init.sh /etc/init.d/touch-mapper
sudo update-rc.d touch-mapper defaults

