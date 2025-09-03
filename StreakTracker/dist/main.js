export function generateCalendar(year, month) {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = Array(42).fill(null);
    for (let day = 1; day <= daysInMonth; day++) {
        cells[firstDay + day - 1] = day;
    }
    return cells;
}
function getStoredMonths(now) {
    const months = new Set();
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
            }
            else if (year < now.getFullYear() ||
                (year === now.getFullYear() && month < now.getMonth() + 1)) {
                daysPassed = daysInMonth;
            }
            let greenDays = 0;
            let longestStreak = 0;
            let currentStreak = 0;
            for (let day = 1; day <= daysPassed; day++) {
                const state = Number(localStorage.getItem(`${year}-${month}-${day}`));
                if (state === 2) {
                    greenDays++;
                    currentStreak++;
                    if (currentStreak > longestStreak) {
                        longestStreak = currentStreak;
                    }
                }
                else {
                    currentStreak = 0;
                }
            }
            stats.textContent = `Green days: ${greenDays}/${daysPassed}, Longest green streak: ${longestStreak}`;
        };
        const cells = generateCalendar(year, month - 1);
        cells.forEach((value) => {
            const cell = document.createElement('div');
            cell.className = 'day';
            if (value !== null) {
                cell.textContent = String(value);
                const dateKey = `${year}-${month}-${value}`;
                let state = Number(localStorage.getItem(dateKey)) || 0;
                const applyState = (s) => {
                    cell.classList.remove('red', 'green');
                    if (s === 1) {
                        cell.classList.add('red');
                    }
                    else if (s === 2) {
                        cell.classList.add('green');
                    }
                };
                applyState(state);
                cell.addEventListener('click', () => {
                    state = (state + 1) % 3;
                    applyState(state);
                    if (state === 0) {
                        localStorage.removeItem(dateKey);
                    }
                    else {
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
}
else {
    setup();
}
