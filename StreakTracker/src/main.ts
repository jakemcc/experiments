const DB_NAME = 'streak-tracker';
const DB_VERSION = 2;
const STORE_NAME = 'dayStates';
const STREAK_STORE = 'streaks';
const STREAK_LIST_KEY = 'names';
const STREAK_TYPES_KEY = 'types';
const STREAK_SETTINGS_KEY = 'settings';
const LAST_UPDATED_KEY = 'lastUpdated';
const VIEW_MODE_KEY = 'viewMode';
const DATE_KEY_PATTERN = /^\d{4}-\d{1,2}-\d{1,2}$/;
const DAY_KEY_PATTERN = /^([^:]+)::(\d{4}-\d{1,2}-\d{1,2})$/;
const DEFAULT_STREAK_NAME = 'My Streak';
const OVERVIEW_HASH = 'overview';

export const DAY_STATES = {
  None: 0,
  Red: 1,
  Green: 2,
  Blue: 3,
} as const;

export type DayState = (typeof DAY_STATES)[keyof typeof DAY_STATES];
type DayValue = number;
type StreakType = 'color' | 'count';
type ViewMode = 'full' | 'overview';
type CountZeroStartMode = 'first' | 'today' | 'custom';
type ColorLabelKey = 'red' | 'green' | 'blue';
type ColorLabels = {
  red?: string;
  green?: string;
  blue?: string;
};
type ColorLabelSet = {
  red: string;
  green: string;
  blue: string;
};
type StreakSettings = {
  countZeroStartMode?: CountZeroStartMode;
  countZeroStartDate?: string;
  colorLabels?: ColorLabels;
};
type ExportPayload = {
  version: 1;
  viewMode: ViewMode;
  names: string[];
  types: [string, StreakType][];
  settings: [string, StreakSettings][];
  lastUpdated: [string, number][];
  dayStates: [string, DayValue][];
};

export const STREAK_TYPES = {
  Color: 'color',
  Count: 'count',
} as const;

const DEFAULT_COLOR_LABELS: ColorLabelSet = {
  green: 'Green',
  red: 'Red',
  blue: 'Blue',
};

export function cycleColorState(state: DayState): DayState {
  return ((state + 1) % 4) as DayState;
}

export function updateCountValue(current: number, delta: number): number {
  const safeCurrent = Number.isFinite(current) ? Math.floor(current) : 0;
  const next = safeCurrent + Math.trunc(delta);
  return Math.max(0, next);
}

type PersistDayValueOptions = {
  stateMap: Map<string, DayValue>;
  dateKey: string;
  value: DayValue;
  persist: (value: DayValue) => Promise<void>;
  remove: () => Promise<void>;
  recordActivity: () => Promise<void>;
  onPersistError: (error: unknown) => void;
  onRemoveError: (error: unknown) => void;
  onRecordError: (error: unknown) => void;
};

