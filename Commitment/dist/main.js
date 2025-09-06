const COMMIT_KEY = 'commitToggle';
const COMMIT_TIME_KEY = 'commitFirstSetAt';
const HELD_KEY = 'heldToggle';
const HELD_SUCCESS_KEY = 'heldSuccessDates';
const HELD_FAILURE_KEY = 'heldFailureDates';
const LOCK_DURATION_MS = 30 * 1000;
const VISUAL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const ADMIN_OFFSET_KEY = 'adminDayOffset';
const DAY_CUTOFF_HOUR = 4;
function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();
}
function getOffset() {
    return parseInt(localStorage.getItem(ADMIN_OFFSET_KEY) || '0', 10);
}
function currentTime() {
    return Date.now() + getOffset() * DAY_MS;
}
function currentDate() {
    return new Date(currentTime());
}
function getAppDay(date) {
    const adjusted = new Date(date);
    adjusted.setHours(adjusted.getHours() - DAY_CUTOFF_HOUR, 0, 0, 0);
    return Math.floor(adjusted.getTime() / DAY_MS);
}
function scheduleLock(firstSetAt, inputs) {
    const disableInputs = () => inputs.forEach(r => r.disabled = true);
    const remaining = LOCK_DURATION_MS - (currentTime() - firstSetAt);
    if (remaining <= 0) {
        disableInputs();
    }
    else {
        setTimeout(disableInputs, remaining);
    }
}
function renderSuccesses(container, successes, failures) {
    const today = currentDate();
    for (let i = VISUAL_DAYS - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        const square = document.createElement('div');
        square.className = 'day';
        if (i === 0) {
            square.classList.add('current');
        }
        if (successes.includes(dateStr)) {
            square.classList.add('success');
        }
        else if (failures.includes(dateStr)) {
            square.classList.add('failure');
        }
        container.appendChild(square);
    }
}
export function setup() {
    const params = new URLSearchParams(window.location.search);
    const isAdmin = params.get('admin') === 'true';
    if (!isAdmin) {
        localStorage.removeItem(ADMIN_OFFSET_KEY);
    }
    const commitYes = document.getElementById('commit-yes');
    const commitNo = document.getElementById('commit-no');
    const heldYes = document.getElementById('held-yes');
    const heldNo = document.getElementById('held-no');
    const heldPrompt = document.getElementById('held-prompt');
    const successContainer = document.getElementById('success-visual');
    if (!commitYes || !commitNo || !heldYes || !heldNo) {
        return;
    }
    const recordSuccess = (firstSetAt) => {
        const successes = JSON.parse(localStorage.getItem(HELD_SUCCESS_KEY) || '[]');
        const dateStr = new Date(firstSetAt).toISOString().split('T')[0];
        if (!successes.includes(dateStr)) {
            successes.push(dateStr);
            localStorage.setItem(HELD_SUCCESS_KEY, JSON.stringify(successes));
        }
    };
    const recordFailure = (firstSetAt) => {
        const failures = JSON.parse(localStorage.getItem(HELD_FAILURE_KEY) || '[]');
        const dateStr = new Date(firstSetAt).toISOString().split('T')[0];
        if (!failures.includes(dateStr)) {
            failures.push(dateStr);
            localStorage.setItem(HELD_FAILURE_KEY, JSON.stringify(failures));
        }
    };
    const resetSelections = () => {
        commitYes.checked = false;
        commitNo.checked = false;
        heldYes.checked = false;
        heldNo.checked = false;
        commitYes.disabled = false;
        commitNo.disabled = false;
        localStorage.removeItem(COMMIT_KEY);
        localStorage.removeItem(COMMIT_TIME_KEY);
        localStorage.removeItem(HELD_KEY);
        if (heldPrompt) {
            heldPrompt.textContent = '';
            heldPrompt.hidden = true;
        }
    };
    let awaitingHeld = false;
    // daily reset for commit
    const firstSetRaw = localStorage.getItem(COMMIT_TIME_KEY);
    if (firstSetRaw) {
        const firstSetAt = parseInt(firstSetRaw, 10);
        const firstDate = new Date(firstSetAt);
        const now = currentDate();
        const diffDays = getAppDay(now) - getAppDay(firstDate);
        if (diffDays === 1) {
            const held = localStorage.getItem(HELD_KEY);
            if (held === null) {
                awaitingHeld = true;
                if (heldPrompt) {
                    heldPrompt.textContent = 'Please record whether you held your commitment yesterday.';
                    heldPrompt.hidden = false;
                }
            }
            else {
                if (held === 'true') {
                    recordSuccess(firstSetAt);
                }
                else if (held === 'false') {
                    recordFailure(firstSetAt);
                }
                resetSelections();
            }
        }
        else if (diffDays > 1) {
            alert('It has been a while since your last visit. Please open the app more often.');
            resetSelections();
        }
    }
    const savedCommit = localStorage.getItem(COMMIT_KEY);
    if (savedCommit !== null) {
        if (savedCommit === 'true') {
            commitYes.checked = true;
        }
        else {
            commitNo.checked = true;
        }
        const firstSetAt = parseInt(localStorage.getItem(COMMIT_TIME_KEY) || '0', 10);
        scheduleLock(firstSetAt, [commitYes, commitNo]);
    }
    const savedHeld = localStorage.getItem(HELD_KEY);
    if (savedHeld !== null) {
        if (savedHeld === 'true') {
            heldYes.checked = true;
        }
        else {
            heldNo.checked = true;
        }
    }
    if (successContainer) {
        const successes = JSON.parse(localStorage.getItem(HELD_SUCCESS_KEY) || '[]');
        const failures = JSON.parse(localStorage.getItem(HELD_FAILURE_KEY) || '[]');
        renderSuccesses(successContainer, successes, failures);
    }
    const handleCommitChange = (ev) => {
        const target = ev.target;
        if (target === commitYes && commitYes.checked) {
            commitNo.checked = false;
        }
        else if (target === commitNo && commitNo.checked) {
            commitYes.checked = false;
        }
        if (commitYes.checked) {
            localStorage.setItem(COMMIT_KEY, 'true');
        }
        else if (commitNo.checked) {
            localStorage.setItem(COMMIT_KEY, 'false');
        }
        else {
            localStorage.removeItem(COMMIT_KEY);
        }
        let firstSetAt = parseInt(localStorage.getItem(COMMIT_TIME_KEY) || '0', 10);
        if (!firstSetAt && (commitYes.checked || commitNo.checked)) {
            firstSetAt = currentTime();
            localStorage.setItem(COMMIT_TIME_KEY, String(firstSetAt));
            scheduleLock(firstSetAt, [commitYes, commitNo]);
        }
    };
    commitYes.addEventListener('change', handleCommitChange);
    commitNo.addEventListener('change', handleCommitChange);
    const handleHeldChange = (ev) => {
        const target = ev.target;
        if (target === heldYes && heldYes.checked) {
            heldNo.checked = false;
        }
        else if (target === heldNo && heldNo.checked) {
            heldYes.checked = false;
        }
        if (heldYes.checked) {
            localStorage.setItem(HELD_KEY, 'true');
        }
        else if (heldNo.checked) {
            localStorage.setItem(HELD_KEY, 'false');
        }
        else {
            localStorage.removeItem(HELD_KEY);
        }
        if (awaitingHeld) {
            const firstSetAt = parseInt(localStorage.getItem(COMMIT_TIME_KEY) || '0', 10);
            if (heldYes.checked) {
                recordSuccess(firstSetAt);
            }
            else if (heldNo.checked) {
                recordFailure(firstSetAt);
            }
            resetSelections();
            awaitingHeld = false;
            if (successContainer) {
                successContainer.innerHTML = '';
                const successes = JSON.parse(localStorage.getItem(HELD_SUCCESS_KEY) || '[]');
                const failures = JSON.parse(localStorage.getItem(HELD_FAILURE_KEY) || '[]');
                renderSuccesses(successContainer, successes, failures);
            }
        }
    };
    heldYes.addEventListener('change', handleHeldChange);
    heldNo.addEventListener('change', handleHeldChange);
    if (isAdmin) {
        const adminDiv = document.createElement('div');
        const nextBtn = document.createElement('button');
        nextBtn.id = 'admin-next-day';
        nextBtn.textContent = 'Next Day';
        nextBtn.addEventListener('click', () => {
            adjustDay(1);
            location.reload();
        });
        const prevBtn = document.createElement('button');
        prevBtn.id = 'admin-prev-day';
        prevBtn.textContent = 'Previous Day';
        prevBtn.addEventListener('click', () => {
            adjustDay(-1);
            location.reload();
        });
        const clearBtn = document.createElement('button');
        clearBtn.id = 'admin-clear-data';
        clearBtn.textContent = 'Clear Data';
        clearBtn.addEventListener('click', () => {
            localStorage.clear();
            location.reload();
        });
        adminDiv.appendChild(prevBtn);
        adminDiv.appendChild(nextBtn);
        adminDiv.appendChild(clearBtn);
        document.body.appendChild(adminDiv);
    }
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
}
else {
    setup();
}
export { isSameDay }; // for testing
export function adjustDay(days) {
    const offset = getOffset() + days;
    localStorage.setItem(ADMIN_OFFSET_KEY, String(offset));
}
