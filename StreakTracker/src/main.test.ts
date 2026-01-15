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
  persistDayValue,
} from './main';
import { readFileSync } from 'fs';
import { resolve } from 'path';

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

function mockDownloadCapture() {
  const createObjectURL = jest.fn((_: Blob | MediaSource) => 'blob:mock');
  const revokeObjectURL = jest.fn((_: string) => {});

  if (typeof URL.createObjectURL !== 'function') {
    Object.defineProperty(URL, 'createObjectURL', {
      value: () => 'blob:mock',
      writable: true,
    });
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: () => {},
      writable: true,
    });
  }

  const createObjectURLSpy = jest
    .spyOn(URL, 'createObjectURL')
    .mockImplementation(createObjectURL);
  const revokeObjectURLSpy = jest
    .spyOn(URL, 'revokeObjectURL')
    .mockImplementation(revokeObjectURL);
  const realCreateElement = document.createElement.bind(document);
  const createElementSpy = jest.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
    const element = realCreateElement(tagName);
    if (tagName === 'a') {
      jest.spyOn(element, 'click').mockImplementation(() => {});
    }
    return element;
  });
  const anchorClickSpy = jest
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => {});

  return {
    createObjectURL,
    revokeObjectURL,
    restore: () => {
      createElementSpy.mockRestore();
      anchorClickSpy.mockRestore();
      createObjectURLSpy.mockRestore();
      revokeObjectURLSpy.mockRestore();
    },
  };
}

async function readBlobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') {
    return blob.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'));
    reader.readAsText(blob);
  });
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

function getOverviewCell(streakName: string, dateKey: string): HTMLElement {
  const row = Array.from(document.querySelectorAll('.overview-row')).find(
    (element) => (element as HTMLElement).dataset.streak === streakName,
  ) as HTMLElement | undefined;
  if (!row) {
    throw new Error(`Unable to find overview row for ${streakName}`);
  }
  const cell = Array.from(row.querySelectorAll('.overview-day')).find(
    (element) => (element as HTMLElement).dataset.dateKey === dateKey,
  ) as HTMLElement | undefined;
  if (!cell) {
    throw new Error(`Unable to find overview day cell ${dateKey} for ${streakName}`);
  }
  return cell;
}

function getOverviewStreakButton(streakName: string): HTMLButtonElement {
  const row = Array.from(document.querySelectorAll('.overview-row')).find(
    (element) => (element as HTMLElement).dataset.streak === streakName,
  ) as HTMLElement | undefined;
  if (!row) {
    throw new Error(`Unable to find overview row for ${streakName}`);
  }
  const button = row.querySelector('.overview-row__name') as HTMLButtonElement | null;
  if (!button) {
    throw new Error(`Unable to find overview name button for ${streakName}`);
  }
  return button;
}

function openOverview(): void {
  const button = document.querySelector('[data-view="overview"]') as HTMLButtonElement | null;
  if (!button) {
    throw new Error('Unable to find overview toggle button');
  }
  button.click();
}

async function setupWithStreak(streakName = 'My Streak'): Promise<void> {
  window.location.hash = `#${encodeURIComponent(streakName)}`;
  document.body.innerHTML = '<div id="calendars"></div>';
  await setup();
}

async function setupInOverview(): Promise<void> {
  window.location.hash = '#overview';
  document.body.innerHTML = '<div id="calendars"></div>';
  await setup();
}

function triggerHashChange(): void {
  window.dispatchEvent(new Event('hashchange'));
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
    window.location.hash = '#My%20Streak';
  }
});

test('generateCalendar has 42 cells and correct day count', () => {
  const cells = generateCalendar(2023, 0); // January 2023
  expect(cells.length).toBe(42);
  expect(cells.filter((d) => d !== null).length).toBe(31);
});

test('streak controls CSS omits unused selectors', () => {
  const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
  expect(html).not.toContain('#streak-controls h2');
  expect(html).not.toContain('.streak-select');
  expect(html).not.toContain('#streak-controls select');
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
  await setupWithStreak();
  const cell = getDayCell('1');
  cell.dispatchEvent(new Event('click'));
  await flushAsyncOperations();
  await setupWithStreak();
  const cell2 = getDayCell('1');
  expect(cell2.classList.contains('red')).toBe(true);
});

