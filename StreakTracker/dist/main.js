export function generateCalendar(year, month) {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = Array(42).fill(null);
    for (let day = 1; day <= daysInMonth; day++) {
        cells[firstDay + day - 1] = day;
    }
    return cells;
}
export function setup() {
    const now = new Date();
    const label = document.getElementById('month-label');
    if (label) {
        const monthName = now.toLocaleString('default', { month: 'long' });
        label.textContent = `${monthName} ${now.getFullYear()}`;
    }
    const calendar = document.getElementById('calendar');
    if (!calendar) {
        return;
    }
    const cells = generateCalendar(now.getFullYear(), now.getMonth());
    cells.forEach((value) => {
        const cell = document.createElement('div');
        cell.className = 'day';
        if (value !== null) {
            cell.textContent = String(value);
        }
        let state = 0;
        cell.addEventListener('click', () => {
            state = (state + 1) % 3;
            cell.classList.remove('red', 'green');
            if (state === 1) {
                cell.classList.add('red');
            }
            else if (state === 2) {
                cell.classList.add('green');
            }
        });
        calendar.appendChild(cell);
    });
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
}
else {
    setup();
}
