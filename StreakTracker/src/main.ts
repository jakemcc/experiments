const DB_NAME = 'streak-tracker';
const DB_VERSION = 2;
const STORE_NAME = 'dayStates';
const STREAK_STORE = 'streaks';
const STREAK_LIST_KEY = 'names';
const LAST_UPDATED_KEY = 'lastUpdated';
const DATE_KEY_PATTERN = /^\d{4}-\d{1,2}-\d{1,2}$/;
const DAY_KEY_PATTERN = /^([^:]+)::(\d{4}-\d{1,2}-\d{1,2})$/;
const DEFAULT_STREAK_NAME = 'My Streak';

const DAY_STATES = {
  None: 0,
  Red: 1,
  Green: 2,
  Blue: 3,
} as const;

type DayState = (typeof DAY_STATES)[keyof typeof DAY_STATES];

let dbPromise: Promise<IDBDatabase> | null = null;

function buildDayKey(streakName: string, dateKey: string): string {
  return `${encodeURIComponent(streakName)}::${dateKey}`;
}

function parseDayKey(key: string): { streak: string; dateKey: string } | null {
  const match = key.match(DAY_KEY_PATTERN);
  if (!match) {
    return null;
  }
  return { streak: decodeURIComponent(match[1]), dateKey: match[2] };
}

function parseDateKey(dateKey: string): { year: number; month: number; day: number } | null {
  if (!DATE_KEY_PATTERN.test(dateKey)) {
    return null;
  }
  const [yearStr, monthStr, dayStr] = dateKey.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if ([year, month, day].some((value) => Number.isNaN(value))) {
    return null;
  }
  return { year, month, day };
}

function dateKeyToTime(dateKey: string): number | null {
  const parsed = parseDateKey(dateKey);
  if (!parsed) {
    return null;
  }
  const time = new Date(parsed.year, parsed.month - 1, parsed.day).getTime();
  return Number.isNaN(time) ? null : time;
}

function getLatestStateTimestamp(stateMap: Map<string, DayState>): number {
  let latest = Number.NEGATIVE_INFINITY;
  stateMap.forEach((_, dateKey) => {
    const time = dateKeyToTime(dateKey);
    if (time !== null && time > latest) {
      latest = time;
    }
  });
  return latest;
}

function getMostRecentlyUpdatedStreak(
  streakStates: Map<string, Map<string, DayState>>,
  lastUpdated: Map<string, number>,
  fallbackNames: string[],
): string | null {
  let latestName: string | null = null;
  let latestTimestamp = Number.NEGATIVE_INFINITY;

  lastUpdated.forEach((timestamp, name) => {
    if (timestamp >= latestTimestamp) {
      latestTimestamp = timestamp;
      latestName = name;
    }
  });

  streakStates.forEach((stateMap, name) => {
    const latest = getLatestStateTimestamp(stateMap);
    if (latest >= latestTimestamp) {
      latestTimestamp = latest;
      latestName = name;
    }
  });

  if (latestName !== null) {
    return latestName;
  }

  for (let i = fallbackNames.length - 1; i >= 0; i -= 1) {
    const name = normalizeStreakName(fallbackNames[i]);
    if (name) {
      return name;
    }
  }

  const first = streakStates.keys().next();
  return first.done ? null : first.value;
}

function getHashStreak(): string | null {
  if (typeof window === 'undefined' || !window.location) {
    return null;
  }
  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) {
    return null;
  }
  try {
    return decodeURIComponent(hash);
  } catch {
    return hash;
  }
}

function setHashStreak(streakName: string): void {
  if (typeof window === 'undefined' || !window.location) {
    return;
  }
  window.location.hash = encodeURIComponent(streakName);
}

export function generateCalendar(year: number, month: number): (number | null)[] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = Array(42).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells[firstDay + day - 1] = day;
  }
  return cells;
}

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
      if (!db.objectStoreNames.contains(STREAK_STORE)) {
        db.createObjectStore(STREAK_STORE);
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

function transactionDone(tx: IDBTransaction, errorMessage: string): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    const fail = () => reject(tx.error ?? new Error(errorMessage));
    tx.onabort = fail;
    tx.onerror = fail;
  });
}

