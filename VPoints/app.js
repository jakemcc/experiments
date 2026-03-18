export const STORAGE_KEY = 'v-points-session';

export const ACTION_POINTS = {
  Attempt: 1,
  V3: 3,
  V4: 4,
  V5: 5,
  V6: 6,
  V7: 7,
  V8: 8,
  V9: 9,
};

export function createInitialSession() {
  return {
    actions: [],
    total: 0,
  };
}

function isAction(action) {
  return Object.hasOwn(ACTION_POINTS, action);
}

function deriveTotal(actions) {
  return actions.reduce((total, action) => total + ACTION_POINTS[action], 0);
}

function normalizeSession(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.actions)) {
    return createInitialSession();
  }

  if (!value.actions.every(isAction)) {
    return createInitialSession();
  }

  return {
    actions: [...value.actions],
    total: deriveTotal(value.actions),
  };
}

export function addAction(session, action) {
  if (!isAction(action)) {
    return session;
  }

  const actions = [...session.actions, action];
  return {
    actions,
    total: deriveTotal(actions),
  };
}

export function saveSession(storage, session) {
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      actions: session.actions,
    }),
  );
}

export function loadSession(storage) {
  const rawValue = storage.getItem(STORAGE_KEY);
  if (!rawValue) {
    return createInitialSession();
  }

  try {
    return normalizeSession(JSON.parse(rawValue));
  } catch {
    return createInitialSession();
  }
}

export function clearSession(storage) {
  storage.removeItem(STORAGE_KEY);
}

function render(session, elements) {
  elements.total.textContent = String(session.total);
  elements.log.innerHTML = '';

  if (session.actions.length === 0) {
    elements.empty.hidden = false;
    return;
  }

  elements.empty.hidden = true;
  [...session.actions].reverse().forEach((action) => {
    const item = document.createElement('li');
    item.textContent = action;
    elements.log.append(item);
  });
}

function bindActionButtons(sessionRef, storage, elements) {
  elements.actionButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.action;
      if (!isAction(action)) {
        return;
      }

      sessionRef.current = addAction(sessionRef.current, action);
      saveSession(storage, sessionRef.current);
      render(sessionRef.current, elements);
    });
  });

  elements.clear.addEventListener('click', () => {
    sessionRef.current = createInitialSession();
    clearSession(storage);
    render(sessionRef.current, elements);
  });
}

export function setupApp({
  storage = window.localStorage,
  root = document,
} = {}) {
  const elements = {
    total: root.getElementById('total-points'),
    log: root.getElementById('action-log'),
    empty: root.getElementById('empty-state'),
    clear: root.getElementById('clear-log'),
    actionButtons: Array.from(root.querySelectorAll('[data-action]')),
  };

  const sessionRef = {
    current: loadSession(storage),
  };

  bindActionButtons(sessionRef, storage, elements);
  render(sessionRef.current, elements);
}
