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

const DB_NAME = 'commitment-app';
const DB_VERSION = 1;
const STORE_NAME = 'settings';
const STORAGE_KEYS = [
  COMMIT_KEY,
  COMMIT_TIME_KEY,
  HELD_KEY,
  HELD_SUCCESS_KEY,
  HELD_FAILURE_KEY,
  ADMIN_OFFSET_KEY,
];

let dbPromise: Promise<IDBDatabase> | null = null;
const storageCache = new Map<string, string>();
let storageLoaded = false;

async function requestPersistentStorage(): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return;
  }
  try {
    await navigator.storage.persist();
  } catch (error) {
    console.warn('Persistent storage request failed:', error);
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
      };
      resolve(db);
    };
    request.onerror = () => {
      reject(request.error ?? new Error('Failed to open database'));
    };
  });
}

function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openDatabase();
  }
  return dbPromise;
}

async function migrateFromLocalStorage(db: IDBDatabase): Promise<void> {
  const entries: { key: string; value: string }[] = [];
  for (const key of STORAGE_KEYS) {
    const value = localStorage.getItem(key);
    if (value !== null) {
      entries.push({ key, value });
    }
  }
  if (entries.length === 0) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const entry of entries) {
      store.put(entry.value, entry.key);
    }
    tx.oncomplete = () => {
      for (const entry of entries) {
        localStorage.removeItem(entry.key);
      }
      resolve();
    };
    tx.onabort = () => {
      reject(tx.error ?? new Error('Migration aborted'));
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error('Migration failed'));
    };
  });
}

async function readAllValues(db: IDBDatabase): Promise<Map<string, string>> {
  const values = new Map<string, string>();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.openCursor();
    request.onerror = () => {
      reject(request.error ?? new Error('Failed to read values'));
    };
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor) {
        if (typeof cursor.value === 'string') {
          values.set(cursor.key as string, cursor.value);
        }
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => {
      reject(tx.error ?? new Error('Failed to read values'));
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error('Failed to read values'));
    };
  });
  return values;
}

async function loadStorageCache(): Promise<void> {
  const db = await getDb();
  await migrateFromLocalStorage(db);
  const values = await readAllValues(db);
  storageCache.clear();
  values.forEach((value, key) => {
    storageCache.set(key, value);
  });
  storageLoaded = true;
}

async function ensureStorageLoaded(): Promise<void> {
  if (!storageLoaded) {
    await loadStorageCache();
  }
}

function getStoredValue(key: string): string | null {
  return storageCache.has(key) ? storageCache.get(key)! : null;
}

async function setStoredValue(key: string, value: string | null): Promise<void> {
  await ensureStorageLoaded();
  if (value === null) {
    storageCache.delete(key);
  } else {
    storageCache.set(key, value);
  }
  const db = await getDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = value === null ? store.delete(key) : store.put(value, key);
    request.onerror = () => {
      reject(request.error ?? new Error('Failed to persist value'));
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => {
      reject(tx.error ?? new Error('Failed to persist value'));
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error('Failed to persist value'));
    };
  });
}

async function clearAllStoredValues(): Promise<void> {
  const db = await getDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();
    request.onerror = () => {
      reject(request.error ?? new Error('Failed to clear storage'));
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => {
      reject(tx.error ?? new Error('Failed to clear storage'));
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error('Failed to clear storage'));
    };
  });
  storageCache.clear();
  storageLoaded = false;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function getOffset(): number {
  const raw = getStoredValue(ADMIN_OFFSET_KEY);
  if (!raw) {
    return 0;
  }
  const offset = parseInt(raw, 10);
  return Number.isNaN(offset) ? 0 : offset;
}

function currentTime(): number {
  return Date.now() + getOffset() * DAY_MS;
}

function currentDate(): Date {
  return new Date(currentTime());
}

function getAppDay(date: Date): number {
  const adjusted = new Date(date);
  adjusted.setHours(adjusted.getHours() - DAY_CUTOFF_HOUR, 0, 0, 0);
  return Math.floor(adjusted.getTime() / DAY_MS);
}

function getAppDateParts(date: Date): { year: number; month: number; day: number } {
  const adjusted = new Date(date.getTime() - DAY_CUTOFF_HOUR * 60 * 60 * 1000);
  return {
    year: adjusted.getUTCFullYear(),
    month: adjusted.getUTCMonth() + 1,
    day: adjusted.getUTCDate(),
  };
}

