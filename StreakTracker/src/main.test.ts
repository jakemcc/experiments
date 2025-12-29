import {
  DAY_STATES,
  DayState,
  STREAK_TYPES,
  cycleColorState,
  migrateStreakTypes,
  generateCalendar,
  setup,
  clearAllStoredDaysForTests,
  updateCountValue,
} from './main';

async function flushAsyncOperations() {
  await Promise.resolve();
  const usingFakeTimers =
    typeof jest !== 'undefined' &&
    typeof jest.isMockFunction === 'function' &&
    jest.isMockFunction(setTimeout as unknown as jest.Mock);
  if (usingFakeTimers && typeof jest.runOnlyPendingTimers === 'function') {
    try {
      jest.runOnlyPendingTimers();
    } catch {
      // Timers are not mocked; ignore.
    }
  }
  await new Promise((resolve) => {
    if (typeof setImmediate === 'function') {
      setImmediate(resolve);
    } else {
      setTimeout(resolve, 0);
    }
  });
}

async function waitForCondition(condition: () => boolean, maxAttempts = 20) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (condition()) {
      return;
    }
    await flushAsyncOperations();
  }
  throw new Error('Condition not met within allotted attempts');
}

function mockDate(dateString: string): () => void {
  const RealDate = Date;
  const fixedTime = new RealDate(dateString).getTime();
  class MockDate extends Date {
    constructor(...args: ConstructorParameters<typeof Date>) {
      if (args.length > 0) {
        super(...args);
      } else {
        super(fixedTime);
      }
    }
    static now() {
      return fixedTime;
    }
    static parse = RealDate.parse;
    static UTC = RealDate.UTC;
  }
  globalThis.Date = MockDate as unknown as DateConstructor;
  return () => {
    globalThis.Date = RealDate;
  };
}

function getDayCell(day: string): HTMLElement {
  const cell = Array.from(document.querySelectorAll('.day')).find(
    (c) => (c as HTMLElement).dataset.day === day || c.textContent === day,
  ) as HTMLElement | undefined;
  if (!cell) {
    throw new Error(`Unable to find day cell ${day}`);
  }
  return cell;
}

async function readStoredStreakTypes(): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('streak-tracker', 2);
    request.onerror = () => reject(request.error ?? new Error('open failed'));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('streaks', 'readonly');
      const store = tx.objectStore('streaks');
      const getRequest = store.get('types');
      getRequest.onerror = () => reject(getRequest.error ?? new Error('read failed'));
      getRequest.onsuccess = () => {
        const result = getRequest.result;
        db.close();
        resolve(new Map(Array.isArray(result) ? result : []));
      };
    };
  });
}

async function readStoredStreakSettings(): Promise<Map<string, Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('streak-tracker', 2);
    request.onerror = () => reject(request.error ?? new Error('open failed'));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('streaks', 'readonly');
      const store = tx.objectStore('streaks');
      const getRequest = store.get('settings');
      getRequest.onerror = () => reject(getRequest.error ?? new Error('read failed'));
      getRequest.onsuccess = () => {
        const result = getRequest.result;
        db.close();
        resolve(new Map(Array.isArray(result) ? result : []));
      };
    };
  });
}

beforeEach(async () => {
  document.body.innerHTML = '';
  localStorage.clear();
  await clearAllStoredDaysForTests();
  if (typeof window !== 'undefined') {
    window.location.hash = '';
  }
});

test('generateCalendar has 42 cells and correct day count', () => {
  const cells = generateCalendar(2023, 0); // January 2023
  expect(cells.length).toBe(42);
  expect(cells.filter((d) => d !== null).length).toBe(31);
});

test('cycleColorState advances through the color cycle', () => {
  let state: DayState = DAY_STATES.None;
  state = cycleColorState(state);
  expect(state).toBe(DAY_STATES.Red);
  state = cycleColorState(state);
  expect(state).toBe(DAY_STATES.Green);
  state = cycleColorState(state);
  expect(state).toBe(DAY_STATES.Blue);
  state = cycleColorState(state);
  expect(state).toBe(DAY_STATES.None);
});

