const DB_NAME = 'streak-tracker';
const DB_VERSION = 1;
const STORE_NAME = 'dayStates';
const DATE_KEY_PATTERN = /^\d{4}-\d{1,2}-\d{1,2}$/;

let dbPromise: Promise<IDBDatabase> | null = null;

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
  const entries: { key: string; state: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !DATE_KEY_PATTERN.test(key)) {
      continue;
    }
    const value = localStorage.getItem(key);
    const state = Number(value);
    if (!Number.isFinite(state) || state <= 0) {
      continue;
    }
    entries.push({ key, state });
  }

  if (entries.length === 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const entry of entries) {
      store.put(entry.state, entry.key);
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

async function getAllDayStates(db: IDBDatabase): Promise<Map<string, number>> {
  const states = new Map<string, number>();
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
        if (typeof cursor.value === 'number') {
          states.set(cursor.key as string, cursor.value);
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
  return states;
}

async function setDayState(db: IDBDatabase, key: string, state: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(state, key);
    tx.oncomplete = () => resolve();
    tx.onabort = () => {
      reject(tx.error ?? new Error('Failed to save state'));
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error('Failed to save state'));
    };
  });
}

async function removeDayState(db: IDBDatabase, key: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onabort = () => {
      reject(tx.error ?? new Error('Failed to remove state'));
    };
    tx.onerror = () => {
      reject(tx.error ?? new Error('Failed to remove state'));
    };
  });
}

function getStoredMonths(
  now: Date,
  stateMap: Map<string, number>,
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
}

export async function setup(): Promise<void> {
  void requestPersistentStorage();
  const container = document.getElementById('calendars');
  if (!container) {
    return;
  }
  container.innerHTML = '';

  const now = new Date();
  const db = await getDb();
  await migrateFromLocalStorage(db);
  const stateMap = await getAllDayStates(db);
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

    const monthState = new Map<number, number>();
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
        const state = monthState.get(day) ?? 0;
        if (state === 1) {
          colorCounts.red++;
          currentStreaks.red++;
          currentStreaks.green = 0;
          currentStreaks.blue = 0;
          currentGreenBlueStreak = 0;
          if (currentStreaks.red > longestStreaks.red) {
            longestStreaks.red = currentStreaks.red;
          }
        } else if (state === 2) {
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
        } else if (state === 3) {
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
        let state = monthState.get(value) ?? 0;
        const applyState = (s: number) => {
          cell.classList.remove('red', 'green', 'blue');
          if (s === 1) {
            cell.classList.add('red');
          } else if (s === 2) {
            cell.classList.add('green');
          } else if (s === 3) {
            cell.classList.add('blue');
          }
        };
        applyState(state);
        cell.addEventListener('click', async () => {
          state = (state + 1) % 4;
          applyState(state);
          if (state === 0) {
            monthState.delete(value);
            stateMap.delete(dateKey);
            try {
              await removeDayState(db, dateKey);
            } catch (error) {
              console.error('Failed to remove day state', error);
            }
          } else {
            monthState.set(value, state);
            stateMap.set(dateKey, state);
            try {
              await setDayState(db, dateKey, state);
            } catch (error) {
              console.error('Failed to save day state', error);
            }
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