async function getStoredStreakNames(db: IDBDatabase): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STREAK_STORE, 'readonly');
    const store = tx.objectStore(STREAK_STORE);
    const request = store.get(STREAK_LIST_KEY);
    request.onsuccess = () => {
      const result = request.result;
      if (Array.isArray(result)) {
        resolve(result.filter((item) => typeof item === 'string'));
      } else {
        resolve([]);
      }
    };
    request.onerror = () => {
      reject(request.error ?? new Error('Failed to load streak names'));
    };
  });
}

async function saveStreakNames(db: IDBDatabase, names: string[]): Promise<void> {
  const tx = db.transaction(STREAK_STORE, 'readwrite');
  const store = tx.objectStore(STREAK_STORE);
  store.put(names, STREAK_LIST_KEY);
  await transactionDone(tx, 'Failed to save streak names');
}

function normalizeStreakName(name: string): string {
  return name.trim() || DEFAULT_STREAK_NAME;
}

async function getLastUpdatedMap(db: IDBDatabase): Promise<Map<string, number>> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STREAK_STORE, 'readonly');
    const store = tx.objectStore(STREAK_STORE);
    const request = store.get(LAST_UPDATED_KEY);
    request.onsuccess = () => {
      const result = request.result;
      if (Array.isArray(result)) {
        const entries = result.filter(
          (entry): entry is [string, number] =>
            Array.isArray(entry) &&
            entry.length === 2 &&
            typeof entry[0] === 'string' &&
            typeof entry[1] === 'number',
        );
        resolve(new Map(entries));
      } else {
        resolve(new Map());
      }
    };
    request.onerror = () => {
      reject(request.error ?? new Error('Failed to read last updated streaks'));
    };
  });
}

async function saveLastUpdatedMap(
  db: IDBDatabase,
  lastUpdated: Map<string, number>,
): Promise<void> {
  const tx = db.transaction(STREAK_STORE, 'readwrite');
  const store = tx.objectStore(STREAK_STORE);
  store.put(Array.from(lastUpdated.entries()), LAST_UPDATED_KEY);
  await transactionDone(tx, 'Failed to save last updated streaks');
}

async function recordStreakActivity(
  db: IDBDatabase,
  lastUpdated: Map<string, number>,
  streakName: string,
  timestamp: number = Date.now(),
): Promise<void> {
  lastUpdated.set(streakName, timestamp);
  await saveLastUpdatedMap(db, lastUpdated);
}

async function moveLastUpdatedEntry(
  db: IDBDatabase,
  lastUpdated: Map<string, number>,
  oldName: string,
  newName: string,
): Promise<void> {
  const previous = lastUpdated.get(oldName);
  lastUpdated.delete(oldName);
  const existing = lastUpdated.get(newName);
  const nextTimestamp =
    existing !== undefined
      ? Math.max(existing, previous ?? Number.NEGATIVE_INFINITY, Date.now())
      : previous ?? Date.now();
  lastUpdated.set(newName, nextTimestamp);
  await saveLastUpdatedMap(db, lastUpdated);
}

async function migrateFromLocalStorage(db: IDBDatabase): Promise<void> {
  const entries: { key: string; state: DayState }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !DATE_KEY_PATTERN.test(key)) {
      continue;
    }
    const value = localStorage.getItem(key);
    const state = Number(value);
    if (!Number.isFinite(state) || state <= 0 || state > DAY_STATES.Blue) {
      continue;
    }
    entries.push({ key, state: state as DayState });
  }

  if (entries.length === 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const entry of entries) {
      store.put(entry.state, buildDayKey(DEFAULT_STREAK_NAME, entry.key));
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

async function migrateUnscopedDayStates(db: IDBDatabase): Promise<void> {
  const legacyEntries: { key: string; state: DayState }[] = [];

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.openCursor();
    request.onerror = () => {
      reject(request.error ?? new Error('Failed to read state'));
    };
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor) {
        if (typeof cursor.key === 'string' && typeof cursor.value === 'number') {
          if (DATE_KEY_PATTERN.test(cursor.key)) {
            const state = cursor.value;
            if (state > DAY_STATES.None && state <= DAY_STATES.Blue) {
              legacyEntries.push({ key: cursor.key, state: state as DayState });
            }
          }
        }
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => {
      reject(tx.error ?? new Error('Failed to read state'));
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error('Failed to read state'));
    };
  });

  if (legacyEntries.length === 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const entry of legacyEntries) {
      store.delete(entry.key);
      store.put(entry.state, buildDayKey(DEFAULT_STREAK_NAME, entry.key));
    }
    tx.oncomplete = () => resolve();
    tx.onabort = () => {
      reject(tx.error ?? new Error('Failed to migrate state'));
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error('Failed to migrate state'));
    };
  });
}

