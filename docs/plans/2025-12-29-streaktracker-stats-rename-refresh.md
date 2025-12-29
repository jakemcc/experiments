# StreakTracker Stats + Rename Guard + Refresh Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Count streak stats start from a chosen date (inclusive), renames cannot collide with existing streaks, and the UI refreshes date-dependent rendering on focus/visibility changes.

**Architecture:** Keep existing IndexedDB schema and settings. Adjust count stat range building to exclude pre-start values while inserting zeros from the start date. Add a rename guard at the UI entry point. Add a single refresh callback wired to focus/visibility events that reuses existing render functions.

**Tech Stack:** TypeScript, Jest (jsdom), IndexedDB (fake-indexeddb in tests).

---

### Task 1: Count stats start from custom date

**Files:**
- Modify: `StreakTracker/src/main.test.ts`
- Modify: `StreakTracker/src/main.ts`

**Step 1: Write the failing test**

Add this test near the other count streak tests:

```typescript
test('count streak stats start from custom date', async () => {
  const restoreDate = mockDate('2024-02-05T12:00:00');
  const promptSpy = jest
    .spyOn(window, 'prompt')
    .mockImplementationOnce(() => 'Counts')
    .mockImplementationOnce(() => 'Count');
  try {
    document.body.innerHTML = '<div id="calendars"></div>';
    await setup();

    const addButton = document.querySelector('.streak-add__button') as HTMLButtonElement;
    addButton.click();
    await flushAsyncOperations();

    const countPill = await (async () => {
      await waitForCondition(() =>
        Array.from(document.querySelectorAll('.streak-pill')).some(
          (el) => el.textContent === 'Counts'
        )
      );
      return Array.from(document.querySelectorAll('.streak-pill')).find(
        (el) => el.textContent === 'Counts'
      ) as HTMLButtonElement;
    })();
    countPill.click();
    await flushAsyncOperations();

    const dayOne = getDayCell('1');
    const dayThree = getDayCell('3');
    const dayFive = getDayCell('5');
    const incDayOne = dayOne.querySelector('.day-count__control--plus') as HTMLButtonElement;
    const incDayThree = dayThree.querySelector('.day-count__control--plus') as HTMLButtonElement;
    const incDayFive = dayFive.querySelector('.day-count__control--plus') as HTMLButtonElement;

    incDayOne.click();
    await flushAsyncOperations();
    incDayOne.click();
    await flushAsyncOperations();

    incDayThree.click();
    await flushAsyncOperations();

    for (let i = 0; i < 3; i += 1) {
      incDayFive.click();
      await flushAsyncOperations();
    }

    const settingsButton = document.querySelector('.streak-settings') as HTMLButtonElement;
    settingsButton.click();
    await flushAsyncOperations();

    const customOption = document.querySelector(
      'input[name="count-zero-start"][value="custom"]',
    ) as HTMLInputElement;
    customOption.click();
    await flushAsyncOperations();

    const customDate = document.querySelector(
      '#streak-settings-modal .streak-settings__date',
    ) as HTMLInputElement;
    customDate.value = '2024-02-03';
    customDate.dispatchEvent(new Event('input'));
    await flushAsyncOperations();

    const saveButton = document.querySelector(
      '#streak-settings-modal .streak-settings__save',
    ) as HTMLButtonElement;
    saveButton.click();
    await flushAsyncOperations();

    const stats = Array.from(document.querySelectorAll('.stats')).find(
      (element) => !(element as HTMLElement).classList.contains('stats--overall')
    ) as HTMLParagraphElement;
    const overallStats = document.querySelector('.stats--overall') as HTMLParagraphElement;

    const expectedStats = 'Total: 4 Median: 1 Mean: 1.33';
    const expectedOverall = 'Median: 1 Mean: 1.33';

    await waitForCondition(
      () => stats.textContent === expectedStats && overallStats.textContent === expectedOverall,
    );
    expect(stats.textContent).toBe(expectedStats);
    expect(overallStats.textContent).toBe(expectedOverall);
  } finally {
    promptSpy.mockRestore();
    restoreDate();
  }
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/main.test.ts -t "count streak stats start from custom date"`
Expected: FAIL because the total/mean still include pre-start values.

**Step 3: Write minimal implementation**

Update count range calculations to exclude pre-start values and include zeros from the chosen start date forward.

