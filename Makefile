all:
	@echo "No default target exists"

FORCE: ;

osm2world:
	cd OSM2World && ant clean jar

.PHONY: test test-regression test-integration package test-install-ec2 test-restart prod-install-ec2

test: test-regression

test-regression:
	python3 test/regression/run.py

test-integration:
	test/run-osm2world-regression.sh

dev-aws-install:
	install/lambda-update.sh dev
	install/cloudformation-update.sh dev

test-aws-install:
	install/lambda-update.sh test
	install/cloudformation-update.sh test

prod-aws-install:
	install/lambda-update.sh prod
	@echo 'run: install/cloudformation-update.sh prod'

dev-web-s3-install:
	install/web-s3.sh dev

test-web-s3-install:
	install/web-s3.sh test

prod-web-s3-install:
	@echo 'run: install/web-s3.sh prod'

package:
	install/package.sh

test-install-ec2: test-regression
	install/package.sh
	# First run: eval "$(ssh-agent -s)"; ssh-add .../ssh-key
	# "tm-ec2" needs to be defined as a Host in ~/.ssh/config
	rsync -a --delete --delay-updates -e ssh install/dist/ tm-ec2:touch-mapper/test/dist/

test-restart: test-regression
	install/package.sh
	ssh tm-ec2 touch-mapper/test/dist/ec2-restart-pollers.sh

prod-install-ec2: test-regression
	install/package.sh
	ssh tm-ec2 rsync -a --delete touch-mapper/test/dist touch-mapper/prod/