async function getAllDayStates(
  db: IDBDatabase,
): Promise<{ streakStates: Map<string, Map<string, DayState>>; streakNames: Set<string> }>
{
  const streakStates = new Map<string, Map<string, DayState>>();
  const streakNames = new Set<string>();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.openCursor();
    request.onerror = () => {
      reject(request.error ?? new Error('Failed to read state'));
    };
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor) {
        if (typeof cursor.value === 'number' && typeof cursor.key === 'string') {
          const parsed = parseDayKey(cursor.key);
          if (parsed) {
            streakNames.add(parsed.streak);
            const streakMap = streakStates.get(parsed.streak) ?? new Map<string, DayState>();
            const state = cursor.value;
            if (state > DAY_STATES.None && state <= DAY_STATES.Blue) {
              streakMap.set(parsed.dateKey, state as DayState);
            }
            streakStates.set(parsed.streak, streakMap);
          }
        }
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => {
      reject(tx.error ?? new Error('Failed to read state'));
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error('Failed to read state'));
    };
  });

  return { streakStates, streakNames };
}

async function setDayState(
  db: IDBDatabase,
  streakName: string,
  dateKey: string,
  state: DayState,
): Promise<void> {
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  store.put(state, buildDayKey(streakName, dateKey));
  await transactionDone(tx, 'Failed to save state');
}

async function removeDayState(db: IDBDatabase, streakName: string, dateKey: string): Promise<void> {
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  store.delete(buildDayKey(streakName, dateKey));
  await transactionDone(tx, 'Failed to remove state');
}

async function removeAllDayStates(db: IDBDatabase, streakName: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.openCursor();
    request.onerror = () => {
      reject(request.error ?? new Error('Failed to read state'));
    };
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor) {
        if (typeof cursor.key === 'string') {
          const parsed = parseDayKey(cursor.key);
          if (parsed && parsed.streak === streakName) {
            cursor.delete();
          }
        }
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => {
      reject(tx.error ?? new Error('Failed to remove streak data'));
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error('Failed to remove streak data'));
    };
  });
}

async function deleteStreak(
  db: IDBDatabase,
  streakStates: Map<string, Map<string, DayState>>,
  lastUpdated: Map<string, number>,
  streakNames: string[],
  streakName: string,
): Promise<string[]> {
  const normalized = normalizeStreakName(streakName);
  await removeAllDayStates(db, normalized);
  streakStates.delete(normalized);
  const nextNames = streakNames.filter((name) => name !== normalized);
  await saveStreakNames(db, nextNames);
  if (lastUpdated.has(normalized)) {
    lastUpdated.delete(normalized);
    await saveLastUpdatedMap(db, lastUpdated);
  }
  return nextNames;
}

async function renameStreak(
  db: IDBDatabase,
  streakStates: Map<string, Map<string, DayState>>,
  streakNames: string[],
  oldName: string,
  desiredName: string,
): Promise<{ names: string[]; selected: string }> {
  const currentName = normalizeStreakName(oldName);
  const newName = normalizeStreakName(desiredName);
  if (currentName === newName) {
    return { names: streakNames, selected: currentName };
  }

  const oldStates = streakStates.get(currentName) ?? new Map<string, DayState>();
  const mergedStates = new Map<string, DayState>(
    streakStates.get(newName) ?? new Map<string, DayState>(),
  );
  oldStates.forEach((state, dateKey) => {
    if (!mergedStates.has(dateKey)) {
      mergedStates.set(dateKey, state);
    }
  });

  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  oldStates.forEach((_, dateKey) => {
    store.delete(buildDayKey(currentName, dateKey));
  });
  mergedStates.forEach((state, dateKey) => {
    store.put(state, buildDayKey(newName, dateKey));
  });
  await transactionDone(tx, 'Failed to rename streak data');

  streakStates.set(newName, mergedStates);
  streakStates.delete(currentName);

  const currentIndex = streakNames.findIndex((name) => name === currentName);
  const withoutOld = streakNames.filter((name) => name !== currentName);
  const nextNames = withoutOld.includes(newName)
    ? withoutOld
    : (() => {
        const updated = [...withoutOld];
        if (currentIndex >= 0 && currentIndex <= updated.length) {
          updated.splice(currentIndex, 0, newName);
        } else {
          updated.push(newName);
        }
        return updated;
      })();

  await saveStreakNames(db, nextNames);

  return { names: nextNames, selected: newName };
}