```typescript
function buildCountValuesFromStart(
  stateMap: Map<string, DayValue>,
  startDateKey: string | null,
  now: Date,
): number[] {
  if (!startDateKey) {
    return [];
  }
  const startTime = dateKeyToTime(startDateKey);
  if (startTime === null) {
    return [];
  }
  const values: number[] = [];
  const rangeStart = new Date(startTime);
  const rangeEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (
    let cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
    cursor <= rangeEnd;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    const dateKey = buildDateKeyFromDate(cursor);
    const value = stateMap.get(dateKey);
    values.push(value && value > 0 ? Math.floor(value) : 0);
  }
  return values;
}

function buildCountValuesForMonth(
  stateMap: Map<string, DayValue>,
  year: number,
  month: number,
  now: Date,
  startDateKey: string | null,
): number[] {
  const values: number[] = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  let daysPassed = 0;
  if (year === now.getFullYear() && month === now.getMonth() + 1) {
    daysPassed = now.getDate();
  } else if (
    year < now.getFullYear() ||
    (year === now.getFullYear() && month < now.getMonth() + 1)
  ) {
    daysPassed = daysInMonth;
  }

  const startTime = startDateKey ? dateKeyToTime(startDateKey) : null;
  if (startTime === null) {
    return values;
  }
  for (let day = 1; day <= daysPassed; day += 1) {
    const dateKey = `${year}-${month}-${day}`;
    const value = stateMap.get(dateKey);
    const dayTime = dateKeyToTime(dateKey);
    if (dayTime !== null && dayTime >= startTime) {
      values.push(value && value > 0 ? Math.floor(value) : 0);
    }
  }

  return values;
}

function buildCountValuesForOverall(
  stateMap: Map<string, DayValue>,
  startDateKey: string | null,
  now: Date,
): number[] {
  return buildCountValuesFromStart(stateMap, startDateKey, now);
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/main.test.ts -t "count streak stats start from custom date"`
Expected: PASS

**Step 5: Commit**

```bash
git add StreakTracker/src/main.ts StreakTracker/src/main.test.ts
git commit -m "feat: start count stats from custom date"
```

### Task 2: Update count settings label to "Start from date"

**Files:**
- Modify: `StreakTracker/src/main.test.ts`
- Modify: `StreakTracker/src/main.ts`

**Step 1: Write the failing test**

```typescript
test('count settings use the start from date label', async () => {
  const promptSpy = jest
    .spyOn(window, 'prompt')
    .mockImplementationOnce(() => 'Counts')
    .mockImplementationOnce(() => 'Count');
  try {
    document.body.innerHTML = '<div id="calendars"></div>';
    await setup();

    const addButton = document.querySelector('.streak-add__button') as HTMLButtonElement;
    addButton.click();
    await flushAsyncOperations();

    const countPill = await (async () => {
      await waitForCondition(() =>
        Array.from(document.querySelectorAll('.streak-pill')).some(
          (el) => el.textContent === 'Counts'
        )
      );
      return Array.from(document.querySelectorAll('.streak-pill')).find(
        (el) => el.textContent === 'Counts'
      ) as HTMLButtonElement;
    })();
    countPill.click();
    await flushAsyncOperations();

    const settingsButton = document.querySelector('.streak-settings') as HTMLButtonElement;
    settingsButton.click();
    await flushAsyncOperations();

    const legend = document.querySelector('#streak-settings-modal legend') as HTMLElement;
    expect(legend.textContent).toBe('Start from date');
  } finally {
    promptSpy.mockRestore();
  }
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/main.test.ts -t "count settings use the start from date label"`
Expected: FAIL because the legend still reads "Include zeros from".

**Step 3: Write minimal implementation**

```typescript
legend.textContent = 'Start from date';
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/main.test.ts -t "count settings use the start from date label"`
Expected: PASS

**Step 5: Commit**

```bash
git add StreakTracker/src/main.ts StreakTracker/src/main.test.ts
git commit -m "feat: rename count settings label"
```

### Task 3: Block rename to an existing streak name

**Files:**
- Modify: `StreakTracker/src/main.test.ts`
- Modify: `StreakTracker/src/main.ts`

**Step 1: Write the failing test**

