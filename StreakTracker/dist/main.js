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
    const year = now.getFullYear();
    const month = now.getMonth();
    const cells = generateCalendar(year, month);
    cells.forEach((value) => {
        const cell = document.createElement('div');
        cell.className = 'day';
        if (value !== null) {
            cell.textContent = String(value);
            const dateKey = `${year}-${month + 1}-${value}`;
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
            });
        }
        calendar.appendChild(cell);
    });
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
}
else {
    setup();
}