test('updateCountValue clamps at zero and increments correctly', () => {
  expect(updateCountValue(0, -1)).toBe(0);
  expect(updateCountValue(1, -1)).toBe(0);
  expect(updateCountValue(2, -1)).toBe(1);
  expect(updateCountValue(0, 1)).toBe(1);
  expect(updateCountValue(4, 3)).toBe(7);
});

test('migrateStreakTypes defaults to color and is idempotent', () => {
  const stored = new Map<string, 'color' | 'count'>();
  const first = migrateStreakTypes(stored, ['Work', 'Exercise']);
  expect(first.didChange).toBe(true);
  expect(first.types.get('Work')).toBe(STREAK_TYPES.Color);
  expect(first.types.get('Exercise')).toBe(STREAK_TYPES.Color);

  const second = migrateStreakTypes(first.types, ['Work', 'Exercise']);
  expect(second.didChange).toBe(false);
  expect(second.types.get('Work')).toBe(STREAK_TYPES.Color);
});

test('clicking a day saves and restores its state', async () => {
  document.body.innerHTML = '<div id="calendars"></div>';
  await setup();
  const cell = getDayCell('1');
  cell.dispatchEvent(new Event('click'));
  await flushAsyncOperations();
  document.body.innerHTML = '<div id="calendars"></div>';
  await setup();
  const cell2 = getDayCell('1');
  expect(cell2.classList.contains('red')).toBe(true);
});

test('third click sets day to blue and persists state', async () => {
  document.body.innerHTML = '<div id="calendars"></div>';
  await setup();
  const cell = getDayCell('1');
  cell.click();
  cell.click();
  cell.click();
  await flushAsyncOperations();
  document.body.innerHTML = '<div id="calendars"></div>';
  await setup();
  const cell2 = getDayCell('1');
  expect(cell2.classList.contains('blue')).toBe(true);
});

test('streak selection uses URL hash and keeps calendars separate', async () => {
  window.location.hash = '#Work';
  document.body.innerHTML = '<div id="calendars"></div>';
  await setup();

  const workCell = getDayCell('1');
  workCell.click();
  await flushAsyncOperations();
  expect(window.location.hash).toBe('#Work');

  const myStreakButton = Array.from(document.querySelectorAll('.streak-pill')).find(
    (el) => el.textContent === 'My Streak'
  ) as HTMLButtonElement;
  myStreakButton.click();
  await flushAsyncOperations();

  const defaultCell = getDayCell('1');
  expect(defaultCell.classList.contains('red')).toBe(false);
  defaultCell.click();
  await flushAsyncOperations();

  const workButton = Array.from(document.querySelectorAll('.streak-pill')).find(
    (el) => el.textContent === 'Work'
  ) as HTMLButtonElement;
  workButton.click();
  await flushAsyncOperations();

  const workCellAgain = getDayCell('1');
  expect(workCellAgain.classList.contains('red')).toBe(true);
});

test('renaming a streak keeps its data and updates selection', async () => {
  const promptSpy = jest.spyOn(window, 'prompt').mockReturnValue('Renamed');
  try {
    document.body.innerHTML = '<div id="calendars"></div>';
    await setup();
    const firstCell = getDayCell('1');
    firstCell.click();
    await flushAsyncOperations();

    const renameButton = document.querySelector('.streak-rename') as HTMLButtonElement;
    renameButton.click();
    await flushAsyncOperations();

    await waitForCondition(() => {
      const active = document.querySelector('.streak-pill[aria-pressed="true"]') as
        | HTMLButtonElement
        | null;
      return active?.textContent === 'Renamed';
    });
    expect(window.location.hash).toBe('#Renamed');

    document.body.innerHTML = '<div id="calendars"></div>';
    await setup();
    const renamedCell = getDayCell('1');
    expect(renamedCell.classList.contains('red')).toBe(true);
  } finally {
    promptSpy.mockRestore();
  }
});

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
    await waitForCondition(() =>
      Array.from(document.querySelectorAll('.streak-pill')).some((el) => el.textContent === 'Work')
    );
    addButton.click();
    await waitForCondition(() =>
      Array.from(document.querySelectorAll('.streak-pill')).some((el) => el.textContent === 'Home')
    );

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