```typescript
test('renaming to an existing streak name is blocked', async () => {
  const promptSpy = jest
    .spyOn(window, 'prompt')
    .mockImplementationOnce(() => 'Work')
    .mockImplementationOnce(() => 'Colors')
    .mockImplementationOnce(() => 'Home')
    .mockImplementationOnce(() => 'Colors')
    .mockImplementationOnce(() => 'Home');
  const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
  try {
    document.body.innerHTML = '<div id="calendars"></div>';
    await setup();

    const addButton = document.querySelector('.streak-add__button') as HTMLButtonElement;
    addButton.click();
    await flushAsyncOperations();
    addButton.click();
    await flushAsyncOperations();

    const workPill = Array.from(document.querySelectorAll('.streak-pill')).find(
      (el) => el.textContent === 'Work'
    ) as HTMLButtonElement;
    workPill.click();
    await flushAsyncOperations();

    const renameButton = document.querySelector('.streak-rename') as HTMLButtonElement;
    renameButton.click();
    await flushAsyncOperations();

    expect(alertSpy).toHaveBeenCalled();
    const pills = Array.from(document.querySelectorAll('.streak-pill')).map(
      (pill) => (pill as HTMLButtonElement).textContent
    );
    expect(pills).toContain('Work');
    expect(pills).toContain('Home');

    const active = document.querySelector('.streak-pill[aria-pressed="true"]') as
      | HTMLButtonElement
      | null;
    expect(active?.textContent).toBe('Work');
    expect(window.location.hash).toBe('#Work');
  } finally {
    promptSpy.mockRestore();
    alertSpy.mockRestore();
  }
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/main.test.ts -t "renaming to an existing streak name is blocked"`
Expected: FAIL because rename merges and no alert is shown.

**Step 3: Write minimal implementation**

Add a guard before calling `renameStreak` in `setup`:

```typescript
const name = normalizeStreakName(trimmed);
if (name !== selectedStreak && streakNames.includes(name)) {
  alert('A streak with that name already exists.');
  return;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/main.test.ts -t "renaming to an existing streak name is blocked"`
Expected: PASS

**Step 5: Commit**

```bash
git add StreakTracker/src/main.ts StreakTracker/src/main.test.ts
git commit -m "feat: block rename collisions"
```

### Task 4: Refresh date-dependent UI on focus/visibility

**Files:**
- Modify: `StreakTracker/src/main.test.ts`
- Modify: `StreakTracker/src/main.ts`

**Step 1: Write the failing test**

```typescript
test('focus refresh updates date-dependent stats', async () => {
  const restoreDate = mockDate('2024-06-10T12:00:00Z');
  document.body.innerHTML = '<div id="calendars"></div>';
  await setup();

  const getStatsText = () => {
    const stats = document.querySelector('.stats') as HTMLElement | null;
    return stats?.textContent ?? '';
  };

  expect(getStatsText()).toContain('/10');

  restoreDate();
  const restoreNext = mockDate('2024-06-11T12:00:00Z');

  window.dispatchEvent(new Event('focus'));

  await waitForCondition(() => getStatsText().includes('/11'));
  expect(getStatsText()).toContain('/11');

  restoreNext();
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/main.test.ts -t "focus refresh updates date-dependent stats"`
Expected: FAIL because the UI does not re-render on focus.

**Step 3: Write minimal implementation**

Introduce a shared refresh handler that is updated each `setup` call and invoked on focus/visibility events.

```typescript
let refreshHandler: (() => void) | null = null;
let refreshHandlersBound = false;

function bindRefreshHandlers(): void {
  if (refreshHandlersBound || typeof window === 'undefined') {
    return;
  }
  window.addEventListener('focus', () => refreshHandler?.());
  document.addEventListener('visibilitychange', () => refreshHandler?.());
  refreshHandlersBound = true;
}
```

In `setup`, make `now` mutable and register the handler after `rerenderAll` exists:

```typescript
let now = new Date();
// ...
const rerenderAll = () => {
  renderCalendars(
    container,
    selectedStreak,
    now,
    db,
    streakStates,
    streakTypes,
    streakSettings,
    lastUpdated,
  );
  renderControls();
};

refreshHandler = () => {
  now = new Date();
  rerenderAll();
};
bindRefreshHandlers();
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/main.test.ts -t "focus refresh updates date-dependent stats"`
Expected: PASS

**Step 5: Commit**

```bash
git add StreakTracker/src/main.ts StreakTracker/src/main.test.ts
git commit -m "feat: refresh calendars on focus and visibility"
```

---

**Notes:** Use @test-driven-development for each task. Verify progress at the end with `npm test`. Before completion, follow @verification-before-completion.
