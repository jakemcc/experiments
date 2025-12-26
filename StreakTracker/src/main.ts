const DB_NAME = 'streak-tracker';
const DB_VERSION = 2;
const STORE_NAME = 'dayStates';
const STREAK_STORE = 'streaks';
const STREAK_LIST_KEY = 'names';
const STREAK_TYPES_KEY = 'types';
const LAST_UPDATED_KEY = 'lastUpdated';
const DATE_KEY_PATTERN = /^\d{4}-\d{1,2}-\d{1,2}$/;
const DAY_KEY_PATTERN = /^([^:]+)::(\d{4}-\d{1,2}-\d{1,2})$/;
const DEFAULT_STREAK_NAME = 'My Streak';

export const DAY_STATES = {
  None: 0,
  Red: 1,
  Green: 2,
  Blue: 3,
} as const;

export type DayState = (typeof DAY_STATES)[keyof typeof DAY_STATES];
type DayValue = number;
type StreakType = 'color' | 'count';

export const STREAK_TYPES = {
  Color: 'color',
  Count: 'count',
} as const;

export function cycleColorState(state: DayState): DayState {
  return ((state + 1) % 4) as DayState;
}

export function updateCountValue(current: number, delta: number): number {
  const safeCurrent = Number.isFinite(current) ? Math.floor(current) : 0;
  const next = safeCurrent + Math.trunc(delta);
  return Math.max(0, next);
}

export function migrateStreakTypes(
  storedTypes: Map<string, StreakType>,
  streakNames: Iterable<string>,
): { types: Map<string, StreakType>; didChange: boolean } {
  const migrated = new Map(storedTypes);
  let didChange = false;
  for (const name of streakNames) {
    if (!migrated.has(name)) {
      migrated.set(name, STREAK_TYPES.Color);
      didChange = true;
    }
  }
  return { types: migrated, didChange };
}

let dbPromise: Promise<IDBDatabase> | null = null;

function applyDayStateClass(cell: HTMLElement, state: DayState): void {
  cell.classList.remove('red', 'green', 'blue');
  if (state === DAY_STATES.Red) {
    cell.classList.add('red');
  } else if (state === DAY_STATES.Green) {
    cell.classList.add('green');
  } else if (state === DAY_STATES.Blue) {
    cell.classList.add('blue');
  }
}

function computeMonthStats(
  now: Date,
  year: number,
  month: number,
  monthState: Map<number, DayState>,
): string[] {
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
      colorCounts.red += 1;
      currentStreaks.red += 1;
      currentStreaks.green = 0;
      currentStreaks.blue = 0;
      currentGreenBlueStreak = 0;
      if (currentStreaks.red > longestStreaks.red) {
        longestStreaks.red = currentStreaks.red;
      }
    } else if (state === DAY_STATES.Green) {
      colorCounts.green += 1;
      currentStreaks.green += 1;
      currentStreaks.red = 0;
      currentStreaks.blue = 0;
      currentGreenBlueStreak += 1;
      if (currentGreenBlueStreak > longestGreenBlueStreak) {
        longestGreenBlueStreak = currentGreenBlueStreak;
      }
      if (currentStreaks.green > longestStreaks.green) {
        longestStreaks.green = currentStreaks.green;
      }
    } else if (state === DAY_STATES.Blue) {
      colorCounts.blue += 1;
      currentStreaks.blue += 1;
      currentStreaks.red = 0;
      currentStreaks.green = 0;
      currentGreenBlueStreak += 1;
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

  return [
    `Green days: ${colorCounts.green}/${daysPassed}, Longest green streak: ${longestStreaks.green}`,
    `Red days: ${colorCounts.red}/${daysPassed}, Longest red streak: ${longestStreaks.red}`,
    `Blue days: ${colorCounts.blue}/${daysPassed}, Longest blue streak: ${longestStreaks.blue}`,
    `Longest green or blue streak: ${longestGreenBlueStreak}`,
  ];
}

function computeCountStats(
  monthCounts: Map<number, number>,
): string[] {
  const values = Array.from(monthCounts.values());
  return buildCountStats(values);
}

function formatStatValue(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(2);
}

