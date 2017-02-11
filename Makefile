all:
	@echo "No default target exists"

osm2world:
	cd OSM2World && ant

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

test-install-ec2: package
	# "tm-ec2-test" needs to be defined as a Host in ~/.ssh/config
	rsync -a --delete --delay-updates -e ssh install/dist/ tm-ec2-test:touch-mapper/dist/
	ssh tm-ec2-test touch-mapper/dist/ec2-restart-pollers.sh

test-install-ec2-diff: package
	rsync -a --delete --delay-updates --dry-run --verbose -e ssh install/dist/ tm-ec2-test:touch-mapper/dist/

test-cp-to-s3.sh:
	ssh tm-ec2-test touch-mapper/dist/cp-to-s3.sh

# Install into prod only through AMI launch
