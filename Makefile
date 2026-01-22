.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help.
	@grep -E '^[0-9a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	 sort | \
	 awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

.PHONY: test test-packing test-streaktracker build build-packing build-streaktracker prepare-site clean

test: test-packing test-streaktracker ## Run all tests across projects.

test-packing:
	$(MAKE) -C packing test

test-streaktracker:
	$(MAKE) -C StreakTracker test

build: clean build-packing build-streaktracker prepare-site ## Build all projects and assemble site/ artifacts (no tests).

build-packing:
	$(MAKE) -C packing build

build-streaktracker:
	cd StreakTracker && npm run build

prepare-site:
	mkdir -p site/StreakTracker site/Counter site/99-bottles
	cp Counter/* site/Counter
	cp StreakTracker/index.html site/StreakTracker/
	cp -r StreakTracker/dist site/StreakTracker/
	cp 99-bottles/index.html 99-bottles/state.js site/99-bottles/
	cp index.html site/index.html

clean: ## Remove built site artifacts.
	rm -rf site

server: ## Serves the output directory
	cd site && python3 -m http.server

.PHONY: watch dev

WATCHER ?= watchexec

watch: ## Watch sources and rerun `make test build` on changes (requires watchexec).
	@command -v $(WATCHER) >/dev/null 2>&1 || { \
		echo "Error: '$(WATCHER)' not found. Install watchexec: https://watchexec.github.io/"; \
		exit 1; \
	}
	$(WATCHER) --clear --restart \
		--ignore 'site' \
		--ignore '**/dist' \
		--ignore '**/node_modules' \
		--ignore '.git' \
		--watch StreakTracker \
		--watch packing \
		--watch Counter \
		--watch 99-bottles \
		--watch index.html \
		--watch Makefile \
		-- "make test build"

dev: ## Run initial test/build, then watch and serve site/.
	$(MAKE) test build
	$(MAKE) -j2 server watch
