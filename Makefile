.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help.
	@grep -E '^[0-9a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	 sort | \
	 awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'

.PHONY: test test-packing test-commitment test-streaktracker build build-packing build-commitment build-streaktracker prepare-site clean

test: test-packing test-commitment test-streaktracker ## Run all tests across projects.

test-packing:
	$(MAKE) -C packing test

test-commitment:
	$(MAKE) -C Commitment test

test-streaktracker:
	$(MAKE) -C StreakTracker test

build: clean build-packing build-commitment build-streaktracker prepare-site ## Build all projects and assemble site/ artifacts (no tests).

build-packing:
	$(MAKE) -C packing build

build-commitment:
	cd Commitment && npm run build

build-streaktracker:
	cd StreakTracker && npm run build

prepare-site:
	mkdir -p site/Commitment site/StreakTracker site/Counter
	cp Counter/* site/Counter
	cp Commitment/index.html site/Commitment/
	cp -r Commitment/dist site/Commitment/
	cp StreakTracker/index.html site/StreakTracker/
	cp -r StreakTracker/dist site/StreakTracker/
	cp index.html site/index.html

clean: ## Remove built site artifacts.
	rm -rf site

server: ## Serves the output directory
	cd site && python3 -m http.server
