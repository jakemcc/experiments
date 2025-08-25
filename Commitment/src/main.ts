const COMMIT_KEY = 'commitToggle';
const COMMIT_TIME_KEY = 'commitFirstSetAt';
const HELD_KEY = 'heldToggle';
const LOCK_DURATION_MS = 30 * 1000;

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function updateLabel(toggle: HTMLInputElement, label: HTMLElement) {
  label.textContent = toggle.checked ? 'Yes' : 'No';
}

function scheduleLock(firstSetAt: number, toggle: HTMLInputElement) {
  const remaining = LOCK_DURATION_MS - (Date.now() - firstSetAt);
  if (remaining <= 0) {
    toggle.disabled = true;
  } else {
    setTimeout(() => {
      toggle.disabled = true;
    }, remaining);
  }
}

export function setup() {
  const commitToggle = document.getElementById('commit-toggle') as HTMLInputElement;
  const commitLabel = document.getElementById('commit-label') as HTMLElement;
  const heldToggle = document.getElementById('held-toggle') as HTMLInputElement;
  const heldLabel = document.getElementById('held-label') as HTMLElement;

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
    commitToggle.checked = savedCommit === 'true';
    updateLabel(commitToggle, commitLabel);
    const firstSetAt = parseInt(localStorage.getItem(COMMIT_TIME_KEY) || '0', 10);
    scheduleLock(firstSetAt, commitToggle);
  }

  const savedHeld = localStorage.getItem(HELD_KEY);
  if (savedHeld !== null) {
    heldToggle.checked = savedHeld === 'true';
    updateLabel(heldToggle, heldLabel);
  }

  commitToggle.addEventListener('change', () => {
    updateLabel(commitToggle, commitLabel);
    localStorage.setItem(COMMIT_KEY, String(commitToggle.checked));
    let firstSetAt = parseInt(localStorage.getItem(COMMIT_TIME_KEY) || '0', 10);
    if (!firstSetAt) {
      firstSetAt = Date.now();
      localStorage.setItem(COMMIT_TIME_KEY, String(firstSetAt));
      scheduleLock(firstSetAt, commitToggle);
    }
  });

  heldToggle.addEventListener('change', () => {
    updateLabel(heldToggle, heldLabel);
    localStorage.setItem(HELD_KEY, String(heldToggle.checked));
  });
}

document.addEventListener('DOMContentLoaded', setup);

export { isSameDay }; // for testing
