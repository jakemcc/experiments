.PHONY: test test-packing test-commitment test-streaktracker

test: test-packing test-commitment test-streaktracker

test-packing:
	$(MAKE) -C packing test

test-commitment:
	$(MAKE) -C Commitment test

test-streaktracker:
	$(MAKE) -C StreakTracker test