export async function persistDayValue(options: PersistDayValueOptions): Promise<void> {
  if (options.value > 0) {
    options.stateMap.set(options.dateKey, options.value);
    try {
      await options.persist(options.value);
    } catch (error) {
      options.onPersistError(error);
    }
  } else {
    options.stateMap.delete(options.dateKey);
    try {
      await options.remove();
    } catch (error) {
      options.onRemoveError(error);
    }
  }

  try {
    await options.recordActivity();
  } catch (error) {
    options.onRecordError(error);
  }
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
let refreshHandler: (() => void) | null = null;
let refreshHandlersBound = false;
let hashChangeHandler: (() => void) | null = null;
let hashChangeBound = false;
let suppressHashChange = false;

function bindRefreshHandlers(): void {
  if (refreshHandlersBound || typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  window.addEventListener('focus', () => refreshHandler?.());
  document.addEventListener('visibilitychange', () => refreshHandler?.());
  refreshHandlersBound = true;
}

function bindHashChangeHandler(): void {
  if (hashChangeBound || typeof window === 'undefined') {
    return;
  }
  window.addEventListener('hashchange', () => {
    if (suppressHashChange) {
      suppressHashChange = false;
      return;
    }
    hashChangeHandler?.();
  });
  hashChangeBound = true;
}

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

type ColorStatLine = {
  key?: ColorLabelKey;
  text: string;
};

function normalizeColorLabel(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function getColorLabels(settings?: StreakSettings): ColorLabelSet {
  const labels = settings?.colorLabels;
  return {
    green: normalizeColorLabel(labels?.green) ?? DEFAULT_COLOR_LABELS.green,
    red: normalizeColorLabel(labels?.red) ?? DEFAULT_COLOR_LABELS.red,
    blue: normalizeColorLabel(labels?.blue) ?? DEFAULT_COLOR_LABELS.blue,
  };
}

function hasCustomColorLabels(labels?: ColorLabels): boolean {
  return Boolean(labels?.green || labels?.red || labels?.blue);
}

function hasCountSettings(settings: StreakSettings): boolean {
  if (!settings.countZeroStartMode) {
    return false;
  }
  if (settings.countZeroStartMode === 'first' && !settings.countZeroStartDate) {
    return false;
  }
  return true;
}

function computeMonthStats(
  now: Date,
  year: number,
  month: number,
  monthState: Map<number, DayState>,
  labels: ColorLabelSet,
): ColorStatLine[] {
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
    {
      key: 'red',
      text: `${labels.red} days: ${colorCounts.red}/${daysPassed}, Longest ${labels.red} streak: ${longestStreaks.red}`,
    },
    {
      key: 'green',
      text: `${labels.green} days: ${colorCounts.green}/${daysPassed}, Longest ${labels.green} streak: ${longestStreaks.green}`,
    },
    {
      key: 'blue',
      text: `${labels.blue} days: ${colorCounts.blue}/${daysPassed}, Longest ${labels.blue} streak: ${longestStreaks.blue}`,
    },
    {
      text: `Longest ${labels.green} or ${labels.blue} streak: ${longestGreenBlueStreak}`,
    },
  ];
}

function renderColorStats(stats: HTMLElement, lines: ColorStatLine[]): void {
  stats.replaceChildren();
  lines.forEach((line, index) => {
    const lineEl = document.createElement('span');
    lineEl.className = 'stats-line';
    if (line.key) {
      const swatch = document.createElement('span');
      swatch.className = `stats-swatch stats-swatch--${line.key}`;
      lineEl.appendChild(swatch);
    }
    const text = document.createElement('span');
    text.textContent = line.text;
    lineEl.appendChild(text);
    stats.appendChild(lineEl);
    if (index < lines.length - 1) {
      stats.appendChild(document.createElement('br'));
    }
  });
}

function formatStatValue(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(2);
}

function getFirstCountDateKey(stateMap: Map<string, DayValue>): string | null {
  let earliestKey: string | null = null;
  let earliestTime: number | null = null;
  stateMap.forEach((value, dateKey) => {
    if (value <= 0) {
      return;
    }
    const time = dateKeyToTime(dateKey);
    if (time === null) {
      return;
    }
    if (earliestTime === null || time < earliestTime) {
      earliestTime = time;
      earliestKey = dateKey;
    }
  });
  return earliestKey;
}

function resolveCountZeroStartDate(
  settings: StreakSettings | undefined,
  stateMap: Map<string, DayValue>,
  now: Date,
): string | null {
  const mode = settings?.countZeroStartMode ?? 'first';
  if (mode === 'custom') {
    if (settings?.countZeroStartDate && DATE_KEY_PATTERN.test(settings.countZeroStartDate)) {
      return settings.countZeroStartDate;
    }
    return null;
  }
  if (mode === 'today') {
    return settings?.countZeroStartDate ?? formatDateInputValue(now);
  }
  return getFirstCountDateKey(stateMap);
}

function buildCountValuesFromStart(
  stateMap: Map<string, DayValue>,
  startDateKey: string | null,
  now: Date,
): number[] {
  if (!startDateKey) {
    return [];
  }
  const startTime = dateKeyToTime(startDateKey);
  if (startTime === null) {
    return [];
  }
  const values: number[] = [];
  const rangeStart = new Date(startTime);
  const rangeEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (
    let cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
    cursor <= rangeEnd;
    cursor.setDate(cursor.getDate() + 1)
  ) {
    const dateKey = buildDateKeyFromDate(cursor);
    const value = stateMap.get(dateKey);
    values.push(value && value > 0 ? Math.floor(value) : 0);
  }
  return values;
}

function buildCountValuesForMonth(
  stateMap: Map<string, DayValue>,
  year: number,
  month: number,
  now: Date,
  startDateKey: string | null,
): number[] {
  const values: number[] = [];
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

  const startTime = startDateKey ? dateKeyToTime(startDateKey) : null;
  if (startTime === null) {
    return values;
  }
  for (let day = 1; day <= daysPassed; day += 1) {
    const dateKey = `${year}-${month}-${day}`;
    const value = stateMap.get(dateKey);
    const dayTime = dateKeyToTime(dateKey);
    if (dayTime !== null && dayTime >= startTime) {
      values.push(value && value > 0 ? Math.floor(value) : 0);
    }
  }

  return values;
}

function buildCountValuesForOverall(
  stateMap: Map<string, DayValue>,
  startDateKey: string | null,
  now: Date,
): number[] {
  return buildCountValuesFromStart(stateMap, startDateKey, now);
}

function buildCountStats(values: number[]): string[] {
  if (values.length === 0) {
     return ['Total: 0', 'Median: 0', 'Mean: 0'];
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
    `Total: ${formatStatValue(total)}`,
    `Median: ${formatStatValue(median)}`,
    `Mean: ${formatStatValue(mean)}`,
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

function buildDateKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

type RollingDate = {
  dateKey: string;
  label: string;
  day: number;
};

function getRollingWeekDates(now: Date): RollingDate[] {
  const dates: RollingDate[] = [];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    dates.push({
      dateKey: buildDateKeyFromDate(date),
      label: date.toLocaleDateString('default', {
        weekday: 'short',
        month: 'numeric',
        day: 'numeric',
      }),
      day: date.getDate(),
    });
  }
  return dates;
}

function formatDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

function getHashValue(): string | null {
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

function parseHashView(): { viewMode: ViewMode; streakName: string | null } {
  const hash = getHashValue();
  if (!hash || hash === OVERVIEW_HASH) {
    return { viewMode: 'overview', streakName: null };
  }
  return { viewMode: 'full', streakName: hash };
}

function setHashStreak(streakName: string): void {
  if (typeof window === 'undefined' || !window.location) {
    return;
  }
  const next = `#${encodeURIComponent(streakName)}`;
  if (window.location.hash === next) {
    return;
  }
  suppressHashChange = true;
  window.location.hash = encodeURIComponent(streakName);
}

function setOverviewHash(): void {
  if (typeof window === 'undefined' || !window.location) {
    return;
  }
  const next = `#${OVERVIEW_HASH}`;
  if (window.location.hash === next) {
    return;
  }
  suppressHashChange = true;
  window.location.hash = OVERVIEW_HASH;
}

function clearHashStreak(): void {
  setOverviewHash();
}

function getStoredViewMode(): ViewMode {
  if (typeof localStorage === 'undefined') {
    return 'full';
  }
  try {
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    return stored === 'overview' || stored === 'full' ? stored : 'full';
  } catch {
    return 'full';
  }
}

function storeViewMode(mode: ViewMode): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(VIEW_MODE_KEY, mode);
  } catch {
    // Ignore storage failures to keep the UI responsive.
  }
}

function parseViewMode(value: unknown): ViewMode | null {
  return value === 'overview' || value === 'full' ? value : null;
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

function isCountZeroStartMode(value: unknown): value is CountZeroStartMode {
  return value === 'first' || value === 'today' || value === 'custom';
}

function parseColorLabels(value: unknown): ColorLabels | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const green = normalizeColorLabel(raw.green);
  const red = normalizeColorLabel(raw.red);
  const blue = normalizeColorLabel(raw.blue);
  const labels: ColorLabels = {};
  if (green) {
    labels.green = green;
  }
  if (red) {
    labels.red = red;
  }
  if (blue) {
    labels.blue = blue;
  }
  return labels.green || labels.red || labels.blue ? labels : null;
}

function parseStoredStreakSettings(raw: unknown): Map<string, StreakSettings> {
  if (!Array.isArray(raw)) {
    return new Map();
  }
  const settings = new Map<string, StreakSettings>();
  raw.forEach((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') {
      return;
    }
    const rawSettings = entry[1];
    if (!rawSettings || typeof rawSettings !== 'object') {
      return;
    }
    const parsed: StreakSettings = {};
    const mode = (rawSettings as Record<string, unknown>).countZeroStartMode;
    if (isCountZeroStartMode(mode)) {
      parsed.countZeroStartMode = mode;
    }
    const date = (rawSettings as Record<string, unknown>).countZeroStartDate;
    if (typeof date === 'string' && DATE_KEY_PATTERN.test(date)) {
      parsed.countZeroStartDate = date;
    }
    const colorLabels = parseColorLabels((rawSettings as Record<string, unknown>).colorLabels);
    if (colorLabels) {
      parsed.colorLabels = colorLabels;
    }
    if (parsed.countZeroStartMode || parsed.countZeroStartDate || parsed.colorLabels) {
      settings.set(normalizeStreakName(entry[0]), parsed);
    }
  });
  return settings;
}

function parseLastUpdatedEntries(raw: unknown): Map<string, number> {
  if (!Array.isArray(raw)) {
    return new Map();
  }
  const entries = raw.filter(
    (entry): entry is [string, number] =>
      Array.isArray(entry) &&
      entry.length === 2 &&
      typeof entry[0] === 'string' &&
      typeof entry[1] === 'number',
  );
  const lastUpdated = new Map<string, number>();
  entries.forEach(([name, timestamp]) => {
    lastUpdated.set(normalizeStreakName(name), timestamp);
  });
  return lastUpdated;
}

function buildNormalizedNameList(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const names = new Set<string>();
  raw.forEach((entry) => {
    if (typeof entry === 'string') {
      names.add(normalizeStreakName(entry));
    }
  });
  return Array.from(names);
}

function normalizeDayStateEntries(
  raw: unknown,
): { entries: [string, DayValue][]; streakNames: Set<string> } {
  const entries: [string, DayValue][] = [];
  const streakNames = new Set<string>();
  if (!Array.isArray(raw)) {
    return { entries, streakNames };
  }
  raw.forEach((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      return;
    }
    const [key, value] = entry;
    if (typeof key !== 'string' || typeof value !== 'number' || !Number.isFinite(value)) {
      return;
    }
    if (value <= 0) {
      return;
    }
    const parsed = parseDayKey(key);
    if (!parsed) {
      return;
    }
    const normalizedName = normalizeStreakName(parsed.streak);
    const normalizedKey = buildDayKey(normalizedName, parsed.dateKey);
    entries.push([normalizedKey, Math.floor(value)]);
    streakNames.add(normalizedName);
  });
  return { entries, streakNames };
}

