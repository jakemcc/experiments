# StreakTracker Flaky Test Investigation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Run the StreakTracker test suite up to 20 times, capture any intermittent failures, and only implement fixes after a root-cause investigation with a regression test.

**Architecture:** Use a deterministic test loop to detect flakiness. If a failure appears, switch to systematic-debugging to identify root cause, then apply TDD to add a regression test and minimal fix. If no failures appear in 20 runs, report clean run evidence.

**Tech Stack:** TypeScript, Jest (jsdom), IndexedDB (fake-indexeddb), npm scripts.

---

### Task 1: Run the test suite up to 20 times and capture failures

**Files:**
- None

**Step 1: Run the looped test command**

Run:

```bash
for i in $(seq 1 20); do
  echo "Run $i/20"
  npm test || break
  echo ""
done
```

Expected: Either all 20 runs pass, or the loop stops on the first failure with full Jest output visible.

**Step 2: Record evidence**

If a failure occurs, copy the full failure output and note:
- Test name
- Error message
- Stack trace
- Run number

If all runs pass, note "20/20 passes" with the command output snippet.

**Step 3: Commit (no-op)**

No commit in this task.

### Task 2: If a failure occurs, complete systematic debugging (no code changes yet)

**Files:**
- None

**Step 1: Reproduce**

Re-run the same test (or narrow it with `-t`) until it fails reliably or the pattern is understood.

**Step 2: Root cause investigation**

Follow @systematic-debugging Phase 1-3:
- Read the full error and stack trace
- Identify any recent changes or timing/data dependencies
- Compare to similar passing tests
- Form a single hypothesis
- Test the hypothesis with the smallest possible change

**Step 3: Commit (no-op)**

No commit in this task.

### Task 3: If a root cause is identified, add regression test and fix via TDD

**Files:**
- Modify: `StreakTracker/src/main.test.ts`
- Modify: `StreakTracker/src/main.ts`

**Step 1: Write the failing test**

Add a minimal regression test for the identified failure in `StreakTracker/src/main.test.ts`.

**Step 2: Run test to verify it fails**

Run: `npm test -- src/main.test.ts -t "<new test name>"`
Expected: FAIL due to the original bug.

**Step 3: Write minimal implementation**

Apply the smallest change in `StreakTracker/src/main.ts` that fixes the root cause.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/main.test.ts -t "<new test name>"`
Expected: PASS

**Step 5: Commit**

```bash
git add StreakTracker/src/main.test.ts StreakTracker/src/main.ts
git commit -m "fix: address flaky test root cause"
```

### Task 4: Verify full suite after fixes

**Files:**
- None

**Step 1: Run full suite**

Run: `npm test`
Expected: PASS

**Step 2: Commit (no-op)**

No commit in this task.
