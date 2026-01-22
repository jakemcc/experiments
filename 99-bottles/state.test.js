import test from 'node:test';
import assert from 'node:assert/strict';

import { applyAction } from './state.js';

test('clicking the next box increments maxClicked', () => {
  assert.equal(applyAction(0, 1, 99), 1);
  assert.equal(applyAction(1, 2, 99), 2);
});

test('clicking a future box does nothing', () => {
  assert.equal(applyAction(1, 3, 99), 1);
});

test('only the last clicked box can be unclicked', () => {
  assert.equal(applyAction(2, 2, 99), 1);
  assert.equal(applyAction(2, 1, 99), 2);
});

test('cannot decrement below zero', () => {
  assert.equal(applyAction(0, 1, 99), 1);
  assert.equal(applyAction(0, 0, 99), 0);
  assert.equal(applyAction(0, 0, 1), 0);
});

test('cannot increment past total', () => {
  assert.equal(applyAction(99, 100, 99), 99);
  assert.equal(applyAction(99, 99, 99), 98);
});