async function getStoredStreakTypes(db: IDBDatabase): Promise<Map<string, StreakType>> {
  const tx = db.transaction(STREAK_STORE, 'readonly');
  const store = tx.objectStore(STREAK_STORE);
  const result = await storeGet<unknown>(store, STREAK_TYPES_KEY, 'Failed to load streak types');
  return parseStoredStreakTypes(result);
}

async function getStoredStreakSettings(db: IDBDatabase): Promise<Map<string, StreakSettings>> {
  const tx = db.transaction(STREAK_STORE, 'readonly');
  const store = tx.objectStore(STREAK_STORE);
  const result = await storeGet<unknown>(
    store,
    STREAK_SETTINGS_KEY,
    'Failed to load streak settings',
  );
  return parseStoredStreakSettings(result);
}

async function saveStreakTypes(db: IDBDatabase, types: Map<string, StreakType>): Promise<void> {
  const tx = db.transaction(STREAK_STORE, 'readwrite');
  const store = tx.objectStore(STREAK_STORE);
  store.put(Array.from(types.entries()), STREAK_TYPES_KEY);
  await transactionDone(tx, 'Failed to save streak types');
}

async function saveStreakSettings(
  db: IDBDatabase,
  settings: Map<string, StreakSettings>,
): Promise<void> {
  const tx = db.transaction(STREAK_STORE, 'readwrite');
  const store = tx.objectStore(STREAK_STORE);
  store.put(Array.from(settings.entries()), STREAK_SETTINGS_KEY);
  await transactionDone(tx, 'Failed to save streak settings');
}

async function saveStreakNames(db: IDBDatabase, names: string[]): Promise<void> {
  const tx = db.transaction(STREAK_STORE, 'readwrite');
  const store = tx.objectStore(STREAK_STORE);
  store.put(names, STREAK_LIST_KEY);
  await transactionDone(tx, 'Failed to save streak names');
}

async function clearStore(db: IDBDatabase, storeName: string, errorMessage: string): Promise<void> {
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  store.clear();
  await transactionDone(tx, errorMessage);
}

