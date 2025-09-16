export function generateCalendar(year: number, month: number): (number | null)[] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = Array(42).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells[firstDay + day - 1] = day;
  }
  return cells;
}

function getStoredMonths(now: Date): { year: number; month: number }[] {
  const months = new Set<string>();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && /^\d{4}-\d{1,2}-\d{1,2}$/.test(key)) {
      const [y, m] = key.split('-').map(Number);
      months.add(`${y}-${m}`);
    }
  }
  months.add(`${now.getFullYear()}-${now.getMonth() + 1}`);
  return Array.from(months).map((str) => {
    const [y, m] = str.split('-').map(Number);
    return { year: y, month: m };
  });
}

export function setup() {
  const container = document.getElementById('calendars');
  if (!container) {
    return;
  }
  container.innerHTML = '';

  const now = new Date();
  const months = getStoredMonths(now).sort((a, b) => {
    if (a.year === b.year) {
      return b.month - a.month;
    }
    return b.year - a.year;
  });

  months.forEach(({ year, month }) => {
    const section = document.createElement('section');
    const label = document.createElement('h1');
    const monthName = new Date(year, month - 1).toLocaleString('default', {
      month: 'long',
    });
    label.textContent = `${monthName} ${year}`;
    section.appendChild(label);

    const calendar = document.createElement('div');
    calendar.className = 'calendar';
    const stats = document.createElement('p');
    stats.className = 'stats';
    const updateStats = () => {
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
      const colorCounts = {
        red: 0,
        green: 0,
        blue: 0,
      };
      const currentStreaks = {
        red: 0,
        green: 0,
        blue: 0,
      };
      const longestStreaks = {
        red: 0,
        green: 0,
        blue: 0,
      };
      let currentGreenBlueStreak = 0;
      let longestGreenBlueStreak = 0;
      for (let day = 1; day <= daysPassed; day++) {
        const state = Number(localStorage.getItem(`${year}-${month}-${day}`));
        if (state === 1) {
          colorCounts.red++;
          currentStreaks.red++;
          currentStreaks.green = 0;
          currentStreaks.blue = 0;
          currentGreenBlueStreak = 0;
          if (currentStreaks.red > longestStreaks.red) {
            longestStreaks.red = currentStreaks.red;
          }
        } else if (state === 2) {
          colorCounts.green++;
          currentStreaks.green++;
          currentStreaks.red = 0;
          currentStreaks.blue = 0;
          currentGreenBlueStreak++;
          if (currentGreenBlueStreak > longestGreenBlueStreak) {
            longestGreenBlueStreak = currentGreenBlueStreak;
          }
          if (currentStreaks.green > longestStreaks.green) {
            longestStreaks.green = currentStreaks.green;
          }
        } else if (state === 3) {
          colorCounts.blue++;
          currentStreaks.blue++;
          currentStreaks.red = 0;
          currentStreaks.green = 0;
          currentGreenBlueStreak++;
          if (currentGreenBlueStreak > longestGreenBlueStreak) {
            longestGreenBlueStreak = currentGreenBlueStreak;
          }
          if (currentStreaks.blue > longestStreaks.blue) {
            longestStreaks.blue = currentStreaks.blue;
          }
        } else {
          currentStreaks.red = 0;
          currentStreaks.green = 0;
          currentStreaks.blue = 0;
          currentGreenBlueStreak = 0;
        }
      }
      stats.innerHTML = [
        `Green days: ${colorCounts.green}/${daysPassed}, Longest green streak: ${longestStreaks.green}`,
        `Red days: ${colorCounts.red}/${daysPassed}, Longest red streak: ${longestStreaks.red}`,
        `Blue days: ${colorCounts.blue}/${daysPassed}, Longest blue streak: ${longestStreaks.blue}`,
        `Longest green or blue streak: ${longestGreenBlueStreak}`,
      ].join('<br>');
    };
    const cells = generateCalendar(year, month - 1);
    cells.forEach((value) => {
      const cell = document.createElement('div');
      cell.className = 'day';
      if (value !== null) {
        cell.textContent = String(value);
        const dateKey = `${year}-${month}-${value}`;
        let state = Number(localStorage.getItem(dateKey)) || 0;
        const applyState = (s: number) => {
          cell.classList.remove('red', 'green', 'blue');
          if (s === 1) {
            cell.classList.add('red');
          } else if (s === 2) {
            cell.classList.add('green');
          } else if (s === 3) {
            cell.classList.add('blue');
          }
        };
        applyState(state);
        cell.addEventListener('click', () => {
          state = (state + 1) % 4;
          applyState(state);
          if (state === 0) {
            localStorage.removeItem(dateKey);
          } else {
            localStorage.setItem(dateKey, String(state));
          }
          updateStats();
        });
      }
      calendar.appendChild(cell);
    });
    section.appendChild(calendar);
    section.appendChild(stats);
    container.appendChild(section);
    updateStats();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setup);
} else {
  setup();
}
