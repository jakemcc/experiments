const COMMIT_KEY = 'commitToggle';
const COMMIT_TIME_KEY = 'commitFirstSetAt';
const HELD_KEY = 'heldToggle';
const LOCK_DURATION_MS = 30 * 1000;
function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();
}
function scheduleLock(firstSetAt, buttons) {
    const disableButtons = () => buttons.forEach(r => r.disabled = true);
    const remaining = LOCK_DURATION_MS - (Date.now() - firstSetAt);
    if (remaining <= 0) {
        disableButtons();
    }
    else {
        setTimeout(disableButtons, remaining);
    }
}
export function setup() {
    const commitYes = document.getElementById('commit-yes');
    const commitNo = document.getElementById('commit-no');
    const heldYes = document.getElementById('held-yes');
    const heldNo = document.getElementById('held-no');
    // daily reset for commit
    const firstSetRaw = localStorage.getItem(COMMIT_TIME_KEY);
    if (firstSetRaw) {
        const firstSetAt = parseInt(firstSetRaw, 10);
        if (!isSameDay(new Date(firstSetAt), new Date())) {
            localStorage.removeItem(COMMIT_KEY);
            localStorage.removeItem(COMMIT_TIME_KEY);
        }
    }
    const savedCommit = localStorage.getItem(COMMIT_KEY);
    if (savedCommit !== null) {
        if (savedCommit === 'true') {
            commitYes.classList.add('selected');
        }
        else {
            commitNo.classList.add('selected');
        }
        const firstSetAt = parseInt(localStorage.getItem(COMMIT_TIME_KEY) || '0', 10);
        scheduleLock(firstSetAt, [commitYes, commitNo]);
    }
    const savedHeld = localStorage.getItem(HELD_KEY);
    if (savedHeld !== null) {
        if (savedHeld === 'true') {
            heldYes.classList.add('selected');
        }
        else {
            heldNo.classList.add('selected');
        }
    }
    const handleCommitClick = (ev) => {
        const target = ev.target;
        if (target === commitYes) {
            const nowSelected = !commitYes.classList.contains('selected');
            commitYes.classList.toggle('selected', nowSelected);
            if (nowSelected)
                commitNo.classList.remove('selected');
        }
        else if (target === commitNo) {
            const nowSelected = !commitNo.classList.contains('selected');
            commitNo.classList.toggle('selected', nowSelected);
            if (nowSelected)
                commitYes.classList.remove('selected');
        }
        if (commitYes.classList.contains('selected')) {
            localStorage.setItem(COMMIT_KEY, 'true');
        }
        else if (commitNo.classList.contains('selected')) {
            localStorage.setItem(COMMIT_KEY, 'false');
        }
        else {
            localStorage.removeItem(COMMIT_KEY);
        }
        let firstSetAt = parseInt(localStorage.getItem(COMMIT_TIME_KEY) || '0', 10);
        if (!firstSetAt && (commitYes.classList.contains('selected') || commitNo.classList.contains('selected'))) {
            firstSetAt = Date.now();
            localStorage.setItem(COMMIT_TIME_KEY, String(firstSetAt));
            scheduleLock(firstSetAt, [commitYes, commitNo]);
        }
    };
    commitYes.addEventListener('click', handleCommitClick);
    commitNo.addEventListener('click', handleCommitClick);
    const handleHeldClick = (ev) => {
        const target = ev.target;
        if (target === heldYes) {
            const nowSelected = !heldYes.classList.contains('selected');
            heldYes.classList.toggle('selected', nowSelected);
            if (nowSelected)
                heldNo.classList.remove('selected');
        }
        else if (target === heldNo) {
            const nowSelected = !heldNo.classList.contains('selected');
            heldNo.classList.toggle('selected', nowSelected);
            if (nowSelected)
                heldYes.classList.remove('selected');
        }
        if (heldYes.classList.contains('selected')) {
            localStorage.setItem(HELD_KEY, 'true');
        }
        else if (heldNo.classList.contains('selected')) {
            localStorage.setItem(HELD_KEY, 'false');
        }
        else {
            localStorage.removeItem(HELD_KEY);
        }
    };
    heldYes.addEventListener('click', handleHeldClick);
    heldNo.addEventListener('click', handleHeldClick);
}
document.addEventListener('DOMContentLoaded', setup);
export { isSameDay }; // for testing