test('color settings rename labels and show swatches in stats', async () => {
  document.body.innerHTML = '<div id="calendars"></div>';
  await setup();

  const settingsButton = document.querySelector('.streak-settings') as HTMLButtonElement;
  settingsButton.click();
  await flushAsyncOperations();

  const greenInput = document.getElementById('streak-color-label-green') as HTMLInputElement;
  const redInput = document.getElementById('streak-color-label-red') as HTMLInputElement;
  const blueInput = document.getElementById('streak-color-label-blue') as HTMLInputElement;

  greenInput.value = 'Emerald';
  redInput.value = 'Ruby';
  blueInput.value = 'Azure';

  const saveButton = document.querySelector('.streak-settings__save') as HTMLButtonElement;
  saveButton.click();
  await flushAsyncOperations();

  await waitForCondition(() => {
    const stats = document.querySelector('.stats') as HTMLElement | null;
    const text = stats?.textContent ?? '';
    return (
      text.includes('Emerald days') &&
      text.includes('Ruby days') &&
      text.includes('Azure days') &&
      text.includes('Longest Emerald or Azure streak')
    );
  });

  const stats = document.querySelector('.stats') as HTMLElement;
  expect(stats.textContent).toContain('Emerald days');
  expect(stats.textContent).toContain('Ruby days');
  expect(stats.textContent).toContain('Azure days');
  expect(stats.textContent).toContain('Longest Emerald or Azure streak');

  expect(document.querySelectorAll('.stats-swatch--green').length).toBe(1);
  expect(document.querySelectorAll('.stats-swatch--red').length).toBe(1);
  expect(document.querySelectorAll('.stats-swatch--blue').length).toBe(1);
});

test('settings button uses a gear icon', async () => {
  document.body.innerHTML = '<div id="calendars"></div>';
  await setup();

  const settingsButton = document.querySelector('.streak-settings') as HTMLButtonElement;
  expect(settingsButton.textContent).toBe('\u2699');
});

test('when default streak is missing it selects the most recently updated streak', async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('streak-tracker', 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('dayStates')) {
        db.createObjectStore('dayStates');
      }
      if (!db.objectStoreNames.contains('streaks')) {
        db.createObjectStore('streaks');
      }
    };
    request.onerror = () => reject(request.error ?? new Error('open failed'));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['dayStates', 'streaks'], 'readwrite');
      const dayStore = tx.objectStore('dayStates');
      dayStore.put(1, `${encodeURIComponent('Focus')}::2024-2-1`);
      dayStore.put(1, `${encodeURIComponent('Side')}::2024-3-1`);
      const streakStore = tx.objectStore('streaks');
      streakStore.put(['Focus', 'Side'], 'names');
      streakStore.put(
        [
          ['Focus', 1],
          ['Side', 2],
        ],
        'lastUpdated',
      );
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => reject(tx.error ?? new Error('write aborted'));
      tx.onerror = () => reject(tx.error ?? new Error('write failed'));
    };
  });

  document.body.innerHTML = '<div id="calendars"></div>';
  window.location.hash = '';
  await setup();

  const pills = Array.from(document.querySelectorAll('.streak-pill')) as HTMLButtonElement[];
  const options = pills.map((pill) => pill.textContent);
  expect(options).toContain('Side');
  expect(options).toContain('Focus');
  expect(options).not.toContain('My Streak');
  const active = pills.find((pill) => pill.getAttribute('aria-pressed') === 'true');
  expect(active?.textContent).toBe('Side');
});