function getStoredMonths(
  now: Date,
  stateMap: Map<string, DayState>,
): { year: number; month: number }[] {
  const months = new Set<string>();
  stateMap.forEach((_, key) => {
    const [yearStr, monthStr] = key.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    if (!Number.isNaN(year) && !Number.isNaN(month)) {
      months.add(`${year}-${month}`);
    }
  });
  months.add(`${now.getFullYear()}-${now.getMonth() + 1}`);
  return Array.from(months).map((str) => {
    const [yearStr, monthStr] = str.split('-');
    return { year: Number(yearStr), month: Number(monthStr) };
  });
}

export async function clearAllStoredDaysForTests(): Promise<void> {
  const db = await getDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();
    request.onerror = () => {
      reject(request.error ?? new Error('Failed to clear store'));
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => {
      reject(tx.error ?? new Error('Failed to clear store'));
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error('Failed to clear store'));
    };
  });

  if (db.objectStoreNames.contains(STREAK_STORE)) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STREAK_STORE, 'readwrite');
      const store = tx.objectStore(STREAK_STORE);
      const request = store.clear();
      request.onerror = () => {
        reject(request.error ?? new Error('Failed to clear streak store'));
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => {
        reject(tx.error ?? new Error('Failed to clear streak store'));
      };
      tx.onerror = () => {
        reject(tx.error ?? new Error('Failed to clear streak store'));
      };
    });
  }
}

function renderStreakControls(
  controlsContainer: HTMLElement,
  streakNames: string[],
  selectedStreak: string,
  onSelect: (name: string) => void,
  onCreate: (name: string) => void,
  onRename: (name: string) => void,
  onDelete: () => void,
): void {
  controlsContainer.innerHTML = '';
  controlsContainer.classList.add('streak-controls');

  const row = document.createElement('div');
  row.className = 'streak-controls__row';

  const pillsWrapper = document.createElement('div');
  pillsWrapper.className = 'streak-pills';
  const pillsLabel = document.createElement('span');
  pillsLabel.className = 'sr-only';
  pillsLabel.id = 'streak-pills-label';
  pillsLabel.textContent = 'Choose a streak';
  pillsWrapper.appendChild(pillsLabel);
  const pillsList = document.createElement('div');
  pillsList.className = 'streak-pills__list';
  pillsList.setAttribute('role', 'group');
  pillsList.setAttribute('aria-labelledby', 'streak-pills-label');
  streakNames.forEach((name) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'streak-pill';
    if (name === selectedStreak) {
      button.classList.add('streak-pill--active');
      button.setAttribute('aria-pressed', 'true');
    } else {
      button.setAttribute('aria-pressed', 'false');
    }
    button.textContent = name;
    button.addEventListener('click', () => {
      if (name !== selectedStreak) {
        onSelect(name);
      }
    });
    pillsList.appendChild(button);
  });
  pillsWrapper.appendChild(pillsList);
  const renameButton = document.createElement('button');
  renameButton.type = 'button';
  renameButton.className = 'icon-button streak-rename';
  renameButton.title = 'Rename streak';
  renameButton.setAttribute('aria-label', 'Rename selected streak');
  renameButton.textContent = '✎';
  renameButton.addEventListener('click', () => {
    const proposed = prompt('Rename streak', selectedStreak);
    if (proposed !== null) {
      onRename(proposed);
    }
  });
  pillsWrapper.appendChild(renameButton);

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'icon-button streak-delete';
  deleteButton.title = 'Delete streak';
  deleteButton.setAttribute('aria-label', 'Delete selected streak');
  deleteButton.textContent = '🗑';
  deleteButton.addEventListener('click', () => {
    onDelete();
  });
  pillsWrapper.appendChild(deleteButton);
  row.appendChild(pillsWrapper);

  const addContainer = document.createElement('div');
  addContainer.className = 'streak-add';
  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'icon-button streak-add__button';
  addButton.textContent = '+';
  addButton.title = 'Create new streak';
  addButton.setAttribute('aria-label', 'Create new streak');
  addButton.addEventListener('click', () => {
    const proposed = prompt('Create new streak');
    if (proposed === null) {
      return;
    }
    const trimmed = proposed.trim();
    if (!trimmed) {
      return;
    }
    onCreate(trimmed);
  });
  addContainer.appendChild(addButton);
  row.appendChild(addContainer);
  controlsContainer.appendChild(row);
}

