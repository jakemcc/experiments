.PHONY: test test-packing test-commitment test-streaktracker build build-packing build-commitment build-streaktracker prepare-site clean

test: test-packing test-commitment test-streaktracker

test-packing:
	$(MAKE) -C packing test

test-commitment:
	$(MAKE) -C Commitment test

test-streaktracker:
	$(MAKE) -C StreakTracker test

build: clean build-packing build-commitment build-streaktracker prepare-site

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

clean:
	rm -rf site