test('creating a streak uses a prompt and selects the new streak', async () => {
  const promptSpy = jest
    .spyOn(window, 'prompt')
    .mockImplementationOnce(() => 'New Streak')
    .mockImplementationOnce(() => 'Count');
  try {
    document.body.innerHTML = '<div id="calendars"></div>';
    await setup();

    const addButton = document.querySelector('.streak-add__button') as HTMLButtonElement;
    addButton.click();
    await flushAsyncOperations();

    await waitForCondition(() => {
      const active = document.querySelector('.streak-pill[aria-pressed="true"]') as
        | HTMLButtonElement
        | null;
      return active?.textContent === 'New Streak';
    });
    const pills = Array.from(document.querySelectorAll('.streak-pill')).map(
      (pill) => (pill as HTMLButtonElement).textContent
    );
    expect(pills).toContain('New Streak');
    expect(window.location.hash).toBe('#New%20Streak');
    const types = await readStoredStreakTypes();
    expect(types.get('New Streak')).toBe('count');
  } finally {
    promptSpy.mockRestore();
  }
});

test('creating a streak requires a valid type selection', async () => {
  const promptSpy = jest
    .spyOn(window, 'prompt')
    .mockImplementationOnce(() => 'Invalid Type Streak')
    .mockImplementationOnce(() => 'Not A Type');
  const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
  try {
    document.body.innerHTML = '<div id="calendars"></div>';
    await setup();

    const addButton = document.querySelector('.streak-add__button') as HTMLButtonElement;
    addButton.click();
    await flushAsyncOperations();

    expect(alertSpy).toHaveBeenCalled();
    const pills = Array.from(document.querySelectorAll('.streak-pill')).map(
      (pill) => (pill as HTMLButtonElement).textContent
    );
    expect(pills).not.toContain('Invalid Type Streak');
  } finally {
    promptSpy.mockRestore();
    alertSpy.mockRestore();
  }
});

test('deleting a streak removes its data and selects a remaining streak', async () => {
  const promptSpy = jest
    .spyOn(window, 'prompt')
    .mockImplementationOnce(() => 'Work')
    .mockImplementationOnce(() => 'Colors');
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  try {
    document.body.innerHTML = '<div id="calendars"></div>';
    await setup();

    const addButton = document.querySelector('.streak-add__button') as HTMLButtonElement;
    addButton.click();
    await flushAsyncOperations();

    const workButton = await (async () => {
      await waitForCondition(() =>
        Array.from(document.querySelectorAll('.streak-pill')).some((el) => el.textContent === 'Work')
      );
      return Array.from(document.querySelectorAll('.streak-pill')).find(
        (el) => el.textContent === 'Work'
      ) as HTMLButtonElement;
    })();
    workButton.click();
    await flushAsyncOperations();

    const workDayOne = getDayCell('1');
    workDayOne.click();
    await flushAsyncOperations();

    const deleteButton = document.querySelector('.streak-delete') as HTMLButtonElement;
    deleteButton.click();
    await flushAsyncOperations();

    await waitForCondition(() => {
      const pills = Array.from(document.querySelectorAll('.streak-pill')) as HTMLButtonElement[];
      return pills.every((pill) => pill.textContent !== 'Work');
    });
    const active = document.querySelector('.streak-pill[aria-pressed="true"]') as
      | HTMLButtonElement
      | null;
    expect(active?.textContent).toBe('My Streak');

    document.body.innerHTML = '<div id="calendars"></div>';
    await setup();
    const pillsAfter = Array.from(document.querySelectorAll('.streak-pill')).map(
      (pill) => (pill as HTMLButtonElement).textContent
    );
    expect(pillsAfter).not.toContain('Work');
    const dayOne = getDayCell('1');
    expect(dayOne.classList.contains('red')).toBe(false);
  } finally {
    promptSpy.mockRestore();
    confirmSpy.mockRestore();
  }
});