function getDateKey(date: Date): string {
  const { year, month, day } = getAppDateParts(date);
  return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function scheduleLock(firstSetAt: number, inputs: HTMLInputElement[]) {
  const disableInputs = () => inputs.forEach((r) => {
    r.disabled = true;
  });
  const remaining = LOCK_DURATION_MS - (currentTime() - firstSetAt);
  if (remaining <= 0) {
    disableInputs();
  } else {
    setTimeout(disableInputs, remaining);
  }
}

function renderSuccesses(container: HTMLElement, successes: string[], failures: string[]) {
  const today = currentDate();
  for (let i = VISUAL_DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const dateStr = getDateKey(d);
    const wrapper = document.createElement('div');
    wrapper.className = 'day-container';

    const square = document.createElement('div');
    square.className = 'day';
    if (i === 0) {
      square.classList.add('current');
    }
    if (successes.includes(dateStr)) {
      square.classList.add('success');
    } else if (failures.includes(dateStr)) {
      square.classList.add('failure');
    }
    wrapper.appendChild(square);

    const label = document.createElement('div');
    label.className = 'day-date';
    const dateParts = getAppDateParts(d);
    label.textContent = `${dateParts.month}/${dateParts.day}`;
    wrapper.appendChild(label);

    container.appendChild(wrapper);
  }
}

export async function setup(): Promise<void> {
  void requestPersistentStorage();
  const params = new URLSearchParams(window.location.search);
  const isAdmin = params.get('admin') === 'true';

  await loadStorageCache();

  if (!isAdmin) {
    await setStoredValue(ADMIN_OFFSET_KEY, null);
  }

  const commitYes = document.getElementById('commit-yes') as HTMLInputElement;
  const commitNo = document.getElementById('commit-no') as HTMLInputElement;
  const heldYes = document.getElementById('held-yes') as HTMLInputElement;
  const heldNo = document.getElementById('held-no') as HTMLInputElement;
  const heldPrompt = document.getElementById('held-prompt') as HTMLElement | null;
  const successContainer = document.getElementById('success-visual');

  if (!commitYes || !commitNo || !heldYes || !heldNo) {
    return;
  }

  const recordSuccess = async (firstSetAt: number) => {
    const successes = JSON.parse(getStoredValue(HELD_SUCCESS_KEY) || '[]');
    const failures = JSON.parse(getStoredValue(HELD_FAILURE_KEY) || '[]');
    const dateStr = getDateKey(new Date(firstSetAt));
    if (!successes.includes(dateStr)) {
      successes.push(dateStr);
      await setStoredValue(HELD_SUCCESS_KEY, JSON.stringify(successes));
    }
    if (failures.includes(dateStr)) {
      const nextFailures = failures.filter((date: string) => date !== dateStr);
      await setStoredValue(HELD_FAILURE_KEY, JSON.stringify(nextFailures));
    }
  };

  const recordFailure = async (firstSetAt: number) => {
    const successes = JSON.parse(getStoredValue(HELD_SUCCESS_KEY) || '[]');
    const failures = JSON.parse(getStoredValue(HELD_FAILURE_KEY) || '[]');
    const dateStr = getDateKey(new Date(firstSetAt));
    if (!failures.includes(dateStr)) {
      failures.push(dateStr);
      await setStoredValue(HELD_FAILURE_KEY, JSON.stringify(failures));
    }
    if (successes.includes(dateStr)) {
      const nextSuccesses = successes.filter((date: string) => date !== dateStr);
      await setStoredValue(HELD_SUCCESS_KEY, JSON.stringify(nextSuccesses));
    }
  };

  const resetSelections = async () => {
    commitYes.checked = false;
    commitNo.checked = false;
    heldYes.checked = false;
    heldNo.checked = false;
    commitYes.disabled = false;
    commitNo.disabled = false;
    await Promise.all([
      setStoredValue(COMMIT_KEY, null),
      setStoredValue(COMMIT_TIME_KEY, null),
      setStoredValue(HELD_KEY, null),
    ]);
    if (heldPrompt) {
      heldPrompt.textContent = '';
      heldPrompt.hidden = true;
    }
  };

  let awaitingHeld = false;

  const firstSetRaw = getStoredValue(COMMIT_TIME_KEY);
  if (firstSetRaw) {
    const firstSetAt = parseInt(firstSetRaw, 10);
    const firstDate = new Date(firstSetAt);
    const now = currentDate();
    const diffDays = getAppDay(now) - getAppDay(firstDate);
    if (diffDays === 1) {
      const held = getStoredValue(HELD_KEY);
      if (held === null) {
        awaitingHeld = true;
        if (heldPrompt) {
          heldPrompt.textContent = 'Please record whether you held your commitment yesterday.';
          heldPrompt.hidden = false;
        }
      } else {
        if (held === 'true') {
          await recordSuccess(firstSetAt);
        } else if (held === 'false') {
          await recordFailure(firstSetAt);
        }
        await resetSelections();
      }
    } else if (diffDays > 1) {
      alert('It has been a while since your last visit. Please open the app more often.');
      await resetSelections();
    }
  }

  const savedCommit = getStoredValue(COMMIT_KEY);
  if (savedCommit !== null) {
    if (savedCommit === 'true') {
      commitYes.checked = true;
    } else {
      commitNo.checked = true;
    }
    const firstSetAt = parseInt(getStoredValue(COMMIT_TIME_KEY) || '0', 10);
    if (firstSetAt) {
      scheduleLock(firstSetAt, [commitYes, commitNo]);
    }
  }

  const savedHeld = getStoredValue(HELD_KEY);
  if (savedHeld !== null) {
    if (savedHeld === 'true') {
      heldYes.checked = true;
    } else {
      heldNo.checked = true;
    }
  }

  if (successContainer) {
    const successes = JSON.parse(getStoredValue(HELD_SUCCESS_KEY) || '[]');
    const failures = JSON.parse(getStoredValue(HELD_FAILURE_KEY) || '[]');
    successContainer.innerHTML = '';
    renderSuccesses(successContainer, successes, failures);
  }

  const handleCommitChange = async (ev: Event) => {
    const target = ev.target as HTMLInputElement;
    if (target === commitYes && commitYes.checked) {
      commitNo.checked = false;
    } else if (target === commitNo && commitNo.checked) {
      commitYes.checked = false;
    }

    if (commitYes.checked) {
      await setStoredValue(COMMIT_KEY, 'true');
    } else if (commitNo.checked) {
      await setStoredValue(COMMIT_KEY, 'false');
    } else {
      await setStoredValue(COMMIT_KEY, null);
    }

    let firstSetAt = parseInt(getStoredValue(COMMIT_TIME_KEY) || '0', 10);
    if (!firstSetAt && (commitYes.checked || commitNo.checked)) {
      firstSetAt = currentTime();
      await setStoredValue(COMMIT_TIME_KEY, String(firstSetAt));
      scheduleLock(firstSetAt, [commitYes, commitNo]);
    }
  };

  commitYes.addEventListener('change', (event) => {
    void handleCommitChange(event);
  });
  commitNo.addEventListener('change', (event) => {
    void handleCommitChange(event);
  });

  const handleHeldChange = async (ev: Event) => {
    const target = ev.target as HTMLInputElement;
    if (target === heldYes && heldYes.checked) {
      heldNo.checked = false;
    } else if (target === heldNo && heldNo.checked) {
      heldYes.checked = false;
    }

    if (heldYes.checked) {
      await setStoredValue(HELD_KEY, 'true');
    } else if (heldNo.checked) {
      await setStoredValue(HELD_KEY, 'false');
    } else {
      await setStoredValue(HELD_KEY, null);
    }

    if (awaitingHeld) {
      const firstSetAt = parseInt(getStoredValue(COMMIT_TIME_KEY) || '0', 10);
      if (heldYes.checked) {
        await recordSuccess(firstSetAt);
      } else if (heldNo.checked) {
        await recordFailure(firstSetAt);
      }
      await resetSelections();
      awaitingHeld = false;
      if (successContainer) {
        successContainer.innerHTML = '';
        const successes = JSON.parse(getStoredValue(HELD_SUCCESS_KEY) || '[]');
        const failures = JSON.parse(getStoredValue(HELD_FAILURE_KEY) || '[]');
        renderSuccesses(successContainer, successes, failures);
      }
    }
  };

  heldYes.addEventListener('change', (event) => {
    void handleHeldChange(event);
  });
  heldNo.addEventListener('change', (event) => {
    void handleHeldChange(event);
  });

  if (isAdmin) {
    const adminDiv = document.createElement('div');
    const nextBtn = document.createElement('button');
    nextBtn.id = 'admin-next-day';
    nextBtn.textContent = 'Next Day';
    nextBtn.addEventListener('click', async () => {
      await adjustDay(1);
      location.reload();
    });
    const prevBtn = document.createElement('button');
    prevBtn.id = 'admin-prev-day';
    prevBtn.textContent = 'Previous Day';
    prevBtn.addEventListener('click', async () => {
      await adjustDay(-1);
      location.reload();
    });
    const clearBtn = document.createElement('button');
    clearBtn.id = 'admin-clear-data';
    clearBtn.textContent = 'Clear Data';
    clearBtn.addEventListener('click', async () => {
      await clearAllStoredValues();
      localStorage.clear();
      location.reload();
    });
    adminDiv.appendChild(prevBtn);
    adminDiv.appendChild(nextBtn);
    adminDiv.appendChild(clearBtn);
    document.body.appendChild(adminDiv);
  }
}

function registerServiceWorker() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return;
  }
  if (!('serviceWorker' in navigator)) {
    return;
  }

  window.addEventListener('load', () => {
    const swUrl = new URL('service-worker.js', window.location.href);
    navigator.serviceWorker
      ?.register(swUrl.toString())
      .catch((error) => {
        console.error('Service worker registration failed:', error);
      });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void setup();
  });
} else {
  void setup();
}

registerServiceWorker();

export { isSameDay };

export async function adjustDay(days: number): Promise<void> {
  await ensureStorageLoaded();
  const offset = getOffset() + days;
  await setStoredValue(ADMIN_OFFSET_KEY, String(offset));
}

export async function clearAllStoredDataForTests(): Promise<void> {
  await clearAllStoredValues();
}

export async function getStoredValueForTests(key: string): Promise<string | null> {
  await ensureStorageLoaded();
  return getStoredValue(key);
}