async function getAllDayStateEntries(db: IDBDatabase): Promise<[string, DayValue][]> {
  const entries: [string, DayValue][] = [];
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
          if (Number.isFinite(cursor.value) && cursor.value > 0) {
            entries.push([cursor.key, cursor.value]);
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
  return entries;
}

function buildExportFileName(date: Date): string {
  return `streak-tracker-export-${formatDateInputValue(date)}.json`;
}

async function buildExportPayload(db: IDBDatabase): Promise<ExportPayload> {
  const dayStates = await getAllDayStateEntries(db);
  const streakNamesFromStates = new Set<string>();
  dayStates.forEach(([key]) => {
    const parsed = parseDayKey(key);
    if (parsed) {
      streakNamesFromStates.add(parsed.streak);
    }
  });
  const storedNames = await getStoredStreakNames(db);
  const namesSet = buildNamesSet(storedNames, streakNamesFromStates);
  const names = Array.from(namesSet);

  const storedTypes = await getStoredStreakTypes(db);
  const migrated = migrateStreakTypes(storedTypes, names);
  const settings = await getStoredStreakSettings(db);
  const lastUpdated = await getLastUpdatedMap(db);

  return {
    version: 1,
    viewMode: getStoredViewMode(),
    names,
    types: Array.from(migrated.types.entries()),
    settings: Array.from(settings.entries()),
    lastUpdated: Array.from(lastUpdated.entries()),
    dayStates,
  };
}

function downloadExportPayload(payload: ExportPayload): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = buildExportFileName(new Date());
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function parseImportPayload(raw: unknown): ExportPayload | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (record.version !== 1) {
    return null;
  }

  const baseNames = buildNormalizedNameList(record.names);
  const dayStateResult = normalizeDayStateEntries(record.dayStates);
  const namesSet = buildNamesSet(baseNames, dayStateResult.streakNames);
  const names = Array.from(namesSet);

  const importedTypes = parseStoredStreakTypes(record.types);
  const normalizedTypes = new Map<string, StreakType>();
  importedTypes.forEach((type, name) => {
    normalizedTypes.set(normalizeStreakName(name), type);
  });
  const migratedTypes = migrateStreakTypes(normalizedTypes, names);

  const settings = parseStoredStreakSettings(record.settings);
  const lastUpdated = parseLastUpdatedEntries(record.lastUpdated);
  const viewMode = parseViewMode(record.viewMode) ?? 'full';

  return {
    version: 1,
    viewMode,
    names,
    types: Array.from(migratedTypes.types.entries()),
    settings: Array.from(settings.entries()),
    lastUpdated: Array.from(lastUpdated.entries()),
    dayStates: dayStateResult.entries,
  };
}

async function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

async function replaceAllStoredData(db: IDBDatabase, payload: ExportPayload): Promise<void> {
  await clearStore(db, STORE_NAME, 'Failed to clear store');
  await clearStore(db, STREAK_STORE, 'Failed to clear streak store');

  if (payload.dayStates.length > 0) {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    payload.dayStates.forEach(([key, value]) => {
      store.put(value, key);
    });
    await transactionDone(tx, 'Failed to import day states');
  }

  const streakTx = db.transaction(STREAK_STORE, 'readwrite');
  const streakStore = streakTx.objectStore(STREAK_STORE);
  streakStore.put(payload.names, STREAK_LIST_KEY);
  streakStore.put(payload.types, STREAK_TYPES_KEY);
  streakStore.put(payload.settings, STREAK_SETTINGS_KEY);
  streakStore.put(payload.lastUpdated, LAST_UPDATED_KEY);
  await transactionDone(streakTx, 'Failed to import streak data');
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
  streakSettings: Map<string, StreakSettings>,
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
  if (streakSettings.has(normalized)) {
    streakSettings.delete(normalized);
    await saveStreakSettings(db, streakSettings);
  }
  return nextNames;
}

async function renameStreak(
  db: IDBDatabase,
  streakStates: Map<string, Map<string, DayValue>>,
  streakTypes: Map<string, StreakType>,
  streakSettings: Map<string, StreakSettings>,
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

  const existingSettings = streakSettings.get(newName);
  const oldSettings = streakSettings.get(currentName);
  let settingsChanged = false;
  if (!existingSettings && oldSettings) {
    streakSettings.set(newName, oldSettings);
    settingsChanged = true;
  }
  if (currentName !== newName && streakSettings.has(currentName)) {
    streakSettings.delete(currentName);
    settingsChanged = true;
  }
  if (settingsChanged) {
    await saveStreakSettings(db, streakSettings);
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
  selectedStreak: string,
  onCreate: (name: string, streakType: StreakType) => void,
  onRename: (name: string) => void,
  onSettings: () => void,
  onDelete: () => void,
  viewMode: ViewMode,
  onViewModeChange: (mode: ViewMode) => void,
): void {
  controlsContainer.innerHTML = '';
  controlsContainer.classList.add('streak-controls');

  const row = document.createElement('div');
  row.className = 'streak-controls__row';

  const viewToggle = document.createElement('div');
  viewToggle.className = 'view-toggle';
  viewToggle.setAttribute('role', 'group');
  const viewToggleLabel = document.createElement('span');
  viewToggleLabel.className = 'sr-only';
  viewToggleLabel.id = 'view-toggle-label';
  viewToggleLabel.textContent = 'Choose view';
  viewToggle.setAttribute('aria-labelledby', viewToggleLabel.id);
  viewToggle.appendChild(viewToggleLabel);

  const buildViewButton = (mode: ViewMode, label: string) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'view-toggle__button';
    if (viewMode === mode) {
      button.classList.add('streak-pill--active');
      button.setAttribute('aria-pressed', 'true');
    } else {
      button.setAttribute('aria-pressed', 'false');
    }
    button.dataset.view = mode;
    button.textContent = label;
    button.addEventListener('click', () => {
      onViewModeChange(mode);
    });
    return button;
  };

  viewToggle.appendChild(buildViewButton('overview', 'Overview'));
  row.appendChild(viewToggle);

  const actions = document.createElement('div');
  actions.className = 'streak-actions';
  if (viewMode === 'full') {
    const renameButton = document.createElement('button');
    renameButton.type = 'button';
    renameButton.className = 'icon-button streak-rename';
    renameButton.title = 'Rename streak';
    renameButton.setAttribute('aria-label', 'Rename selected streak');
    renameButton.textContent = '✎';
    renameButton.addEventListener('click', async () => {
      const proposed = prompt('Rename streak', selectedStreak);
      if (proposed !== null) {
        await onRename(proposed);
      }
    });
    actions.appendChild(renameButton);
  }

  const settingsButton = document.createElement('button');
  settingsButton.type = 'button';
  settingsButton.className = 'icon-button streak-settings';
  settingsButton.title = 'Streak settings';
  settingsButton.setAttribute('aria-label', 'Open streak settings');
  settingsButton.textContent = '\u2699';
  settingsButton.addEventListener('click', () => {
    onSettings();
  });
  actions.appendChild(settingsButton);

  if (viewMode === 'full') {
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'icon-button streak-delete';
    deleteButton.title = 'Delete streak';
    deleteButton.setAttribute('aria-label', 'Delete selected streak');
    deleteButton.textContent = '🗑';
    deleteButton.addEventListener('click', () => {
      onDelete();
    });
    actions.appendChild(deleteButton);
  }
  row.appendChild(actions);

  const addContainer = document.createElement('div');
  addContainer.className = 'streak-add';
  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.className = 'icon-button streak-add__button';
  addButton.textContent = '+';
  addButton.title = 'Create new streak';
  addButton.setAttribute('aria-label', 'Create new streak');
  addButton.addEventListener('click', async () => {
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
    await onCreate(trimmed, streakType);
  });
  addContainer.appendChild(addButton);
  row.appendChild(addContainer);
  controlsContainer.appendChild(row);
}