test('deleting the last streak resets to a fresh default streak', async () => {
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  try {
    document.body.innerHTML = '<div id="calendars"></div>';
    await setup();

    const dayOne = getDayCell('1');
    dayOne.click();
    await flushAsyncOperations();

    const deleteButton = document.querySelector('.streak-delete') as HTMLButtonElement;
    deleteButton.click();
    await flushAsyncOperations();

    await waitForCondition(() => {
      const active = document.querySelector('.streak-pill[aria-pressed="true"]') as
        | HTMLButtonElement
        | null;
      return active?.textContent === 'My Streak';
    });
    expect(window.location.hash).toBe('#My%20Streak');

    const pills = Array.from(document.querySelectorAll('.streak-pill')).map(
      (pill) => (pill as HTMLButtonElement).textContent
    );
    expect(pills).toEqual(['My Streak']);
    await waitForCondition(() => {
      const cell = getDayCell('1');
      return cell !== undefined && !cell.classList.contains('red');
    });
    const dayOneAfter = getDayCell('1');
    expect(dayOneAfter.classList.contains('red')).toBe(false);
  } finally {
    confirmSpy.mockRestore();
  }
});

test('legacy unscoped data is migrated into the default streak', async () => {
  const restoreDate = mockDate('2024-02-10T00:00:00Z');
  document.body.innerHTML = '<div id="calendars"></div>';

  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('streak-tracker', 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('dayStates')) {
        db.createObjectStore('dayStates');
      }
    };
    request.onerror = () => reject(request.error ?? new Error('open failed'));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('dayStates', 'readwrite');
      tx.objectStore('dayStates').put(2, '2024-2-1');
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error ?? new Error('write failed'));
    };
  });

  await setup();
  const cell = getDayCell('1');
  expect(cell.classList.contains('green')).toBe(true);
  restoreDate();
});

test('renders previous months below current month', async () => {
  document.body.innerHTML = '<div id="calendars"></div>';
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const key = `${prev.getFullYear()}-${prev.getMonth() + 1}-1`;
  localStorage.setItem(key, '1');
  await setup();
  const headings = Array.from(document.querySelectorAll('h1')).map(
    (h) => h.textContent
  );
  const currentLabel = new Date(
    now.getFullYear(),
    now.getMonth(),
    1
  ).toLocaleString('default', { month: 'long', year: 'numeric' });
  const prevLabel = new Date(
    prev.getFullYear(),
    prev.getMonth(),
    1
  ).toLocaleString('default', { month: 'long', year: 'numeric' });
  expect(headings[0]).toBe(currentLabel);
  expect(headings[1]).toBe(prevLabel);
});

test('stats update for all colors and streaks', async () => {
  const restoreDate = mockDate('2023-06-15T00:00:00Z');
  document.body.innerHTML = '<div id="calendars"></div>';
  await setup();
  const stats = document.querySelector('.stats') as HTMLElement;
  const daysPassed = new Date().getDate();
  const getStatLines = () =>
    Array.from(stats.querySelectorAll('.stats-line')).map((line) => line.textContent ?? '');
  const expectStats = async (lines: string[]) => {
    await waitForCondition(() => {
      const rendered = getStatLines();
      return rendered.length === lines.length && rendered.every((line, idx) => line === lines[idx]);
    });
    expect(getStatLines()).toEqual(lines);
  };
  await expectStats([
    `Red days: 0/${daysPassed}, Longest Red streak: 0`,
    `Green days: 0/${daysPassed}, Longest Green streak: 0`,
    `Blue days: 0/${daysPassed}, Longest Blue streak: 0`,
    'Longest Green or Blue streak: 0',
  ]);
  const day1 = getDayCell('1');
  day1.click();
  await flushAsyncOperations();
  await expectStats([
    `Red days: 1/${daysPassed}, Longest Red streak: 1`,
    `Green days: 0/${daysPassed}, Longest Green streak: 0`,
    `Blue days: 0/${daysPassed}, Longest Blue streak: 0`,
    'Longest Green or Blue streak: 0',
  ]);
  day1.click();
  await flushAsyncOperations();
  await expectStats([
    `Red days: 0/${daysPassed}, Longest Red streak: 0`,
    `Green days: 1/${daysPassed}, Longest Green streak: 1`,
    `Blue days: 0/${daysPassed}, Longest Blue streak: 0`,
    'Longest Green or Blue streak: 1',
  ]);
  day1.click();
  await flushAsyncOperations();
  await expectStats([
    `Red days: 0/${daysPassed}, Longest Red streak: 0`,
    `Green days: 0/${daysPassed}, Longest Green streak: 0`,
    `Blue days: 1/${daysPassed}, Longest Blue streak: 1`,
    'Longest Green or Blue streak: 1',
  ]);
  restoreDate();
});

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

