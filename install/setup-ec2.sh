#!/bin/bash

sudo bash -c "echo LC_ALL=en_US.UTF-8 >>/etc/default/locale"
. /etc/default/locale 
export LC_ALL

sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get -y install awscli openjdk-8-jre-headless libglu1-mesa libxi6 python3-cairosvg
aws configure
sudo cp -r /home/ubuntu/.aws /root/

sudo fallocate -l 200M /swap
sudo mkswap /swap
echo "/swap  none  swap  sw 0  0" | sudo tee -a /etc/fstab

dir=~ubuntu/touch-mapper
for execmode in test prod; do
    mkdir -p $dir/$execmode/runtime
done

# Make a symlink whose target will be installed a bit later
sudo ln -s $dir/test/dist/ec2-init.sh /etc/init.d/touch-mapper