function buildDataToolsSection(
  db: IDBDatabase,
  onAfterImport: () => void,
): HTMLFieldSetElement {
  const dataFieldset = document.createElement('fieldset');
  dataFieldset.className = 'streak-settings__fieldset data-tools';
  const dataLegend = document.createElement('legend');
  dataLegend.textContent = 'Import / Export';
  dataFieldset.appendChild(dataLegend);

  const exportButton = document.createElement('button');
  exportButton.type = 'button';
  exportButton.className = 'data-export';
  exportButton.textContent = 'Export data';
  exportButton.addEventListener('click', () => {
    void (async () => {
      try {
        const payload = await buildExportPayload(db);
        downloadExportPayload(payload);
      } catch (error) {
        console.error('Failed to export data', error);
        alert('Failed to export data.');
      }
    })();
  });
  dataFieldset.appendChild(exportButton);

  const exportNote = document.createElement('p');
  exportNote.className = 'data-export__note';
  exportNote.textContent = 'Export downloads all streaks and settings.';
  dataFieldset.appendChild(exportNote);

  const importWarning = document.createElement('p');
  importWarning.className = 'data-import__warning';
  importWarning.textContent = 'Import replaces all existing streak data and settings.';
  dataFieldset.appendChild(importWarning);

  const importLabel = document.createElement('label');
  importLabel.className = 'data-import__label';
  importLabel.textContent = 'Import from file';
  const importInput = document.createElement('input');
  importInput.type = 'file';
  importInput.accept = 'application/json';
  importInput.className = 'data-import__input';
  importLabel.appendChild(importInput);
  dataFieldset.appendChild(importLabel);

  importInput.addEventListener('change', () => {
    const file = importInput.files?.[0];
    if (!file) {
      return;
    }
    importInput.value = '';
    void (async () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFileText(file));
      } catch (error) {
        console.error('Failed to parse import file', error);
        alert('Import file must be valid JSON.');
        return;
      }
      const payload = parseImportPayload(parsed);
      if (!payload) {
        alert('Import file is invalid.');
        return;
      }
      try {
        await replaceAllStoredData(db, payload);
        storeViewMode(payload.viewMode);
        if (payload.names.length > 0) {
          setHashStreak(payload.names[0]);
        } else if (typeof window !== 'undefined' && window.location) {
          window.location.hash = '';
        }
        onAfterImport();
        await setup();
      } catch (error) {
        console.error('Failed to import data', error);
        alert('Failed to import data.');
      }
    })();
  });

  return dataFieldset;
}