test('longest green or blue streak spans both colors', async () => {
  const restoreDate = mockDate('2023-06-15T00:00:00Z');
  try {
    document.body.innerHTML = '<div id="calendars"></div>';
    await setup();
    const stats = document.querySelector('.stats') as HTMLElement;
    const daysPassed = new Date().getDate();
    const getState = (cell: HTMLElement) => {
      if (cell.classList.contains('red')) {
        return 1;
      }
      if (cell.classList.contains('green')) {
        return 2;
      }
      if (cell.classList.contains('blue')) {
        return 3;
      }
      return 0;
    };
    const setState = (cell: HTMLElement, state: number) => {
      for (let i = 0; i < 4; i++) {
        if (getState(cell) === state) {
          return;
        }
        cell.click();
      }
      throw new Error('Unable to reach desired state');
    };
    setState(getDayCell('1'), 2);
    await flushAsyncOperations();
    setState(getDayCell('2'), 2);
    await flushAsyncOperations();
    setState(getDayCell('3'), 3);
    await flushAsyncOperations();
    setState(getDayCell('4'), 2);
    await flushAsyncOperations();
    const expected = [
      `Red days: 0/${daysPassed}, Longest Red streak: 0`,
      `Green days: 3/${daysPassed}, Longest Green streak: 2`,
      `Blue days: 1/${daysPassed}, Longest Blue streak: 1`,
      'Longest Green or Blue streak: 4',
    ];
    const getStatLines = () =>
      Array.from(stats.querySelectorAll('.stats-line')).map((line) => line.textContent ?? '');
    await waitForCondition(() => {
      const rendered = getStatLines();
      return rendered.length === expected.length && rendered.every((line, idx) => line === expected[idx]);
    });
    expect(getStatLines()).toEqual(expected);
  } finally {
    restoreDate();
  }
});

test('migrates streaks without types to color', async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('streak-tracker', 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('dayStates')) {
        db.createObjectStore('dayStates');
      }
      if (!db.objectStoreNames.contains('streaks')) {
        db.createObjectStore('streaks');
      }
    };
    request.onerror = () => reject(request.error ?? new Error('open failed'));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['dayStates', 'streaks'], 'readwrite');
      tx.objectStore('dayStates').put(1, `${encodeURIComponent('Work')}::2024-2-1`);
      tx.objectStore('streaks').put(['Work'], 'names');
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error ?? new Error('write failed'));
    };
  });

  document.body.innerHTML = '<div id="calendars"></div>';
  await setup();
  const types = await readStoredStreakTypes();
  expect(types.get('Work')).toBe('color');
});

