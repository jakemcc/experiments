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

test('stats update with green days and longest streak', () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2023-06-15'));
  document.body.innerHTML = '<div id="calendars"></div>';
  localStorage.clear();
  setup();
  const stats = document.querySelector('.stats') as HTMLElement;
  expect(stats.textContent).toBe('Green days: 0/15, Longest green streak: 0');
  const day1 = Array.from(document.querySelectorAll('.day')).find(
    (c) => c.textContent === '1'
  ) as HTMLElement;
  day1.click();
  day1.click();
  expect(stats.textContent).toBe('Green days: 1/15, Longest green streak: 1');
  const day2 = Array.from(document.querySelectorAll('.day')).find(
    (c) => c.textContent === '2'
  ) as HTMLElement;
  day2.click();
  day2.click();
  expect(stats.textContent).toBe('Green days: 2/15, Longest green streak: 2');
  jest.useRealTimers();
});
