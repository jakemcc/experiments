import {
  generateCalendar,
  setup,
  clearAllStoredDaysForTests,
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

test('clicking a day saves and restores its state', async () => {
  document.body.innerHTML = '<div id="calendars"></div>';
  await setup();
  const cell = Array.from(document.querySelectorAll('.day')).find(
    (c) => c.textContent === '1'
  ) as HTMLElement;
  cell.dispatchEvent(new Event('click'));
  await flushAsyncOperations();
  document.body.innerHTML = '<div id="calendars"></div>';
  await setup();
  const cell2 = Array.from(document.querySelectorAll('.day')).find(
    (c) => c.textContent === '1'
  ) as HTMLElement;
  expect(cell2.classList.contains('red')).toBe(true);
});

test('third click sets day to blue and persists state', async () => {
  document.body.innerHTML = '<div id="calendars"></div>';
  await setup();
  const cell = Array.from(document.querySelectorAll('.day')).find(
    (c) => c.textContent === '1'
  ) as HTMLElement;
  cell.click();
  cell.click();
  cell.click();
  await flushAsyncOperations();
  document.body.innerHTML = '<div id="calendars"></div>';
  await setup();
  const cell2 = Array.from(document.querySelectorAll('.day')).find(
    (c) => c.textContent === '1'
  ) as HTMLElement;
  expect(cell2.classList.contains('blue')).toBe(true);
});

test('streak selection uses URL hash and keeps calendars separate', async () => {
  window.location.hash = '#Work';
  document.body.innerHTML = '<div id="calendars"></div>';
  await setup();

  const getCell = (day: string) =>
    Array.from(document.querySelectorAll('.day')).find((c) => c.textContent === day) as HTMLElement;

  const workCell = getCell('1');
  workCell.click();
  await flushAsyncOperations();
  expect(window.location.hash).toBe('#Work');

  const select = document.querySelector('#streak-controls select') as HTMLSelectElement;
  select.value = 'My Streak';
  select.dispatchEvent(new Event('change'));
  await flushAsyncOperations();

  const defaultCell = getCell('1');
  expect(defaultCell.classList.contains('red')).toBe(false);
  defaultCell.click();
  await flushAsyncOperations();

  select.value = 'Work';
  select.dispatchEvent(new Event('change'));
  await flushAsyncOperations();

  const workCellAgain = getCell('1');
  expect(workCellAgain.classList.contains('red')).toBe(true);
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
  const cell = Array.from(document.querySelectorAll('.day')).find(
    (c) => c.textContent === '1'
  ) as HTMLElement;
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
  const expectStats = async (lines: string[]) => {
    await waitForCondition(() => stats.innerHTML === lines.join('<br>'));
    expect(stats.innerHTML).toBe(lines.join('<br>'));
  };
  await expectStats([
    `Green days: 0/${daysPassed}, Longest green streak: 0`,
    `Red days: 0/${daysPassed}, Longest red streak: 0`,
    `Blue days: 0/${daysPassed}, Longest blue streak: 0`,
    'Longest green or blue streak: 0',
  ]);
  const day1 = Array.from(document.querySelectorAll('.day')).find(
    (c) => c.textContent === '1'
  ) as HTMLElement;
  day1.click();
  await flushAsyncOperations();
  await expectStats([
    `Green days: 0/${daysPassed}, Longest green streak: 0`,
    `Red days: 1/${daysPassed}, Longest red streak: 1`,
    `Blue days: 0/${daysPassed}, Longest blue streak: 0`,
    'Longest green or blue streak: 0',
  ]);
  day1.click();
  await flushAsyncOperations();
  await expectStats([
    `Green days: 1/${daysPassed}, Longest green streak: 1`,
    `Red days: 0/${daysPassed}, Longest red streak: 0`,
    `Blue days: 0/${daysPassed}, Longest blue streak: 0`,
    'Longest green or blue streak: 1',
  ]);
  day1.click();
  await flushAsyncOperations();
  await expectStats([
    `Green days: 0/${daysPassed}, Longest green streak: 0`,
    `Red days: 0/${daysPassed}, Longest red streak: 0`,
    `Blue days: 1/${daysPassed}, Longest blue streak: 1`,
    'Longest green or blue streak: 1',
  ]);
  restoreDate();
});

test('longest green or blue streak spans both colors', async () => {
  const restoreDate = mockDate('2023-06-15T00:00:00Z');
  try {
    document.body.innerHTML = '<div id="calendars"></div>';
    await setup();
    const stats = document.querySelector('.stats') as HTMLElement;
    const daysPassed = new Date().getDate();
    const getCell = (day: string) =>
      Array.from(document.querySelectorAll('.day')).find(
        (c) => c.textContent === day
      ) as HTMLElement;
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
    setState(getCell('1'), 2);
    await flushAsyncOperations();
    setState(getCell('2'), 2);
    await flushAsyncOperations();
    setState(getCell('3'), 3);
    await flushAsyncOperations();
    setState(getCell('4'), 2);
    await flushAsyncOperations();
    const expected = [
      `Green days: 3/${daysPassed}, Longest green streak: 2`,
      `Red days: 0/${daysPassed}, Longest red streak: 0`,
      `Blue days: 1/${daysPassed}, Longest blue streak: 1`,
      'Longest green or blue streak: 4',
    ].join('<br>');
    await waitForCondition(() => stats.innerHTML === expected);
    expect(stats.innerHTML).toBe(expected);
  } finally {
    restoreDate();
  }
});