function openStreakSettingsModal(options: {
  streakName: string;
  streakType: StreakType;
  settings: StreakSettings | undefined;
  onSave: (nextSettings: StreakSettings) => void;
  db: IDBDatabase;
}): void {
  const existing = document.getElementById('streak-settings-modal');
  if (existing) {
    existing.remove();
  }

  const overlay = document.createElement('div');
  overlay.id = 'streak-settings-modal';
  overlay.className = 'streak-settings__overlay';
  const dialog = document.createElement('div');
  dialog.className = 'streak-settings__dialog';

  const title = document.createElement('h2');
  title.textContent = `Streak settings: ${options.streakName}`;
  dialog.appendChild(title);

  const body = document.createElement('div');
  dialog.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'streak-settings__actions';

  const closeModal = () => {
    overlay.remove();
  };

  if (options.streakType === STREAK_TYPES.Count) {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'streak-settings__fieldset';
    const legend = document.createElement('legend');
    legend.textContent = 'Start from date';
    fieldset.appendChild(legend);

    const rawMode = options.settings?.countZeroStartMode ?? 'first';
    const mode = rawMode === 'today' ? 'custom' : rawMode;
    const storedDate =
      rawMode === 'today'
        ? options.settings?.countZeroStartDate ?? formatDateInputValue(new Date())
        : options.settings?.countZeroStartDate ?? '';

    const optionFirst = document.createElement('label');
    optionFirst.className = 'streak-settings__option';
    const firstInput = document.createElement('input');
    firstInput.type = 'radio';
    firstInput.name = 'count-zero-start';
    firstInput.value = 'first';
    firstInput.checked = mode === 'first';
    optionFirst.appendChild(firstInput);
    optionFirst.appendChild(document.createTextNode('First recorded day'));
    fieldset.appendChild(optionFirst);

    const optionCustom = document.createElement('label');
    optionCustom.className = 'streak-settings__option';
    const customInput = document.createElement('input');
    customInput.type = 'radio';
    customInput.name = 'count-zero-start';
    customInput.value = 'custom';
    customInput.checked = mode === 'custom';
    optionCustom.appendChild(customInput);
    optionCustom.appendChild(document.createTextNode('Custom date'));
    fieldset.appendChild(optionCustom);

    const customDate = document.createElement('input');
    customDate.type = 'date';
    customDate.className = 'streak-settings__date';
    customDate.value = mode === 'custom' ? storedDate : '';
    customDate.disabled = mode !== 'custom';
    fieldset.appendChild(customDate);

    const error = document.createElement('p');
    error.className = 'streak-settings__error';
    error.hidden = true;
    fieldset.appendChild(error);

    const clearError = () => {
      error.hidden = true;
      error.textContent = '';
    };

    const updateCustomState = () => {
      customDate.disabled = !customInput.checked;
      clearError();
    };

    firstInput.addEventListener('change', updateCustomState);
    customInput.addEventListener('change', updateCustomState);
    customDate.addEventListener('input', clearError);

    body.appendChild(fieldset);

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', closeModal);

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'streak-settings__save';
    saveButton.textContent = 'Save';
    saveButton.addEventListener('click', () => {
      const selected = (
        document.querySelector('input[name="count-zero-start"]:checked') as HTMLInputElement | null
      )?.value as CountZeroStartMode | undefined;
      const nextMode: CountZeroStartMode = selected ?? 'first';
      const nextSettings: StreakSettings = { countZeroStartMode: nextMode };
      if (nextMode === 'custom') {
        const value = customDate.value;
        const parsedTime = dateKeyToTime(value);
        const todayValue = formatDateInputValue(new Date());
        const todayTime = dateKeyToTime(todayValue);
        if (!value || parsedTime === null) {
          error.textContent = 'Enter a valid date.';
          error.hidden = false;
          return;
        }
        if (todayTime !== null && parsedTime > todayTime) {
          error.textContent = 'Choose today or earlier.';
          error.hidden = false;
          return;
        }
        nextSettings.countZeroStartDate = value;
      }
      options.onSave(nextSettings);
      closeModal();
    });

    actions.appendChild(cancelButton);
    actions.appendChild(saveButton);
  } else if (options.streakType === STREAK_TYPES.Color) {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'streak-settings__fieldset';
    const legend = document.createElement('legend');
    legend.textContent = 'Color labels';
    fieldset.appendChild(legend);

    const labels = getColorLabels(options.settings);

    const buildLabelInput = (color: ColorLabelKey, labelText: string, value: string) => {
      const wrapper = document.createElement('label');
      wrapper.className = 'streak-settings__label';
      const text = document.createElement('span');
      text.textContent = labelText;
      const input = document.createElement('input');
      input.type = 'text';
      input.id = `streak-color-label-${color}`;
      input.value = value;
      wrapper.appendChild(text);
      wrapper.appendChild(input);
      return { wrapper, input };
    };

    const greenField = buildLabelInput('green', 'Green label', labels.green);
    const redField = buildLabelInput('red', 'Red label', labels.red);
    const blueField = buildLabelInput('blue', 'Blue label', labels.blue);

    fieldset.appendChild(greenField.wrapper);
    fieldset.appendChild(redField.wrapper);
    fieldset.appendChild(blueField.wrapper);
    body.appendChild(fieldset);

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', closeModal);

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'streak-settings__save';
    saveButton.textContent = 'Save';
    saveButton.addEventListener('click', () => {
      const labelsForSave: ColorLabels = {};
      const greenValue = normalizeColorLabel(greenField.input.value);
      const redValue = normalizeColorLabel(redField.input.value);
      const blueValue = normalizeColorLabel(blueField.input.value);
      if (greenValue && greenValue !== DEFAULT_COLOR_LABELS.green) {
        labelsForSave.green = greenValue;
      }
      if (redValue && redValue !== DEFAULT_COLOR_LABELS.red) {
        labelsForSave.red = redValue;
      }
      if (blueValue && blueValue !== DEFAULT_COLOR_LABELS.blue) {
        labelsForSave.blue = blueValue;
      }
      const nextSettings: StreakSettings = {};
      if (hasCustomColorLabels(labelsForSave)) {
        nextSettings.colorLabels = labelsForSave;
      }
      options.onSave(nextSettings);
      closeModal();
    });

    actions.appendChild(cancelButton);
    actions.appendChild(saveButton);
  } else {
    const note = document.createElement('p');
    note.className = 'streak-settings__note';
    note.textContent = 'No settings for this streak type yet.';
    body.appendChild(note);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = 'Close';
    closeButton.addEventListener('click', closeModal);
    actions.appendChild(closeButton);
  }

  const dataFieldset = buildDataToolsSection(options.db, closeModal);

  body.appendChild(dataFieldset);

  dialog.appendChild(actions);
  overlay.appendChild(dialog);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeModal();
    }
  });
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModal();
    }
  });
  overlay.tabIndex = -1;
  document.body.appendChild(overlay);
  overlay.focus();
}

function openGlobalSettingsModal(db: IDBDatabase): void {
  const existing = document.getElementById('streak-settings-modal');
  if (existing) {
    existing.remove();
  }

  const overlay = document.createElement('div');
  overlay.id = 'streak-settings-modal';
  overlay.className = 'streak-settings__overlay';
  const dialog = document.createElement('div');
  dialog.className = 'streak-settings__dialog';

  const title = document.createElement('h2');
  title.textContent = 'Settings';
  dialog.appendChild(title);

  const body = document.createElement('div');
  dialog.appendChild(body);

  const actions = document.createElement('div');
  actions.className = 'streak-settings__actions';

  const closeModal = () => {
    overlay.remove();
  };

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = 'Close';
  closeButton.addEventListener('click', closeModal);
  actions.appendChild(closeButton);

  body.appendChild(buildDataToolsSection(db, closeModal));

  dialog.appendChild(actions);
  overlay.appendChild(dialog);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeModal();
    }
  });
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModal();
    }
  });
  overlay.tabIndex = -1;
  document.body.appendChild(overlay);
  overlay.focus();
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