test('third click sets day to blue and persists state', async () => {
  await setupWithStreak();
  const cell = getDayCell('1');
  cell.click();
  cell.click();
  cell.click();
  await flushAsyncOperations();
  await setupWithStreak();
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

  openOverview();
  await flushAsyncOperations();

  const myStreakButton = getOverviewStreakButton('My Streak');
  myStreakButton.click();
  await flushAsyncOperations();

  const defaultCell = getDayCell('1');
  expect(defaultCell.classList.contains('red')).toBe(false);
  defaultCell.click();
  await flushAsyncOperations();

  openOverview();
  await flushAsyncOperations();

  const workButton = getOverviewStreakButton('Work');
  workButton.click();
  await flushAsyncOperations();

  const workCellAgain = getDayCell('1');
  expect(workCellAgain.classList.contains('red')).toBe(true);
});

test('renaming a streak keeps its data and updates selection', async () => {
  const promptSpy = jest.spyOn(window, 'prompt').mockReturnValue('Renamed');
  try {
    await setupWithStreak();
    const firstCell = getDayCell('1');
    firstCell.click();
    await flushAsyncOperations();

    const renameButton = document.querySelector('.streak-rename') as HTMLButtonElement;
    renameButton.click();
    await flushAsyncOperations();

    await waitForCondition(() => window.location.hash === '#Renamed');
    openOverview();
    await flushAsyncOperations();
    await waitForCondition(() =>
      Array.from(document.querySelectorAll('.overview-row')).some(
        (row) => (row as HTMLElement).dataset.streak === 'Renamed'
      )
    );
    expect(window.location.hash).toBe('#overview');

    await setupWithStreak();
    openOverview();
    await flushAsyncOperations();
    const renamedButton = getOverviewStreakButton('Renamed');
    renamedButton.click();
    await flushAsyncOperations();
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
    await setupWithStreak();
    openOverview();
    await flushAsyncOperations();

    const addButton = document.querySelector('.streak-add__button') as HTMLButtonElement;
    addButton.click();
    await waitForCondition(() =>
      Array.from(document.querySelectorAll('.overview-row')).some(
        (el) => (el as HTMLElement).dataset.streak === 'Work'
      )
    );
    addButton.click();
    await waitForCondition(() =>
      Array.from(document.querySelectorAll('.overview-row')).some(
        (el) => (el as HTMLElement).dataset.streak === 'Home'
      )
    );

    const workButton = getOverviewStreakButton('Work');
    workButton.click();
    await flushAsyncOperations();

    const renameButton = document.querySelector('.streak-rename') as HTMLButtonElement;
    renameButton.click();
    await flushAsyncOperations();

    expect(alertSpy).toHaveBeenCalled();
    openOverview();
    await flushAsyncOperations();
    const names = Array.from(document.querySelectorAll('.overview-row')).map(
      (row) => (row as HTMLElement).dataset.streak
    );
    expect(names).toContain('Work');
    expect(names).toContain('Home');
    expect(window.location.hash).toBe('#overview');
  } finally {
    promptSpy.mockRestore();
    alertSpy.mockRestore();
  }
});

test('color settings rename labels and show swatches in stats', async () => {
  await setupWithStreak();

  const settingsButton = document.querySelector('.streak-settings') as HTMLButtonElement;
  settingsButton.click();
  await flushAsyncOperations();

  const greenInput = document.getElementById('streak-color-label-green') as HTMLInputElement;
  const redInput = document.getElementById('streak-color-label-red') as HTMLInputElement;
  const blueInput = document.getElementById('streak-color-label-blue') as HTMLInputElement;
  const greenSelect = document.getElementById('streak-color-select-green') as HTMLSelectElement;
  const redSelect = document.getElementById('streak-color-select-red') as HTMLSelectElement;
  const blueSelect = document.getElementById('streak-color-select-blue') as HTMLSelectElement;

  greenInput.value = 'Emerald';
  redInput.value = 'Ruby';
  blueInput.value = 'Azure';
  greenSelect.value = 'amber';
  redSelect.value = 'purple';
  blueSelect.value = 'orange';

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

  expect(document.querySelectorAll('.stats-swatch--amber').length).toBe(1);
  expect(document.querySelectorAll('.stats-swatch--purple').length).toBe(1);
  expect(document.querySelectorAll('.stats-swatch--orange').length).toBe(1);
});

