
build: node_modules
	./pre2src.py
	rm -rf build
	node build.js
	./create-env-js.sh >build/scripts/environment.js

node_modules: package.json
	npm install

serve:
	node_modules/.bin/http-server -c-1 -p 9000 -a 127.0.0.1 build

watch:
	make build
	while true; do inotifywait -q -e close_write,moved_to,create build.js pre-src pre-src/* src/*.html src/styles/* src/scripts/* locales locales/*; echo doing; make build; done

.PHONY: build
