import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTION_POINTS,
  addAction,
  clearSession,
  createInitialSession,
  loadSession,
  saveSession,
} from './app.js';

function createStorage() {
  const values = new Map();

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test('adding a grade action appends to the log and updates the derived total', () => {
  const session = addAction(createInitialSession(), 'V4');

  assert.deepEqual(session.actions, ['V4']);
  assert.equal(session.total, 4);
});

test('attempt actions are worth one point', () => {
  const session = addAction(createInitialSession(), 'Attempt');

  assert.deepEqual(session.actions, ['Attempt']);
  assert.equal(session.total, 1);
});

test('multiple actions accumulate from the log', () => {
  const session = ['Attempt', 'V3', 'V7'].reduce(addAction, createInitialSession());

  assert.deepEqual(session.actions, ['Attempt', 'V3', 'V7']);
  assert.equal(session.total, 11);
});

test('saving then loading round-trips the session through storage', () => {
  const storage = createStorage();
  const original = ['Attempt', 'V5', 'V9'].reduce(addAction, createInitialSession());

  saveSession(storage, original);

  const restored = loadSession(storage);
  assert.deepEqual(restored.actions, original.actions);
  assert.equal(restored.total, 15);
});

test('clearing removes persisted actions and resets the derived total', () => {
  const storage = createStorage();
  saveSession(storage, ['V4', 'Attempt'].reduce(addAction, createInitialSession()));

  clearSession(storage);

  assert.deepEqual(loadSession(storage), createInitialSession());
});

test('invalid persisted data falls back to an empty session', () => {
  const storage = createStorage();
  storage.setItem('v-points-session', JSON.stringify({ actions: ['V4', 'Bogus'] }));

  assert.deepEqual(loadSession(storage), createInitialSession());
});

test('action points cover attempts and grades V3 through V9', () => {
  assert.deepEqual(ACTION_POINTS, {
    Attempt: 1,
    V3: 3,
    V4: 4,
    V5: 5,
    V6: 6,
    V7: 7,
    V8: 8,
    V9: 9,
  });
});
