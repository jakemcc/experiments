import { generateCalendar, setup } from './main';

test('generateCalendar has 42 cells and correct day count', () => {
  const cells = generateCalendar(2023, 0); // January 2023
  expect(cells.length).toBe(42);
  expect(cells.filter((d) => d !== null).length).toBe(31);
});

test('clicking a day saves and restores its state', () => {
  document.body.innerHTML = '<div id="calendars"></div>';
  localStorage.clear();
  setup();
  const cell = Array.from(document.querySelectorAll('.day')).find(
    (c) => c.textContent === '1'
  ) as HTMLElement;
  cell.dispatchEvent(new Event('click'));
  const now = new Date();
  const key = `${now.getFullYear()}-${now.getMonth() + 1}-1`;
  expect(localStorage.getItem(key)).toBe('1');
  document.body.innerHTML = '<div id="calendars"></div>';
  setup();
  const cell2 = Array.from(document.querySelectorAll('.day')).find(
    (c) => c.textContent === '1'
  ) as HTMLElement;
  expect(cell2.classList.contains('red')).toBe(true);
});

test('third click sets day to blue and persists state', () => {
  document.body.innerHTML = '<div id="calendars"></div>';
  localStorage.clear();
  setup();
  const cell = Array.from(document.querySelectorAll('.day')).find(
    (c) => c.textContent === '1'
  ) as HTMLElement;
  cell.click();
  cell.click();
  cell.click();
  const now = new Date();
  const key = `${now.getFullYear()}-${now.getMonth() + 1}-1`;
  expect(localStorage.getItem(key)).toBe('3');
  document.body.innerHTML = '<div id="calendars"></div>';
  setup();
  const cell2 = Array.from(document.querySelectorAll('.day')).find(
    (c) => c.textContent === '1'
  ) as HTMLElement;
  expect(cell2.classList.contains('blue')).toBe(true);
});

test('renders previous months below current month', () => {
  document.body.innerHTML = '<div id="calendars"></div>';
  localStorage.clear();
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const key = `${prev.getFullYear()}-${prev.getMonth() + 1}-1`;
  localStorage.setItem(key, '1');
  setup();
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

test('stats update for all colors and streaks', () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2023-06-15'));
  document.body.innerHTML = '<div id="calendars"></div>';
  localStorage.clear();
  setup();
  const stats = document.querySelector('.stats') as HTMLElement;
  const getColorRowText = (color: string) =>
    (stats.querySelector(`.stat-row[data-color="${color}"] .stat-text`) as HTMLElement)
      .textContent;
  const getCombinedText = () =>
    (stats.querySelector(
      '.stat-row[data-combination="green-blue"] .stat-text'
    ) as HTMLElement).textContent;
  const expectStats = (expected: {
    green: string;
    red: string;
    blue: string;
    combined: string;
  }) => {
    expect(getColorRowText('green')).toBe(expected.green);
    expect(getColorRowText('red')).toBe(expected.red);
    expect(getColorRowText('blue')).toBe(expected.blue);
    expect(getCombinedText()).toBe(expected.combined);
  };
  expect(stats.querySelectorAll('.stat-row').length).toBe(4);
  expect(stats.querySelectorAll('.stat-swatch').length).toBe(5);
  expect(
    stats.querySelectorAll('.stat-row[data-combination="green-blue"] .stat-swatch').length
  ).toBe(2);
  expectStats({
    green: 'Days: 0/15, Longest streak: 0',
    red: 'Days: 0/15, Longest streak: 0',
    blue: 'Days: 0/15, Longest streak: 0',
    combined: 'Longest combined streak: 0',
  });
  const day1 = Array.from(document.querySelectorAll('.day')).find(
    (c) => c.textContent === '1'
  ) as HTMLElement;
  day1.click();
  expectStats({
    green: 'Days: 0/15, Longest streak: 0',
    red: 'Days: 1/15, Longest streak: 1',
    blue: 'Days: 0/15, Longest streak: 0',
    combined: 'Longest combined streak: 0',
  });
  day1.click();
  expectStats({
    green: 'Days: 1/15, Longest streak: 1',
    red: 'Days: 0/15, Longest streak: 0',
    blue: 'Days: 0/15, Longest streak: 0',
    combined: 'Longest combined streak: 1',
  });
  day1.click();
  expectStats({
    green: 'Days: 0/15, Longest streak: 0',
    red: 'Days: 0/15, Longest streak: 0',
    blue: 'Days: 1/15, Longest streak: 1',
    combined: 'Longest combined streak: 1',
  });
  jest.useRealTimers();
});

test('longest green or blue streak spans both colors', () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2023-06-15'));
  document.body.innerHTML = '<div id="calendars"></div>';
  localStorage.clear();
  setup();
  const stats = document.querySelector('.stats') as HTMLElement;
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
  setState(getCell('2'), 2);
  setState(getCell('3'), 3);
  setState(getCell('4'), 2);
  const getColorRowText = (color: string) =>
    (stats.querySelector(`.stat-row[data-color="${color}"] .stat-text`) as HTMLElement)
      .textContent;
  const getCombinedText = () =>
    (stats.querySelector(
      '.stat-row[data-combination="green-blue"] .stat-text'
    ) as HTMLElement).textContent;
  expect(getColorRowText('green')).toBe('Days: 3/15, Longest streak: 2');
  expect(getColorRowText('red')).toBe('Days: 0/15, Longest streak: 0');
  expect(getColorRowText('blue')).toBe('Days: 1/15, Longest streak: 1');
  expect(getCombinedText()).toBe('Longest combined streak: 4');
  jest.useRealTimers();
});
