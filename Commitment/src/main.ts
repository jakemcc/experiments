const COMMIT_KEY = 'commitToggle';
const COMMIT_TIME_KEY = 'commitFirstSetAt';
const HELD_KEY = 'heldToggle';
const LOCK_DURATION_MS = 30 * 1000;

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

export function setup() {
  const commitYes = document.getElementById('commit-yes') as HTMLInputElement;
  const commitNo = document.getElementById('commit-no') as HTMLInputElement;
  const heldYes = document.getElementById('held-yes') as HTMLInputElement;
  const heldNo = document.getElementById('held-no') as HTMLInputElement;

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

  const handleCommitChange = () => {
    if (commitYes.checked) {
      commitNo.checked = false;
    } else if (commitNo.checked) {
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

  const handleHeldChange = () => {
    if (heldYes.checked) {
      heldNo.checked = false;
    } else if (heldNo.checked) {
      heldYes.checked = false;
    }

    if (heldYes.checked) {
      localStorage.setItem(HELD_KEY, 'true');
    } else if (heldNo.checked) {
      localStorage.setItem(HELD_KEY, 'false');
    } else {
      localStorage.removeItem(HELD_KEY);
    }
  };

  heldYes.addEventListener('change', handleHeldChange);
  heldNo.addEventListener('change', handleHeldChange);
}

document.addEventListener('DOMContentLoaded', setup);

export { isSameDay }; // for testing
