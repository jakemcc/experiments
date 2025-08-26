const COMMIT_KEY = 'commitToggle';
const COMMIT_TIME_KEY = 'commitFirstSetAt';
const HELD_KEY = 'heldToggle';
const HELD_SUCCESS_KEY = 'heldSuccessDates';
const HELD_FAILURE_KEY = 'heldFailureDates';
const LOCK_DURATION_MS = 30 * 1000;
const VISUAL_DAYS = 7;

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function scheduleLock(firstSetAt: number, inputs: HTMLInputElement[]) {
  const disableInputs = () => inputs.forEach(r => r.disabled = true);
  const remaining = LOCK_DURATION_MS - (Date.now() - firstSetAt);
  if (remaining <= 0) {
    disableInputs();
  } else {
    setTimeout(disableInputs, remaining);
  }
}

function renderSuccesses(container: HTMLElement, successes: string[], failures: string[]) {
  const today = new Date();
  for (let i = VISUAL_DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const square = document.createElement('div');
    square.className = 'day';
    if (successes.includes(dateStr)) {
      square.classList.add('success');
    } else if (failures.includes(dateStr)) {
      square.classList.add('failure');
    }
    container.appendChild(square);
  }
}

export function setup() {
  const commitYes = document.getElementById('commit-yes') as HTMLInputElement;
  const commitNo = document.getElementById('commit-no') as HTMLInputElement;
  const heldYes = document.getElementById('held-yes') as HTMLInputElement;
  const heldNo = document.getElementById('held-no') as HTMLInputElement;
  const successContainer = document.getElementById('success-visual');

  if (!commitYes || !commitNo || !heldYes || !heldNo) {
    return;
  }

  const recordSuccess = (firstSetAt: number) => {
    const successes = JSON.parse(localStorage.getItem(HELD_SUCCESS_KEY) || '[]');
    const dateStr = new Date(firstSetAt).toISOString().split('T')[0];
    if (!successes.includes(dateStr)) {
      successes.push(dateStr);
      localStorage.setItem(HELD_SUCCESS_KEY, JSON.stringify(successes));
    }
  };

  const recordFailure = (firstSetAt: number) => {
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
  };

  let awaitingHeld = false;

  // daily reset for commit
  const firstSetRaw = localStorage.getItem(COMMIT_TIME_KEY);
  if (firstSetRaw) {
    const firstSetAt = parseInt(firstSetRaw, 10);
    const firstDate = new Date(firstSetAt);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - firstDate.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays === 1) {
      const held = localStorage.getItem(HELD_KEY);
      if (held === null) {
        awaitingHeld = true;
        alert('Please record whether you held your commitment yesterday.');
      } else {
        if (held === 'true') {
          recordSuccess(firstSetAt);
        } else if (held === 'false') {
          recordFailure(firstSetAt);
        }
        resetSelections();
      }
    } else if (diffDays > 1) {
      alert('It has been a while since your last visit. Please open the app more often.');
      resetSelections();
    }
  }

  const savedCommit = localStorage.getItem(COMMIT_KEY);
  if (savedCommit !== null) {
    if (savedCommit === 'true') {
      commitYes.checked = true;
    } else {
      commitNo.checked = true;
    }
    const firstSetAt = parseInt(localStorage.getItem(COMMIT_TIME_KEY) || '0', 10);
    scheduleLock(firstSetAt, [commitYes, commitNo]);
  }

  const savedHeld = localStorage.getItem(HELD_KEY);
  if (savedHeld !== null) {
    if (savedHeld === 'true') {
      heldYes.checked = true;
    } else {
      heldNo.checked = true;
    }
  }

  if (successContainer) {
    const successes = JSON.parse(localStorage.getItem(HELD_SUCCESS_KEY) || '[]');
    const failures = JSON.parse(localStorage.getItem(HELD_FAILURE_KEY) || '[]');
    renderSuccesses(successContainer, successes, failures);
  }

  const handleCommitChange = (ev: Event) => {
    const target = ev.target as HTMLInputElement;
    if (target === commitYes && commitYes.checked) {
      commitNo.checked = false;
    } else if (target === commitNo && commitNo.checked) {
      commitYes.checked = false;
    }

    if (commitYes.checked) {
      localStorage.setItem(COMMIT_KEY, 'true');
    } else if (commitNo.checked) {
      localStorage.setItem(COMMIT_KEY, 'false');
    } else {
      localStorage.removeItem(COMMIT_KEY);
    }

    let firstSetAt = parseInt(localStorage.getItem(COMMIT_TIME_KEY) || '0', 10);
    if (!firstSetAt && (commitYes.checked || commitNo.checked)) {
      firstSetAt = Date.now();
      localStorage.setItem(COMMIT_TIME_KEY, String(firstSetAt));
      scheduleLock(firstSetAt, [commitYes, commitNo]);
    }
  };

  commitYes.addEventListener('change', handleCommitChange);
  commitNo.addEventListener('change', handleCommitChange);

  const handleHeldChange = (ev: Event) => {
    const target = ev.target as HTMLInputElement;
    if (target === heldYes && heldYes.checked) {
      heldNo.checked = false;
    } else if (target === heldNo && heldNo.checked) {
      heldYes.checked = false;
    }

    if (heldYes.checked) {
      localStorage.setItem(HELD_KEY, 'true');
    } else if (heldNo.checked) {
      localStorage.setItem(HELD_KEY, 'false');
    } else {
      localStorage.removeItem(HELD_KEY);
    }

    if (awaitingHeld) {
      const firstSetAt = parseInt(localStorage.getItem(COMMIT_TIME_KEY) || '0', 10);
      if (heldYes.checked) {
        recordSuccess(firstSetAt);
      } else if (heldNo.checked) {
        recordFailure(firstSetAt);
      }
      resetSelections();
      awaitingHeld = false;
    }
  };

  heldYes.addEventListener('change', handleHeldChange);
  heldNo.addEventListener('change', handleHeldChange);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setup);
} else {
  setup();
}

export { isSameDay }; // for testing