test('changing a color selection updates existing day colors', async () => {
  await setupWithStreak();

  const dayOne = getDayCell('1');
  dayOne.click();
  await flushAsyncOperations();

  const settingsButton = document.querySelector('.streak-settings') as HTMLButtonElement;
  settingsButton.click();
  await flushAsyncOperations();

  const redSelect = document.getElementById('streak-color-select-red') as HTMLSelectElement;
  redSelect.value = 'purple';

  const saveButton = document.querySelector('.streak-settings__save') as HTMLButtonElement;
  saveButton.click();
  await flushAsyncOperations();

  await waitForCondition(() => getDayCell('1').classList.contains('purple'));
  const updatedCell = getDayCell('1');
  expect(updatedCell.classList.contains('purple')).toBe(true);
  expect(updatedCell.classList.contains('red')).toBe(false);
});

test('export downloads streak data as JSON', async () => {
  const restoreDate = mockDate('2024-04-10T12:00:00Z');
  const download = mockDownloadCapture();
  try {
    await setupWithStreak();

    const dayOne = getDayCell('1');
    dayOne.click();
    await flushAsyncOperations();

    const settingsButton = document.querySelector('.streak-settings') as HTMLButtonElement;
    settingsButton.click();
    await flushAsyncOperations();

    const redSelect = document.getElementById('streak-color-select-red') as HTMLSelectElement;
    redSelect.value = 'purple';

    const saveButton = document.querySelector('.streak-settings__save') as HTMLButtonElement;
    saveButton.click();
    await flushAsyncOperations();

    settingsButton.click();
    await flushAsyncOperations();

    await waitForCondition(() => Boolean(document.querySelector('.data-export')));
    const exportButton = document.querySelector('.data-export') as HTMLButtonElement;
    exportButton.click();
    await flushAsyncOperations();
    await waitForCondition(() => download.createObjectURL.mock.calls.length > 0, 60);

    expect(download.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = download.createObjectURL.mock.calls[0][0] as Blob;
    const text = await readBlobText(blob);
    const data = JSON.parse(text);
    expect(data.version).toBe(1);
    expect(data.names).toContain('My Streak');
    expect(data.types).toEqual(
      expect.arrayContaining([['My Streak', STREAK_TYPES.Color]]),
    );
    expect(data.settings).toEqual(
      expect.arrayContaining([['My Streak', { colorSelections: { red: 'purple' } }]]),
    );
    expect(data.dayStates).toEqual(
      expect.arrayContaining([[`${encodeURIComponent('My Streak')}::2024-4-1`, 1]]),
    );
  } finally {
    download.restore();
    restoreDate();
  }
});

test('settings button uses a gear icon', async () => {
  await setupWithStreak();

  const settingsButton = document.querySelector('.streak-settings') as HTMLButtonElement;
  expect(settingsButton.textContent).toBe('\u2699');
});

test('import warning text is visible in settings', async () => {
  await setupWithStreak();

  const settingsButton = document.querySelector('.streak-settings') as HTMLButtonElement;
  settingsButton.click();
  await flushAsyncOperations();

  await waitForCondition(() => Boolean(document.querySelector('.data-import__warning')));
  const warning = document.querySelector('.data-import__warning') as HTMLElement;
  expect(warning.textContent).toContain('replaces all existing streak data and settings');
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

  await setupInOverview();
  const names = Array.from(document.querySelectorAll('.overview-row')).map(
    (row) => (row as HTMLElement).dataset.streak
  );
  expect(names).toContain('Side');
  expect(names).toContain('Focus');
  expect(names).not.toContain('My Streak');
  expect(window.location.hash).toBe('#overview');
});

test('creating a streak uses a prompt and selects the new streak', async () => {
  const promptSpy = jest
    .spyOn(window, 'prompt')
    .mockImplementationOnce(() => 'New Streak')
    .mockImplementationOnce(() => 'Count');
  try {
    await setupWithStreak();

    const addButton = document.querySelector('.streak-add__button') as HTMLButtonElement;
    addButton.click();
    await flushAsyncOperations();

    await waitForCondition(() => window.location.hash === '#New%20Streak');
    openOverview();
    await flushAsyncOperations();
    const names = Array.from(document.querySelectorAll('.overview-row')).map(
      (row) => (row as HTMLElement).dataset.streak
    );
    expect(names).toContain('New Streak');
    expect(window.location.hash).toBe('#overview');
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
    await setupWithStreak();

    const addButton = document.querySelector('.streak-add__button') as HTMLButtonElement;
    addButton.click();
    await flushAsyncOperations();

    expect(alertSpy).toHaveBeenCalled();
    openOverview();
    await flushAsyncOperations();
    const names = Array.from(document.querySelectorAll('.overview-row')).map(
      (row) => (row as HTMLElement).dataset.streak
    );
    expect(names).not.toContain('Invalid Type Streak');
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
    await setupWithStreak();

    const addButton = document.querySelector('.streak-add__button') as HTMLButtonElement;
    addButton.click();
    await flushAsyncOperations();

    openOverview();
    await flushAsyncOperations();
    await waitForCondition(() =>
      Array.from(document.querySelectorAll('.overview-row')).some(
        (el) => (el as HTMLElement).dataset.streak === 'Work'
      )
    );
    const workButton = getOverviewStreakButton('Work');
    workButton.click();
    await flushAsyncOperations();

    const workDayOne = getDayCell('1');
    workDayOne.click();
    await flushAsyncOperations();

    const deleteButton = document.querySelector('.streak-delete') as HTMLButtonElement;
    deleteButton.click();
    await flushAsyncOperations();

    openOverview();
    await flushAsyncOperations();
    await waitForCondition(() =>
      Array.from(document.querySelectorAll('.overview-row')).every(
        (row) => (row as HTMLElement).dataset.streak !== 'Work'
      )
    );
    expect(window.location.hash).toBe('#overview');

    await setupWithStreak();
    openOverview();
    await flushAsyncOperations();
    const namesAfter = Array.from(document.querySelectorAll('.overview-row')).map(
      (row) => (row as HTMLElement).dataset.streak
    );
    expect(namesAfter).not.toContain('Work');
    const defaultButton = getOverviewStreakButton('My Streak');
    defaultButton.click();
    await flushAsyncOperations();
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
    await setupWithStreak();

    const dayOne = getDayCell('1');
    dayOne.click();
    await flushAsyncOperations();

    const deleteButton = document.querySelector('.streak-delete') as HTMLButtonElement;
    deleteButton.click();
    await flushAsyncOperations();

    await waitForCondition(() => window.location.hash === '#overview', 60);
    expect(window.location.hash).toBe('#overview');

    openOverview();
    await flushAsyncOperations();
    const names = Array.from(document.querySelectorAll('.overview-row')).map(
      (row) => (row as HTMLElement).dataset.streak
    );
    expect(names).toEqual(['My Streak']);
    const defaultButton = getOverviewStreakButton('My Streak');
    defaultButton.click();
    await flushAsyncOperations();
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

  await setupWithStreak();
  const cell = getDayCell('1');
  expect(cell.classList.contains('green')).toBe(true);
  restoreDate();
});

test('renders previous months below current month', async () => {
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const key = `${prev.getFullYear()}-${prev.getMonth() + 1}-1`;
  localStorage.setItem(key, '1');
  await setupWithStreak();
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
  await setupWithStreak();
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
  await setupWithStreak();

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
    await setupWithStreak();
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
    await setupWithStreak();
    const addButton = document.querySelector('.streak-add__button') as HTMLButtonElement;
    addButton.click();
    await flushAsyncOperations();

    openOverview();
    await flushAsyncOperations();
    await waitForCondition(() =>
      Array.from(document.querySelectorAll('.overview-row')).some(
        (el) => (el as HTMLElement).dataset.streak === 'Counts'
      )
    );
    const countButton = getOverviewStreakButton('Counts');
    countButton.click();
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
    await setupWithStreak();
    const addButton = document.querySelector('.streak-add__button') as HTMLButtonElement;
    addButton.click();
    await flushAsyncOperations();

    openOverview();
    await flushAsyncOperations();
    await waitForCondition(() =>
      Array.from(document.querySelectorAll('.overview-row')).some(
        (el) => (el as HTMLElement).dataset.streak === 'Counts'
      )
    );
    const countButton = getOverviewStreakButton('Counts');
    countButton.click();
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
    await setupWithStreak();

    const addButton = document.querySelector('.streak-add__button') as HTMLButtonElement;
    addButton.click();
    await flushAsyncOperations();

    openOverview();
    await flushAsyncOperations();
    await waitForCondition(() =>
      Array.from(document.querySelectorAll('.overview-row')).some(
        (el) => (el as HTMLElement).dataset.streak === 'Counts'
      )
    );
    const countButton = getOverviewStreakButton('Counts');
    countButton.click();
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
      60,
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
    await setupWithStreak();

    const addButton = document.querySelector('.streak-add__button') as HTMLButtonElement;
    addButton.click();
    await flushAsyncOperations();

    openOverview();
    await flushAsyncOperations();
    await waitForCondition(() =>
      Array.from(document.querySelectorAll('.overview-row')).some(
        (el) => (el as HTMLElement).dataset.streak === 'Counts'
      )
    );
    const countButton = getOverviewStreakButton('Counts');
    countButton.click();
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
    await setupWithStreak();
    const addButton = document.querySelector('.streak-add__button') as HTMLButtonElement;
    addButton.click();
    await flushAsyncOperations();

    openOverview();
    await flushAsyncOperations();
    await waitForCondition(() =>
      Array.from(document.querySelectorAll('.overview-row')).some(
        (el) => (el as HTMLElement).dataset.streak === 'Counts'
      )
    );
    const countButton = getOverviewStreakButton('Counts');
    countButton.click();
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
  await setupWithStreak();
  const settingsButton = document.querySelector('.streak-settings') as HTMLButtonElement;
  settingsButton.click();
  await flushAsyncOperations();

  const countOptions = document.querySelectorAll('input[name="count-zero-start"]');
  expect(countOptions.length).toBe(0);
});

test('persistDayValue stores or removes day values and records activity', async () => {
  const stateMap = new Map<string, number>();
  const persist = jest.fn().mockResolvedValue(undefined);
  const remove = jest.fn().mockResolvedValue(undefined);
  const recordActivity = jest.fn().mockResolvedValue(undefined);
  const onPersistError = jest.fn();
  const onRemoveError = jest.fn();
  const onRecordError = jest.fn();

  await persistDayValue({
    stateMap,
    dateKey: '2024-3-20',
    value: 2,
    persist,
    remove,
    recordActivity,
    onPersistError,
    onRemoveError,
    onRecordError,
  });

  expect(stateMap.get('2024-3-20')).toBe(2);
  expect(persist).toHaveBeenCalledWith(2);
  expect(remove).not.toHaveBeenCalled();
  expect(recordActivity).toHaveBeenCalledTimes(1);

  await persistDayValue({
    stateMap,
    dateKey: '2024-3-20',
    value: 0,
    persist,
    remove,
    recordActivity,
    onPersistError,
    onRemoveError,
    onRecordError,
  });

  expect(stateMap.has('2024-3-20')).toBe(false);
  expect(remove).toHaveBeenCalledTimes(1);
  expect(persist).toHaveBeenCalledTimes(1);
  expect(recordActivity).toHaveBeenCalledTimes(2);
  expect(onPersistError).not.toHaveBeenCalled();
  expect(onRemoveError).not.toHaveBeenCalled();
  expect(onRecordError).not.toHaveBeenCalled();
});

test('overview mode shows 7-day strips and updates color streak', async () => {
  const restoreDate = mockDate('2024-03-20T12:00:00Z');
  try {
    await setupWithStreak();

    const overviewButton = document.querySelector('[data-view="overview"]') as HTMLButtonElement;
    overviewButton.click();
    await flushAsyncOperations();

    const rows = document.querySelectorAll('.overview-row');
    expect(rows.length).toBe(1);
    const nameButton = rows[0].querySelector('.overview-row__name') as HTMLButtonElement | null;
    expect(nameButton).not.toBeNull();
    expect(nameButton?.tagName).toBe('BUTTON');
    expect(nameButton?.querySelector('.overview-row__chevron')?.textContent).toBe('›');
    const dayCells = rows[0].querySelectorAll('.overview-day');
    expect(dayCells.length).toBe(7);

    const todayKey = '2024-3-20';
    const cell = getOverviewCell('My Streak', todayKey);
    cell.click();
    await flushAsyncOperations();
    expect(cell.classList.contains('red')).toBe(true);

    const streakButton = getOverviewStreakButton('My Streak');
    streakButton.click();
    await flushAsyncOperations();

    const fullCell = getDayCell('20');
    expect(fullCell.classList.contains('red')).toBe(true);
  } finally {
    restoreDate();
  }
});

test('overview mode omits type label and shows color legend', async () => {
  const restoreDate = mockDate('2024-03-20T12:00:00Z');
  try {
    await setupWithStreak();

    const settingsButton = document.querySelector('.streak-settings') as HTMLButtonElement;
    settingsButton.click();
    await flushAsyncOperations();

    const greenInput = document.getElementById('streak-color-label-green') as HTMLInputElement;
    const redInput = document.getElementById('streak-color-label-red') as HTMLInputElement;
    const blueInput = document.getElementById('streak-color-label-blue') as HTMLInputElement;
    const greenSelect = document.getElementById('streak-color-select-green') as HTMLSelectElement;
    const redSelect = document.getElementById('streak-color-select-red') as HTMLSelectElement;
    const blueSelect = document.getElementById('streak-color-select-blue') as HTMLSelectElement;

    greenInput.value = 'Emerald';
    redInput.value = 'Ruby';
    blueInput.value = 'Azure';
    greenSelect.value = 'amber';
    redSelect.value = 'purple';
    blueSelect.value = 'orange';

    const saveButton = document.querySelector('.streak-settings__save') as HTMLButtonElement;
    saveButton.click();
    await flushAsyncOperations();

    const overviewButton = document.querySelector('[data-view="overview"]') as HTMLButtonElement;
    overviewButton.click();
    await flushAsyncOperations();

    await waitForCondition(() => Boolean(document.querySelector('.overview-row__legend')));

    expect(document.querySelector('.overview-row__type')).toBeNull();

    const row = document.querySelector('.overview-row') as HTMLElement;
    const legend = row.querySelector('.overview-row__legend') as HTMLElement;
    expect(legend).not.toBeNull();
    expect(legend.textContent).toContain('Emerald');
    expect(legend.textContent).toContain('Ruby');
    expect(legend.textContent).toContain('Azure');
    expect(legend.querySelectorAll('.overview-legend__swatch').length).toBe(3);
    expect(legend.querySelectorAll('.overview-legend__swatch--amber').length).toBe(1);
    expect(legend.querySelectorAll('.overview-legend__swatch--purple').length).toBe(1);
    expect(legend.querySelectorAll('.overview-legend__swatch--orange').length).toBe(1);
  } finally {
    restoreDate();
  }
});

test('overview button sets the overview hash', async () => {
  window.location.hash = '#Work';
  document.body.innerHTML = '<div id="calendars"></div>';
  await setup();

  const overviewButton = document.querySelector('[data-view="overview"]') as HTMLButtonElement;
  overviewButton.click();
  await flushAsyncOperations();

  expect(window.location.hash).toBe('#overview');
});

test('overview settings modal omits streak-specific options', async () => {
  await setupWithStreak();

  openOverview();
  await flushAsyncOperations();

  const settingsButton = document.querySelector('.streak-settings') as HTMLButtonElement;
  settingsButton.click();
  await flushAsyncOperations();

  await waitForCondition(() => Boolean(document.querySelector('.data-import__input')));
  expect(document.getElementById('streak-color-label-green')).toBeNull();
  expect(document.getElementById('streak-color-select-green')).toBeNull();
  expect(document.querySelector('input[name="count-zero-start"]')).toBeNull();
});

test('overview mode hides per-streak actions', async () => {
  await setupWithStreak();

  openOverview();
  await flushAsyncOperations();

  await waitForCondition(() => Boolean(document.querySelector('.overview-row')));
  expect(document.querySelector('.streak-rename')).toBeNull();
  expect(document.querySelector('.streak-delete')).toBeNull();
  expect(document.querySelector('.streak-settings')).not.toBeNull();
  expect(document.querySelector('.streak-add__button')).not.toBeNull();
});

test('overview mode increments count streak and persists', async () => {
  const restoreDate = mockDate('2024-03-20T12:00:00Z');
  const promptSpy = jest
    .spyOn(window, 'prompt')
    .mockImplementationOnce(() => 'Counts')
    .mockImplementationOnce(() => 'Count');
  try {
    await setupWithStreak();

    const addButton = document.querySelector('.streak-add__button') as HTMLButtonElement;
    addButton.click();
    await flushAsyncOperations();

    openOverview();
    await flushAsyncOperations();
    await waitForCondition(() =>
      Array.from(document.querySelectorAll('.overview-row')).some(
        (element) => (element as HTMLElement).dataset.streak === 'Counts',
      ),
    );

    const todayKey = '2024-3-20';
    const cell = getOverviewCell('Counts', todayKey);
    cell.click();
    await flushAsyncOperations();

    const value = cell.querySelector('.overview-day__value') as HTMLElement;
    expect(value.textContent).toBe('1');

    const countButton = getOverviewStreakButton('Counts');
    countButton.click();
    await flushAsyncOperations();

    const fullCell = getDayCell('20');
    const fullValue = fullCell.querySelector('.day-count__value') as HTMLElement;
    expect(fullValue.textContent).toBe('1');
  } finally {
    promptSpy.mockRestore();
    restoreDate();
  }
});

test('overview count cells omit unused count class', async () => {
  const restoreDate = mockDate('2024-03-20T12:00:00Z');
  const promptSpy = jest
    .spyOn(window, 'prompt')
    .mockImplementationOnce(() => 'Counts')
    .mockImplementationOnce(() => 'Count');
  try {
    await setupWithStreak();

    const addButton = document.querySelector('.streak-add__button') as HTMLButtonElement;
    addButton.click();
    await flushAsyncOperations();

    const overviewButton = document.querySelector('[data-view="overview"]') as HTMLButtonElement;
    overviewButton.click();
    await flushAsyncOperations();

    const todayKey = '2024-3-20';
    const cell = getOverviewCell('Counts', todayKey);
    expect(cell.classList.contains('overview-day--count')).toBe(false);
  } finally {
    promptSpy.mockRestore();
    restoreDate();
  }
});

test('import replaces existing streak data', async () => {
  const restoreDate = mockDate('2024-04-10T12:00:00Z');
  try {
    await setupWithStreak();

    const dayOne = getDayCell('1');
    dayOne.click();
    await flushAsyncOperations();

  const settingsButton = document.querySelector('.streak-settings') as HTMLButtonElement;
  settingsButton.click();
  await flushAsyncOperations();

  await waitForCondition(() => Boolean(document.querySelector('.data-import__input')));
  const payload = {
    version: 1,
    viewMode: 'full',
    names: ['Imported'],
    types: [['Imported', STREAK_TYPES.Color]],
    settings: [['Imported', { colorSelections: { green: 'amber' } }]],
    lastUpdated: [['Imported', 123]],
    dayStates: [[`${encodeURIComponent('Imported')}::2024-4-2`, 2]],
  };
  const file = new File([JSON.stringify(payload)], 'streak-tracker.json', {
    type: 'application/json',
  });
  const importInput = document.querySelector('.data-import__input') as HTMLInputElement;
  Object.defineProperty(importInput, 'files', { value: [file] });
  importInput.dispatchEvent(new Event('change'));
  await flushAsyncOperations();

    await waitForCondition(() => window.location.hash === '#Imported');
    await waitForCondition(() => Boolean(document.querySelector('.calendar')));

    const dayTwo = getDayCell('2');
    expect(dayTwo.classList.contains('amber')).toBe(true);
    const dayOneAfter = getDayCell('1');
    expect(dayOneAfter.classList.contains('red')).toBe(false);
  } finally {
    restoreDate();
  }
});

test('view mode persists across reloads', async () => {
  const restoreDate = mockDate('2024-03-20T12:00:00Z');
  try {
    await setupInOverview();
    expect(document.querySelectorAll('.overview-row').length).toBe(1);

    document.body.innerHTML = '<div id="calendars"></div>';
    await setup();

    expect(window.location.hash).toBe('#overview');
    expect(document.querySelectorAll('.overview-row').length).toBe(1);
  } finally {
    restoreDate();
  }
});

test('initial load defaults to overview view and updates the hash', async () => {
  window.location.hash = '';
  document.body.innerHTML = '<div id="calendars"></div>';
  await setup();

  await waitForCondition(() => Boolean(document.querySelector('.overview-row')));
  expect(window.location.hash).toBe('#overview');
  expect(document.querySelector('.calendar')).toBeNull();
});

test('hash navigation returns to overview from streak detail', async () => {
  await setupInOverview();
  await waitForCondition(() => Boolean(document.querySelector('.overview-row')));

  const streakButton = getOverviewStreakButton('My Streak');
  streakButton.click();
  await flushAsyncOperations();
  await waitForCondition(() => Boolean(document.querySelector('.calendar')));
  expect(window.location.hash).toBe('#My%20Streak');

  window.location.hash = '#overview';
  triggerHashChange();
  await flushAsyncOperations();

  await waitForCondition(() => Boolean(document.querySelector('.overview-row')));
  expect(document.querySelector('.calendar')).toBeNull();
});
