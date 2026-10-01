all:
	@echo "No default target exists"

FORCE: ;

osm2world:
	cd ./OSM2World && ant clean jar

.PHONY: osm2world test test-regression test-regression-verbose test-regression-full package test-install-ec2 test-restart prod-install-ec2 prod-restart test-deploy prod-deploy

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
	python3 test/map-content/check-print-heights.py
	$(MAKE) -C web build-offline
	bash test/e2e/run-offline-map-smoke.sh
	NODE_PATH=.tmp/e2e-playwright-runtime/node_modules node test/e2e/rectangular-maps.js
	NODE_PATH=.tmp/e2e-playwright-runtime/node_modules node test/e2e/print-heights.js
	NODE_PATH=.tmp/e2e-playwright-runtime/node_modules node .tmp/e2e-playwright-runtime/node_modules/playwright/cli.js test --config=test/e2e/ui-regression.config.js

dev-aws-install:
	install/lambda-update.sh dev
	install/cloudformation-update.sh dev

test-aws-install: $(if $(filter 1,$(TM_REGRESSION_ALREADY_PASSED)),,test-regression)
	TM_REGRESSION_ALREADY_PASSED=1 install/lambda-update.sh test
	TM_REGRESSION_ALREADY_PASSED=1 install/cloudformation-update.sh test

prod-aws-install: $(if $(filter 1,$(TM_REGRESSION_ALREADY_PASSED)),,test-regression)
	TM_REGRESSION_ALREADY_PASSED=1 install/lambda-update.sh prod
	@echo 'run: install/cloudformation-update.sh prod'

dev-web-s3-install:
	install/web-s3.sh dev

test-web-s3-install: $(if $(filter 1,$(TM_REGRESSION_ALREADY_PASSED)),,test-regression)
	TM_REGRESSION_ALREADY_PASSED=1 install/web-s3.sh test

prod-web-s3-install:
	@echo 'run: install/web-s3.sh prod'

package:
	install/package.sh

test-install-ec2: $(if $(filter 1,$(TM_REGRESSION_ALREADY_PASSED)),,test-regression)
	install/package.sh
	# First run: eval "$(ssh-agent -s)"; ssh-add .../ssh-key
	# "tm-ec2" needs to be defined as a Host in ~/.ssh/config
	rsync -a --delete --delay-updates -e ssh install/dist/ tm-ec2:touch-mapper/test/dist/
	ssh tm-ec2 python3 touch-mapper/test/dist/request-dashboard-refresh.py

test-restart:
	ssh -T tm-ec2 python3 - /home/ubuntu/touch-mapper/test 1 < converter/restart-poller.py

prod-install-ec2: $(if $(filter 1,$(TM_REGRESSION_ALREADY_PASSED)),,test-regression)
	install/package.sh
	ssh tm-ec2 rsync -a --delete touch-mapper/test/dist touch-mapper/prod/
	ssh tm-ec2 python3 touch-mapper/prod/dist/request-dashboard-refresh.py

prod-restart:
	ssh -T tm-ec2 python3 - /home/ubuntu/touch-mapper/prod 3 < converter/restart-poller.py

# Use the standalone targets in order. A full deployment passes its successful
# regression result into sub-makes and deployment scripts, avoiding repeat runs.
test-deploy: test-regression
	+$(MAKE) test-aws-install TM_REGRESSION_ALREADY_PASSED=1
	aws cloudformation wait stack-update-complete --stack-name TouchMapperTest
	+$(MAKE) test-web-s3-install TM_REGRESSION_ALREADY_PASSED=1
	+$(MAKE) test-install-ec2 TM_REGRESSION_ALREADY_PASSED=1
	+$(MAKE) test-restart

# Production EC2 code is promoted from the distribution already staged in test.
# The standalone production AWS and web targets intentionally print their manual
# follow-ups, so the wrapper executes those two steps explicitly.
prod-deploy: test-regression
	+$(MAKE) prod-aws-install TM_REGRESSION_ALREADY_PASSED=1
	TM_REGRESSION_ALREADY_PASSED=1 install/cloudformation-update.sh prod
	aws cloudformation wait stack-update-complete --stack-name TouchMapperProd
	TM_REGRESSION_ALREADY_PASSED=1 install/web-s3.sh prod
	+$(MAKE) prod-install-ec2 TM_REGRESSION_ALREADY_PASSED=1
	+$(MAKE) prod-restart