test('count streak increments and clamps at zero', async () => {
  const restoreDate = mockDate('2024-02-10T00:00:00Z');
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

    const dayCell = getDayCell('1');
    const increment = dayCell.querySelector('.day-count__control--plus') as HTMLButtonElement;
    const decrement = dayCell.querySelector('.day-count__control--minus') as HTMLButtonElement;
    const value = dayCell.querySelector('.day-count__value') as HTMLElement;

    increment.click();
    await flushAsyncOperations();
    expect(value.textContent).toBe('1');
    increment.click();
    await flushAsyncOperations();
    expect(value.textContent).toBe('2');

    await new Promise<void>((resolve, reject) => {
      const now = new Date();
      const request = indexedDB.open('streak-tracker', 2);
      request.onerror = () => reject(request.error ?? new Error('open failed'));
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('dayStates', 'readonly');
        const store = tx.objectStore('dayStates');
        const getRequest = store.get(
          `${encodeURIComponent('Counts')}::${now.getFullYear()}-${now.getMonth() + 1}-1`,
        );
        getRequest.onerror = () => reject(getRequest.error ?? new Error('read failed'));
        getRequest.onsuccess = () => {
          expect(getRequest.result).toBe(2);
          db.close();
          resolve();
        };
      };
    });

    decrement.click();
    await flushAsyncOperations();
    expect(value.textContent).toBe('1');
    decrement.click();
    await flushAsyncOperations();
    expect(value.textContent).toBe('');
    decrement.click();
    await flushAsyncOperations();
    expect(value.textContent).toBe('');

    await new Promise<void>((resolve, reject) => {
      const now = new Date();
      const request = indexedDB.open('streak-tracker', 2);
      request.onerror = () => reject(request.error ?? new Error('open failed'));
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('dayStates', 'readonly');
        const store = tx.objectStore('dayStates');
        const getRequest = store.get(
          `${encodeURIComponent('Counts')}::${now.getFullYear()}-${now.getMonth() + 1}-1`,
        );
        getRequest.onerror = () => reject(getRequest.error ?? new Error('read failed'));
        getRequest.onsuccess = () => {
          expect(getRequest.result).toBeUndefined();
          db.close();
          resolve();
        };
      };
    });
  } finally {
    promptSpy.mockRestore();
    restoreDate();
  }
});

test('count streak stats include zeros from first recorded day', async () => {
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

    const dayTwo = getDayCell('2');
    const dayFour = getDayCell('4');
    const dayTwoIncrement = dayTwo.querySelector(
      '.day-count__control--plus',
    ) as HTMLButtonElement;
    const dayFourIncrement = dayFour.querySelector(
      '.day-count__control--plus',
    ) as HTMLButtonElement;

    dayTwoIncrement.click();
    await flushAsyncOperations();
    dayTwoIncrement.click();
    await flushAsyncOperations();

    for (let i = 0; i < 4; i += 1) {
      dayFourIncrement.click();
      await flushAsyncOperations();
    }

    const stats = Array.from(document.querySelectorAll('.stats')).find(
      (element) => !(element as HTMLElement).classList.contains('stats--overall')
    ) as HTMLParagraphElement;
    const overallStats = document.querySelector('.stats--overall') as HTMLParagraphElement;
    const expectedStats = 'Total: 6 Median: 1 Mean: 1.50';
    const expectedOverall = 'Median: 1 Mean: 1.50';

    await waitForCondition(
      () => stats.textContent === expectedStats && overallStats.textContent === expectedOverall,
      60,
    );
    expect(stats.textContent).toBe(expectedStats);
    expect(overallStats.textContent).toBe(expectedOverall);
  } finally {
    promptSpy.mockRestore();
    restoreDate();
  }
});

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

test('count streak settings persist and update the zero start option', async () => {
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

    const settingsButton = document.querySelector('.streak-settings') as HTMLButtonElement;
    settingsButton.click();
    await flushAsyncOperations();

    const todayOption = document.querySelector(
      'input[name="count-zero-start"][value="today"]',
    ) as HTMLInputElement | null;
    expect(todayOption).toBeNull();

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

    const settings = await readStoredStreakSettings();
    expect(settings.get('Counts')).toEqual({
      countZeroStartMode: 'custom',
      countZeroStartDate: '2024-02-03',
    });
  } finally {
    promptSpy.mockRestore();
    restoreDate();
  }
});

test('color streak settings hide count-only options', async () => {
  document.body.innerHTML = '<div id="calendars"></div>';
  await setup();
  const settingsButton = document.querySelector('.streak-settings') as HTMLButtonElement;
  settingsButton.click();
  await flushAsyncOperations();

  const countOptions = document.querySelectorAll('input[name="count-zero-start"]');
  expect(countOptions.length).toBe(0);
});