function ensureControlsContainer(calendars: HTMLElement): HTMLElement {
  const existing = document.getElementById('streak-controls');
  if (existing) {
    return existing;
  }
  const wrapper = document.createElement('div');
  wrapper.id = 'streak-controls';
  calendars.before(wrapper);
  return wrapper;
}

function renderCalendars(
  container: HTMLElement,
  streakName: string,
  now: Date,
  db: IDBDatabase,
  streakStates: Map<string, Map<string, DayState>>,
  lastUpdated: Map<string, number>,
): void {
  container.innerHTML = '';
  const existingStateMap = streakStates.get(streakName);
  const stateMap = existingStateMap ?? new Map<string, DayState>();
  if (!existingStateMap) {
    streakStates.set(streakName, stateMap);
  }
  const months = getStoredMonths(now, stateMap).sort((a, b) => {
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

    const monthState = new Map<number, DayState>();
    stateMap.forEach((state, key) => {
      const [yStr, mStr, dStr] = key.split('-');
      const y = Number(yStr);
      const m = Number(mStr);
      const d = Number(dStr);
      if (y === year && m === month && !Number.isNaN(d)) {
        monthState.set(d, state);
      }
    });

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
        const state = monthState.get(day) ?? DAY_STATES.None;
        if (state === DAY_STATES.Red) {
          colorCounts.red++;
          currentStreaks.red++;
          currentStreaks.green = 0;
          currentStreaks.blue = 0;
          currentGreenBlueStreak = 0;
          if (currentStreaks.red > longestStreaks.red) {
            longestStreaks.red = currentStreaks.red;
          }
        } else if (state === DAY_STATES.Green) {
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
        } else if (state === DAY_STATES.Blue) {
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
        let state = monthState.get(value) ?? DAY_STATES.None;
        const applyState = (s: DayState) => {
          cell.classList.remove('red', 'green', 'blue');
          if (s === DAY_STATES.Red) {
            cell.classList.add('red');
          } else if (s === DAY_STATES.Green) {
            cell.classList.add('green');
          } else if (s === DAY_STATES.Blue) {
            cell.classList.add('blue');
          }
        };
        applyState(state);
        cell.addEventListener('click', async () => {
          state = ((state + 1) % 4) as DayState;
          applyState(state);
          if (state === DAY_STATES.None) {
            monthState.delete(value);
            stateMap.delete(dateKey);
            try {
              await removeDayState(db, streakName, dateKey);
            } catch (error) {
              console.error('Failed to remove day state', error);
            }
          } else {
            monthState.set(value, state);
            stateMap.set(dateKey, state);
            try {
              await setDayState(db, streakName, dateKey, state);
            } catch (error) {
              console.error('Failed to save day state', error);
            }
          }
          try {
            await recordStreakActivity(db, lastUpdated, streakName);
          } catch (error) {
            console.error('Failed to update streak activity', error);
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

export async function setup(): Promise<void> {
  void requestPersistentStorage();
  const container = document.getElementById('calendars');
  if (!container) {
    return;
  }

  const controls = ensureControlsContainer(container);
  controls.innerHTML = '';
  container.innerHTML = '';

  const now = new Date();
  const db = await getDb();
  await migrateFromLocalStorage(db);
  await migrateUnscopedDayStates(db);
  const { streakStates, streakNames: streakNamesFromStates } = await getAllDayStates(db);

  let storedNames: string[] = [];
  try {
    storedNames = await getStoredStreakNames(db);
  } catch (error) {
    console.error('Failed to load streak names', error);
  }
  const lastUpdated = await getLastUpdatedMap(db);

  const normalizedStoredNames = storedNames.map(normalizeStreakName);
  const namesSet = new Set<string>();
  normalizedStoredNames.forEach((name) => namesSet.add(name));
  streakNamesFromStates.forEach((name) => namesSet.add(normalizeStreakName(name)));

  const hashStreak = getHashStreak();
  const normalizedHashStreak = hashStreak ? normalizeStreakName(hashStreak) : null;

  let selectedStreak: string;
  if (namesSet.size === 0) {
    if (normalizedHashStreak) {
      namesSet.add(DEFAULT_STREAK_NAME);
      namesSet.add(normalizedHashStreak);
      selectedStreak = normalizedHashStreak;
    } else {
      selectedStreak = DEFAULT_STREAK_NAME;
      namesSet.add(DEFAULT_STREAK_NAME);
    }
  } else if (normalizedHashStreak) {
    selectedStreak = normalizedHashStreak;
    if (!namesSet.has(selectedStreak)) {
      namesSet.add(selectedStreak);
    }
  } else {
    const existingNames = Array.from(namesSet);
    const mostRecent = getMostRecentlyUpdatedStreak(
      streakStates,
      lastUpdated,
      [...normalizedStoredNames, ...Array.from(streakNamesFromStates)],
    );
    const fallbackName =
      mostRecent ?? existingNames[existingNames.length - 1] ?? DEFAULT_STREAK_NAME;
    selectedStreak = normalizeStreakName(fallbackName);
    if (!namesSet.has(selectedStreak)) {
      namesSet.add(selectedStreak);
    }
  }

  let streakNames = Array.from(namesSet);
  streakNames.forEach((name) => {
    if (!streakStates.has(name)) {
      streakStates.set(name, new Map());
    }
  });

  const shouldRecordInitialActivity = !lastUpdated.has(selectedStreak);
  await saveStreakNames(db, streakNames);
  if (shouldRecordInitialActivity) {
    await recordStreakActivity(db, lastUpdated, selectedStreak);
  }
  if (selectedStreak) {
    setHashStreak(selectedStreak);
  }

  const renderControls = () => {
    renderStreakControls(
      controls,
      streakNames,
      selectedStreak,
      (name) => {
        selectedStreak = normalizeStreakName(name);
        setHashStreak(selectedStreak);
        renderCalendars(container, selectedStreak, now, db, streakStates, lastUpdated);
        renderControls();
      },
      async (rawName) => {
        const name = normalizeStreakName(rawName);
        if (!streakNames.includes(name)) {
          streakNames = [...streakNames, name];
          streakStates.set(name, streakStates.get(name) ?? new Map());
          await saveStreakNames(db, streakNames);
        }
        selectedStreak = name;
        setHashStreak(selectedStreak);
        await recordStreakActivity(db, lastUpdated, selectedStreak);
        renderCalendars(container, selectedStreak, now, db, streakStates, lastUpdated);
        renderControls();
      },
      async (rawName) => {
        const trimmed = rawName.trim();
        if (!trimmed) {
          return;
        }
        try {
          const name = normalizeStreakName(trimmed);
          const previousName = selectedStreak;
          const result = await renameStreak(db, streakStates, streakNames, selectedStreak, name);
          await moveLastUpdatedEntry(db, lastUpdated, previousName, result.selected);
          streakNames = result.names;
          selectedStreak = result.selected;
          setHashStreak(selectedStreak);
          renderCalendars(container, selectedStreak, now, db, streakStates, lastUpdated);
          renderControls();
        } catch (error) {
          console.error('Failed to rename streak', error);
        }
      },
      async () => {
        if (!selectedStreak) {
          return;
        }
        const confirmed = window.confirm(
          `Delete streak "${selectedStreak}"? This removes all data.`,
        );
        if (!confirmed) {
          return;
        }
        try {
          streakNames = await deleteStreak(db, streakStates, lastUpdated, streakNames, selectedStreak);

          if (streakNames.length === 0) {
            lastUpdated.clear();
            await saveLastUpdatedMap(db, lastUpdated);
            streakStates.clear();
            selectedStreak = DEFAULT_STREAK_NAME;
            streakStates.set(selectedStreak, new Map());
            streakNames = [selectedStreak];
            await saveStreakNames(db, streakNames);
            await recordStreakActivity(db, lastUpdated, selectedStreak);
          } else {
            const next = getMostRecentlyUpdatedStreak(
              streakStates,
              lastUpdated,
              streakNames,
            );
            selectedStreak = next ?? normalizeStreakName(streakNames[0]);
            if (!lastUpdated.has(selectedStreak)) {
              await recordStreakActivity(db, lastUpdated, selectedStreak);
            }
          }

          setHashStreak(selectedStreak);
          renderCalendars(container, selectedStreak, now, db, streakStates, lastUpdated);
          renderControls();
        } catch (error) {
          console.error('Failed to delete streak', error);
        }
      },
    );
  };

  renderControls();
  renderCalendars(container, selectedStreak, now, db, streakStates, lastUpdated);
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