function buildCountStats(values: number[]): string[] {
  if (values.length === 0) {
    return ['Total count: 0', 'Median count: 0', 'Mean count: 0'];
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
      : sorted[midpoint];
  const mean = total / values.length;
  return [
    `Total count: ${formatStatValue(total)}`,
    `Median count: ${formatStatValue(median)}`,
    `Mean count: ${formatStatValue(mean)}`,
  ];
}

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

function getLatestStateTimestamp(stateMap: Map<string, DayValue>): number {
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
  streakStates: Map<string, Map<string, DayValue>>,
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
    const trimmed = trimStreakName(fallbackNames[i]);
    if (trimmed) {
      return trimmed;
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

function storeGet<T>(
  store: IDBObjectStore,
  key: IDBValidKey,
  errorMessage: string,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error ?? new Error(errorMessage));
  });
}

async function getStoredStreakNames(db: IDBDatabase): Promise<string[]> {
  const tx = db.transaction(STREAK_STORE, 'readonly');
  const store = tx.objectStore(STREAK_STORE);
  const result = await storeGet<unknown>(store, STREAK_LIST_KEY, 'Failed to load streak names');
  if (Array.isArray(result)) {
    return result.filter((item): item is string => typeof item === 'string');
  }
  return [];
}

function parseStoredStreakTypes(raw: unknown): Map<string, StreakType> {
  if (!Array.isArray(raw)) {
    return new Map();
  }
  const entries = raw.filter(
    (entry): entry is [string, StreakType] =>
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === 'string' &&
      (entry[1] === STREAK_TYPES.Color || entry[1] === STREAK_TYPES.Count),
  );
  return new Map(entries);
}

async function getStoredStreakTypes(db: IDBDatabase): Promise<Map<string, StreakType>> {
  const tx = db.transaction(STREAK_STORE, 'readonly');
  const store = tx.objectStore(STREAK_STORE);
  const result = await storeGet<unknown>(store, STREAK_TYPES_KEY, 'Failed to load streak types');
  return parseStoredStreakTypes(result);
}

async function saveStreakTypes(db: IDBDatabase, types: Map<string, StreakType>): Promise<void> {
  const tx = db.transaction(STREAK_STORE, 'readwrite');
  const store = tx.objectStore(STREAK_STORE);
  store.put(Array.from(types.entries()), STREAK_TYPES_KEY);
  await transactionDone(tx, 'Failed to save streak types');
}

async function saveStreakNames(db: IDBDatabase, names: string[]): Promise<void> {
  const tx = db.transaction(STREAK_STORE, 'readwrite');
  const store = tx.objectStore(STREAK_STORE);
  store.put(names, STREAK_LIST_KEY);
  await transactionDone(tx, 'Failed to save streak names');
}

function trimStreakName(name: string): string | null {
  const trimmed = name.trim();
  return trimmed ? trimmed : null;
}

function normalizeStreakName(name: string): string {
  return trimStreakName(name) ?? DEFAULT_STREAK_NAME;
}

function buildNamesSet(storedNames: string[], streakNamesFromStates: Set<string>): Set<string> {
  const namesSet = new Set<string>();
  storedNames.map(normalizeStreakName).forEach((name) => namesSet.add(name));
  streakNamesFromStates.forEach((name) => namesSet.add(normalizeStreakName(name)));
  return namesSet;
}

function selectInitialStreak(
  namesSet: Set<string>,
  normalizedHashStreak: string | null,
  streakStates: Map<string, Map<string, DayValue>>,
  lastUpdated: Map<string, number>,
  fallbackNames: string[],
): { selectedStreak: string; namesSet: Set<string> } {
  const nextSet = new Set(namesSet);

  if (nextSet.size === 0) {
    if (normalizedHashStreak) {
      nextSet.add(DEFAULT_STREAK_NAME);
      nextSet.add(normalizedHashStreak);
      return { selectedStreak: normalizedHashStreak, namesSet: nextSet };
    }
    nextSet.add(DEFAULT_STREAK_NAME);
    return { selectedStreak: DEFAULT_STREAK_NAME, namesSet: nextSet };
  }

  if (normalizedHashStreak) {
    nextSet.add(normalizedHashStreak);
    return { selectedStreak: normalizedHashStreak, namesSet: nextSet };
  }

  const existingNames = Array.from(nextSet);
  const mostRecent = getMostRecentlyUpdatedStreak(
    streakStates,
    lastUpdated,
    fallbackNames,
  );
  const fallbackName =
    mostRecent ?? existingNames[existingNames.length - 1] ?? DEFAULT_STREAK_NAME;
  const selectedStreak = normalizeStreakName(fallbackName);
  nextSet.add(selectedStreak);
  return { selectedStreak, namesSet: nextSet };
}

