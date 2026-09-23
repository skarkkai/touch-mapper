all:
	@echo "No default target exists"

FORCE: ;

osm2world:
	cd ./OSM2World && ant clean jar

.PHONY: osm2world test test-regression test-regression-verbose test-regression-full package test-install-ec2 test-restart prod-install-ec2 prod-restart

test: test-regression

test-regression:
	@python3 test/regression/run.py

test-regression-verbose:
	@python3 test/regression/run.py --verbose --keep-logs

test-regression-full: test-regression
	bash test/run-osm2world-regression.sh
	python3 test/map-content/check-regression.py
	python3 test/map-content/check-content-filter.py
	python3 test/map-content/check-rectangular-maps.py
	$(MAKE) -C web build-offline
	bash test/e2e/run-offline-map-smoke.sh
	NODE_PATH=.tmp/e2e-playwright-runtime/node_modules node test/e2e/rectangular-maps.js
	NODE_PATH=.tmp/e2e-playwright-runtime/node_modules node .tmp/e2e-playwright-runtime/node_modules/playwright/cli.js test --config=test/e2e/ui-regression.config.js

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
	ssh tm-ec2 python3 touch-mapper/test/dist/request-dashboard-refresh.py

test-restart:
	ssh -T tm-ec2 python3 - /home/ubuntu/touch-mapper/test 1 < converter/restart-poller.py

prod-install-ec2: test-regression
	install/package.sh
	ssh tm-ec2 rsync -a --delete touch-mapper/test/dist touch-mapper/prod/
	ssh tm-ec2 python3 touch-mapper/prod/dist/request-dashboard-refresh.py

prod-restart:
	ssh -T tm-ec2 python3 - /home/ubuntu/touch-mapper/prod 3 < converter/restart-poller.py
