import { generateCalendar, setup } from './main';

test('generateCalendar has 42 cells and correct day count', () => {
  const cells = generateCalendar(2023, 0); // January 2023
  expect(cells.length).toBe(42);
  expect(cells.filter((d) => d !== null).length).toBe(31);
});

test('clicking a day saves and restores its state', () => {
  document.body.innerHTML = '<h1 id="month-label"></h1><div id="calendar"></div>';
  localStorage.clear();
  setup();
  const cell = Array.from(document.querySelectorAll('.day')).find(
    (c) => c.textContent === '1'
  ) as HTMLElement;
  cell.dispatchEvent(new Event('click'));
  const now = new Date();
  const key = `${now.getFullYear()}-${now.getMonth() + 1}-1`;
  expect(localStorage.getItem(key)).toBe('1');
  document.body.innerHTML = '<h1 id="month-label"></h1><div id="calendar"></div>';
  setup();
  const cell2 = Array.from(document.querySelectorAll('.day')).find(
    (c) => c.textContent === '1'
  ) as HTMLElement;
  expect(cell2.classList.contains('red')).toBe(true);
});