async function getLastUpdatedMap(db: IDBDatabase): Promise<Map<string, number>> {
  const tx = db.transaction(STREAK_STORE, 'readonly');
  const store = tx.objectStore(STREAK_STORE);
  const result = await storeGet<unknown>(store, LAST_UPDATED_KEY, 'Failed to read last updated streaks');
  if (Array.isArray(result)) {
    const entries = result.filter(
      (entry): entry is [string, number] =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === 'string' &&
        typeof entry[1] === 'number',
    );
    return new Map(entries);
  }
  return new Map();
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
): Promise<{ streakStates: Map<string, Map<string, DayValue>>; streakNames: Set<string> }>
{
  const streakStates = new Map<string, Map<string, DayValue>>();
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
            const streakMap = streakStates.get(parsed.streak) ?? new Map<string, DayValue>();
            const state = cursor.value;
            if (Number.isFinite(state) && state > 0) {
              streakMap.set(parsed.dateKey, state);
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
  state: DayValue,
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
  streakStates: Map<string, Map<string, DayValue>>,
  streakTypes: Map<string, StreakType>,
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
  if (streakTypes.has(normalized)) {
    streakTypes.delete(normalized);
    await saveStreakTypes(db, streakTypes);
  }
  return nextNames;
}

async function renameStreak(
  db: IDBDatabase,
  streakStates: Map<string, Map<string, DayValue>>,
  streakTypes: Map<string, StreakType>,
  streakNames: string[],
  oldName: string,
  desiredName: string,
): Promise<{ names: string[]; selected: string }> {
  const currentName = normalizeStreakName(oldName);
  const newName = normalizeStreakName(desiredName);
  if (currentName === newName) {
    return { names: streakNames, selected: currentName };
  }

  const oldStates = streakStates.get(currentName) ?? new Map<string, DayValue>();
  const mergedStates = new Map<string, DayValue>(
    streakStates.get(newName) ?? new Map<string, DayValue>(),
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

  if (!streakTypes.has(newName)) {
    const existingType = streakTypes.get(currentName) ?? STREAK_TYPES.Color;
    streakTypes.set(newName, existingType);
    await saveStreakTypes(db, streakTypes);
  }
  if (currentName !== newName && streakTypes.has(currentName)) {
    streakTypes.delete(currentName);
    await saveStreakTypes(db, streakTypes);
  }

  return { names: nextNames, selected: newName };
}

function getStoredMonths(
  now: Date,
  stateMap: Map<string, DayValue>,
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
  onCreate: (name: string, streakType: StreakType) => void,
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
    const typeResponse = prompt('Choose streak type: Colors or Count', 'Colors');
    if (typeResponse === null) {
      return;
    }
    const normalized = typeResponse.trim().toLowerCase();
    let streakType: StreakType | null = null;
    if (normalized === 'color' || normalized === 'colors') {
      streakType = STREAK_TYPES.Color;
    } else if (normalized === 'count' || normalized === 'counts') {
      streakType = STREAK_TYPES.Count;
    }
    if (!streakType) {
      alert('Please enter "Colors" or "Count" to choose a streak type.');
      return;
    }
    onCreate(trimmed, streakType);
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
  streakStates: Map<string, Map<string, DayValue>>,
  streakTypes: Map<string, StreakType>,
  lastUpdated: Map<string, number>,
): void {
  container.innerHTML = '';
  const existingStateMap = streakStates.get(streakName);
  const stateMap = existingStateMap ?? new Map<string, DayValue>();
  if (!existingStateMap) {
    streakStates.set(streakName, stateMap);
  }
  const streakType = streakTypes.get(streakName) ?? STREAK_TYPES.Color;
  const months = getStoredMonths(now, stateMap).sort((a, b) => {
    if (a.year === b.year) {
      return b.month - a.month;
    }
    return b.year - a.year;
  });
  let overallStats: HTMLParagraphElement | null = null;
  const updateOverallStats = () => {
    if (!overallStats) {
      return;
    }
    const values = Array.from(stateMap.values()).filter((value) => value > 0);
    overallStats.textContent = buildCountStats(values).slice(1).join(' ');
  };
  if (streakType === STREAK_TYPES.Count) {
    overallStats = document.createElement('p');
    overallStats.className = 'stats stats--overall';
    container.appendChild(overallStats);
  }

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
    const monthCounts = new Map<number, number>();
    stateMap.forEach((state, key) => {
      const [yStr, mStr, dStr] = key.split('-');
      const y = Number(yStr);
      const m = Number(mStr);
      const d = Number(dStr);
      if (y === year && m === month && !Number.isNaN(d)) {
        if (streakType === STREAK_TYPES.Color) {
          if (state > DAY_STATES.None && state <= DAY_STATES.Blue) {
            monthState.set(d, state as DayState);
          }
        } else if (state > 0) {
          monthCounts.set(d, Math.floor(state));
        }
      }
    });

    const updateStats = () => {
      if (streakType === STREAK_TYPES.Color) {
        stats.innerHTML = computeMonthStats(now, year, month, monthState).join('<br>');
      } else {
        stats.textContent = computeCountStats(monthCounts).join(' ');
        updateOverallStats();
      }
    };

    const cells = generateCalendar(year, month - 1);
    cells.forEach((value) => {
      const cell = document.createElement('div');
      cell.className = 'day';
      if (value !== null) {
        cell.dataset.day = String(value);
        const dateKey = `${year}-${month}-${value}`;
        if (streakType === STREAK_TYPES.Color) {
          cell.textContent = String(value);
          let state = monthState.get(value) ?? DAY_STATES.None;
          applyDayStateClass(cell, state);
          cell.addEventListener('click', async () => {
            state = cycleColorState(state);
            applyDayStateClass(cell, state);
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
        } else {
          cell.classList.add('day--count');
          const dayLabel = document.createElement('span');
          dayLabel.className = 'day-number';
          dayLabel.textContent = String(value);
          const countValue = document.createElement('div');
          countValue.className = 'day-count__value';
          let count = monthCounts.get(value) ?? 0;
          const updateCountDisplay = () => {
            countValue.textContent = count > 0 ? String(count) : '';
          };
          updateCountDisplay();
          const incrementButton = document.createElement('button');
          incrementButton.type = 'button';
          incrementButton.className = 'day-count__control day-count__control--plus';
          incrementButton.textContent = '+';
          incrementButton.setAttribute('aria-label', 'Increase count');
          const decrementButton = document.createElement('button');
          decrementButton.type = 'button';
          decrementButton.className = 'day-count__control day-count__control--minus';
          decrementButton.textContent = '–';
          decrementButton.setAttribute('aria-label', 'Decrease count');

          const applyCountChange = async (delta: number) => {
            count = updateCountValue(count, delta);
            updateCountDisplay();
            if (count === 0) {
              monthCounts.delete(value);
              stateMap.delete(dateKey);
              try {
                await removeDayState(db, streakName, dateKey);
              } catch (error) {
                console.error('Failed to remove count state', error);
              }
            } else {
              monthCounts.set(value, count);
              stateMap.set(dateKey, count);
              try {
                await setDayState(db, streakName, dateKey, count);
              } catch (error) {
                console.error('Failed to save count state', error);
              }
            }
            try {
              await recordStreakActivity(db, lastUpdated, streakName);
            } catch (error) {
              console.error('Failed to update streak activity', error);
            }
            updateStats();
          };

          incrementButton.addEventListener('click', (event) => {
            event.stopPropagation();
            void applyCountChange(1);
          });
          decrementButton.addEventListener('click', (event) => {
            event.stopPropagation();
            void applyCountChange(-1);
          });

          cell.appendChild(incrementButton);
          cell.appendChild(dayLabel);
          cell.appendChild(countValue);
          cell.appendChild(decrementButton);
        }
      }
      calendar.appendChild(cell);
    });
    section.appendChild(calendar);
    section.appendChild(stats);
    container.appendChild(section);
    updateStats();
  });
  updateOverallStats();
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
  let streakTypes = await getStoredStreakTypes(db);
  const lastUpdated = await getLastUpdatedMap(db);

  const normalizedStoredNames = storedNames.map(normalizeStreakName);
  let namesSet = buildNamesSet(storedNames, streakNamesFromStates);

  const hashStreak = getHashStreak();
  const normalizedHashStreak = hashStreak ? normalizeStreakName(hashStreak) : null;

  const fallbackNames = [
    ...normalizedStoredNames,
    ...Array.from(streakNamesFromStates).map(normalizeStreakName),
  ];
  const initialSelection = selectInitialStreak(
    namesSet,
    normalizedHashStreak,
    streakStates,
    lastUpdated,
    fallbackNames,
  );
  namesSet = initialSelection.namesSet;
  let selectedStreak = initialSelection.selectedStreak;

  const typeMigration = migrateStreakTypes(streakTypes, namesSet);
  streakTypes = typeMigration.types;
  if (typeMigration.didChange) {
    await saveStreakTypes(db, streakTypes);
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

  const setSelectedStreak = (name: string) => {
    selectedStreak = normalizeStreakName(name);
    setHashStreak(selectedStreak);
  };

  const rerenderAll = () => {
    renderCalendars(container, selectedStreak, now, db, streakStates, streakTypes, lastUpdated);
    renderControls();
  };

  const ensureStreakExists = async (name: string, streakType?: StreakType) => {
    if (!streakNames.includes(name)) {
      streakNames = [...streakNames, name];
      streakStates.set(name, streakStates.get(name) ?? new Map());
      await saveStreakNames(db, streakNames);
    }
    if (streakType && streakTypes.get(name) !== streakType) {
      streakTypes.set(name, streakType);
      await saveStreakTypes(db, streakTypes);
    }
  };

  const renderControls = () => {
    renderStreakControls(
      controls,
      streakNames,
      selectedStreak,
      (name) => {
        setSelectedStreak(name);
        rerenderAll();
      },
      async (rawName, streakType) => {
        const name = normalizeStreakName(rawName);
        await ensureStreakExists(name, streakType);
        setSelectedStreak(name);
        await recordStreakActivity(db, lastUpdated, selectedStreak);
        rerenderAll();
      },
      async (rawName) => {
        const trimmed = rawName.trim();
        if (!trimmed) {
          return;
        }
        try {
          const name = normalizeStreakName(trimmed);
          const previousName = selectedStreak;
          const result = await renameStreak(
            db,
            streakStates,
            streakTypes,
            streakNames,
            selectedStreak,
            name,
          );
          await moveLastUpdatedEntry(db, lastUpdated, previousName, result.selected);
          streakNames = result.names;
          selectedStreak = result.selected;
          setHashStreak(selectedStreak);
          rerenderAll();
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
          streakNames = await deleteStreak(
            db,
            streakStates,
            streakTypes,
            lastUpdated,
            streakNames,
            selectedStreak,
          );

          if (streakNames.length === 0) {
            lastUpdated.clear();
            await saveLastUpdatedMap(db, lastUpdated);
            streakStates.clear();
            streakTypes.clear();
            selectedStreak = DEFAULT_STREAK_NAME;
            streakStates.set(selectedStreak, new Map());
            streakNames = [selectedStreak];
            await saveStreakNames(db, streakNames);
            await saveStreakTypes(db, streakTypes);
            await ensureStreakExists(selectedStreak, STREAK_TYPES.Color);
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
          rerenderAll();
        } catch (error) {
          console.error('Failed to delete streak', error);
        }
      },
    );
  };

  renderControls();
  renderCalendars(container, selectedStreak, now, db, streakStates, streakTypes, lastUpdated);
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