function renderOverview(
  container: HTMLElement,
  streakNames: string[],
  now: Date,
  db: IDBDatabase,
  streakStates: Map<string, Map<string, DayValue>>,
  streakTypes: Map<string, StreakType>,
  streakSettings: Map<string, StreakSettings>,
  lastUpdated: Map<string, number>,
  onOpenStreak: (name: string) => void,
): void {
  container.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'overview';
  const dates = getRollingWeekDates(now);

  streakNames.forEach((streakName) => {
    const existingStateMap = streakStates.get(streakName);
    const stateMap = existingStateMap ?? new Map<string, DayValue>();
    if (!existingStateMap) {
      streakStates.set(streakName, stateMap);
    }
    const streakType = streakTypes.get(streakName) ?? STREAK_TYPES.Color;

    const row = document.createElement('div');
    row.className = 'overview-row';
    row.dataset.streak = streakName;

    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'overview-row__name';
    const nameLabel = document.createElement('span');
    nameLabel.className = 'overview-row__label';
    nameLabel.textContent = streakName;
    name.appendChild(nameLabel);

    const nameChevron = document.createElement('span');
    nameChevron.className = 'overview-row__chevron';
    nameChevron.textContent = '›';
    name.appendChild(nameChevron);
    name.setAttribute('aria-label', `View details for ${streakName}`);
    name.addEventListener('click', () => {
      onOpenStreak(streakName);
    });
    row.appendChild(name);

    if (streakType === STREAK_TYPES.Color) {
      const legend = document.createElement('div');
      legend.className = 'overview-row__legend';
      const labels = getColorLabels(streakSettings.get(streakName));
      ([
        ['red', labels.red],
        ['green', labels.green],
        ['blue', labels.blue],
      ] as const).forEach(([key, label]) => {
        const item = document.createElement('span');
        item.className = 'overview-legend__item';
        const swatch = document.createElement('span');
        swatch.className = `overview-legend__swatch overview-legend__swatch--${key}`;
        item.appendChild(swatch);
        const text = document.createElement('span');
        text.textContent = label;
        item.appendChild(text);
        legend.appendChild(item);
      });
      row.appendChild(legend);
    }

    const days = document.createElement('div');
    days.className = 'overview-days';

    dates.forEach(({ dateKey, label, day }) => {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'overview-day';
      cell.dataset.dateKey = dateKey;
      cell.title = label;

      const dayLabel = document.createElement('span');
      dayLabel.className = 'overview-day__label';
      dayLabel.textContent = String(day);
      cell.appendChild(dayLabel);

      if (streakType === STREAK_TYPES.Color) {
        let state = stateMap.get(dateKey) ?? DAY_STATES.None;
        if (!Number.isFinite(state) || state < DAY_STATES.None || state > DAY_STATES.Blue) {
          state = DAY_STATES.None;
        }
        applyDayStateClass(cell, state as DayState);
        const updateAriaLabel = () => {
          const stateLabel =
            state === DAY_STATES.Red
              ? 'red'
              : state === DAY_STATES.Green
                ? 'green'
                : state === DAY_STATES.Blue
                  ? 'blue'
                  : 'empty';
          cell.setAttribute('aria-label', `${streakName}, ${label}, ${stateLabel}`);
        };
        updateAriaLabel();
        cell.addEventListener('click', async () => {
          state = cycleColorState(state as DayState);
          applyDayStateClass(cell, state as DayState);
          await persistDayValue({
            stateMap,
            dateKey,
            value: state,
            persist: (nextValue) => setDayState(db, streakName, dateKey, nextValue),
            remove: () => removeDayState(db, streakName, dateKey),
            recordActivity: () => recordStreakActivity(db, lastUpdated, streakName),
            onPersistError: (error) => console.error('Failed to save day state', error),
            onRemoveError: (error) => console.error('Failed to remove day state', error),
            onRecordError: (error) => console.error('Failed to update streak activity', error),
          });
          updateAriaLabel();
        });
      } else {
        let count = stateMap.get(dateKey) ?? 0;
        if (!Number.isFinite(count) || count < 0) {
          count = 0;
        }
        count = Math.floor(count);

        const value = document.createElement('span');
        value.className = 'overview-day__value';
        cell.appendChild(value);

        const updateCountDisplay = () => {
          value.textContent = count > 0 ? String(count) : '';
          cell.setAttribute('aria-label', `${streakName}, ${label}, count ${count}`);
        };
        updateCountDisplay();

        const applyCountChange = async (delta: number) => {
          count = updateCountValue(count, delta);
          updateCountDisplay();
          await persistDayValue({
            stateMap,
            dateKey,
            value: count,
            persist: (nextValue) => setDayState(db, streakName, dateKey, nextValue),
            remove: () => removeDayState(db, streakName, dateKey),
            recordActivity: () => recordStreakActivity(db, lastUpdated, streakName),
            onPersistError: (error) => console.error('Failed to save count state', error),
            onRemoveError: (error) => console.error('Failed to remove count state', error),
            onRecordError: (error) => console.error('Failed to update streak activity', error),
          });
        };

        cell.addEventListener('click', () => {
          void applyCountChange(1);
        });
      }

      days.appendChild(cell);
    });

    row.appendChild(days);
    wrapper.appendChild(row);
  });

  container.appendChild(wrapper);
}

function renderCalendars(
  container: HTMLElement,
  streakName: string,
  now: Date,
  db: IDBDatabase,
  streakStates: Map<string, Map<string, DayValue>>,
  streakTypes: Map<string, StreakType>,
  streakSettings: Map<string, StreakSettings>,
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
  const getCountZeroStartDate = () =>
    resolveCountZeroStartDate(streakSettings.get(streakName), stateMap, now);
  const updateOverallStats = () => {
    if (!overallStats) {
      return;
    }
    const values = buildCountValuesForOverall(stateMap, getCountZeroStartDate(), now);
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
        const labels = getColorLabels(streakSettings.get(streakName));
        renderColorStats(stats, computeMonthStats(now, year, month, monthState, labels));
      } else {
        const values = buildCountValuesForMonth(stateMap, year, month, now, getCountZeroStartDate());
        stats.textContent = buildCountStats(values).join(' ');
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
            } else {
              monthState.set(value, state);
            }
            await persistDayValue({
              stateMap,
              dateKey,
              value: state,
              persist: (nextValue) => setDayState(db, streakName, dateKey, nextValue),
              remove: () => removeDayState(db, streakName, dateKey),
              recordActivity: () => recordStreakActivity(db, lastUpdated, streakName),
              onPersistError: (error) => console.error('Failed to save day state', error),
              onRemoveError: (error) => console.error('Failed to remove day state', error),
              onRecordError: (error) => console.error('Failed to update streak activity', error),
            });
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
            } else {
              monthCounts.set(value, count);
            }
            await persistDayValue({
              stateMap,
              dateKey,
              value: count,
              persist: (nextValue) => setDayState(db, streakName, dateKey, nextValue),
              remove: () => removeDayState(db, streakName, dateKey),
              recordActivity: () => recordStreakActivity(db, lastUpdated, streakName),
              onPersistError: (error) => console.error('Failed to save count state', error),
              onRemoveError: (error) => console.error('Failed to remove count state', error),
              onRecordError: (error) => console.error('Failed to update streak activity', error),
            });
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

  let now = new Date();
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
  let streakSettings = new Map<string, StreakSettings>();
  try {
    streakSettings = await getStoredStreakSettings(db);
  } catch (error) {
    console.error('Failed to load streak settings', error);
  }
  const lastUpdated = await getLastUpdatedMap(db);

  const normalizedStoredNames = storedNames.map(normalizeStreakName);
  let namesSet = buildNamesSet(storedNames, streakNamesFromStates);

  const hashView = parseHashView();
  const normalizedHashStreak = hashView.streakName
    ? normalizeStreakName(hashView.streakName)
    : null;
  let viewMode: ViewMode = hashView.viewMode;

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
  if (viewMode === 'full' && selectedStreak) {
    setHashStreak(selectedStreak);
  } else {
    setOverviewHash();
  }

  const setSelectedStreak = (name: string, updateHash = viewMode === 'full') => {
    selectedStreak = normalizeStreakName(name);
    if (updateHash) {
      setHashStreak(selectedStreak);
    }
  };

  const openStreakDetails = (name: string) => {
    setSelectedStreak(name, true);
    viewMode = 'full';
    storeViewMode(viewMode);
    rerenderAll();
  };

  const rerenderAll = () => {
    if (viewMode === 'overview') {
      renderOverview(
        container,
        streakNames,
        now,
        db,
        streakStates,
        streakTypes,
        streakSettings,
        lastUpdated,
        openStreakDetails,
      );
    } else {
      renderCalendars(
        container,
        selectedStreak,
        now,
        db,
        streakStates,
        streakTypes,
        streakSettings,
        lastUpdated,
      );
    }
    renderControls();
  };

  const handleHashNavigation = () => {
    const nextView = parseHashView();
    if (nextView.viewMode === 'overview') {
      viewMode = 'overview';
      storeViewMode(viewMode);
      rerenderAll();
      return;
    }
    if (!nextView.streakName) {
      viewMode = 'overview';
      storeViewMode(viewMode);
      rerenderAll();
      return;
    }
    const normalized = normalizeStreakName(nextView.streakName);
    if (!streakNames.includes(normalized)) {
      streakNames = [...streakNames, normalized];
      streakStates.set(normalized, streakStates.get(normalized) ?? new Map());
      void saveStreakNames(db, streakNames);
    }
    selectedStreak = normalized;
    viewMode = 'full';
    storeViewMode(viewMode);
    rerenderAll();
  };

  refreshHandler = () => {
    now = new Date();
    rerenderAll();
  };
  bindRefreshHandlers();

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
      selectedStreak,
      async (rawName, streakType) => {
        const name = normalizeStreakName(rawName);
        await ensureStreakExists(name, streakType);
        setSelectedStreak(name, viewMode === 'full');
        if (viewMode === 'overview') {
          setOverviewHash();
        }
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
          if (name !== selectedStreak && streakNames.includes(name)) {
            alert('A streak with that name already exists.');
            return;
          }
          const previousName = selectedStreak;
          const result = await renameStreak(
            db,
            streakStates,
            streakTypes,
            streakSettings,
            streakNames,
            selectedStreak,
            name,
          );
          await moveLastUpdatedEntry(db, lastUpdated, previousName, result.selected);
          streakNames = result.names;
          selectedStreak = result.selected;
          viewMode = 'full';
          storeViewMode(viewMode);
          setHashStreak(selectedStreak);
          rerenderAll();
        } catch (error) {
          console.error('Failed to rename streak', error);
        }
      },
      () => {
        if (viewMode === 'overview') {
          openGlobalSettingsModal(db);
          return;
        }
        if (!selectedStreak) {
          return;
        }
        const streakType = streakTypes.get(selectedStreak) ?? STREAK_TYPES.Color;
        openStreakSettingsModal({
          streakName: selectedStreak,
          streakType,
          settings: streakSettings.get(selectedStreak),
          db,
          onSave: (nextSettings) => {
            void (async () => {
              const shouldStore =
                hasCountSettings(nextSettings) || hasCustomColorLabels(nextSettings.colorLabels);
              if (!shouldStore) {
                streakSettings.delete(selectedStreak);
              } else {
                streakSettings.set(selectedStreak, nextSettings);
              }
              try {
                await saveStreakSettings(db, streakSettings);
                rerenderAll();
              } catch (error) {
                console.error('Failed to save streak settings', error);
                alert('Failed to save streak settings.');
              }
            })();
          },
        });
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
            streakSettings,
            lastUpdated,
            streakNames,
            selectedStreak,
          );

          if (streakNames.length === 0) {
            lastUpdated.clear();
            await saveLastUpdatedMap(db, lastUpdated);
            streakStates.clear();
            streakTypes.clear();
            streakSettings.clear();
            selectedStreak = DEFAULT_STREAK_NAME;
            streakStates.set(selectedStreak, new Map());
            streakNames = [selectedStreak];
            await saveStreakNames(db, streakNames);
            await saveStreakTypes(db, streakTypes);
            await saveStreakSettings(db, streakSettings);
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

          viewMode = 'overview';
          storeViewMode(viewMode);
          setOverviewHash();
          rerenderAll();
        } catch (error) {
          console.error('Failed to delete streak', error);
        }
      },
      viewMode,
      (mode) => {
        viewMode = mode;
        storeViewMode(mode);
        if (mode === 'overview') {
          setOverviewHash();
        }
        rerenderAll();
      },
    );
  };

  hashChangeHandler = handleHashNavigation;
  bindHashChangeHandler();

  rerenderAll();
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
