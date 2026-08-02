import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateBalances,
  calculateExpenseBreakdown,
  createExpense,
  createDefaultTrip,
  decodeTrip,
  encodeTrip,
  suggestTransfers,
} from './app.js';

test('the trip state round-trips through a URL-safe hash payload', () => {
  const trip = {
    people: ['Ada', 'Béla', 'Chloë'],
    expenses: [{ description: 'Dinner', amountCents: 12345, payer: 1, shares: [1, 2, 1] }],
  };

  assert.deepEqual(decodeTrip(encodeTrip(trip)), trip);
});

test('a missing or malformed payload falls back to the starter trip', () => {
  assert.deepEqual(decodeTrip('not-a-trip'), createDefaultTrip());
});

test('a new expense can retain the previous payer', () => {
  assert.deepEqual(createExpense(3, 2), {
    description: '', amountCents: 0, payer: 2, shares: [1, 1, 1],
  });
});

test('balances account for an uneven split and preserve every cent', () => {
  const trip = {
    people: ['Ada', 'Ben', 'Cora'],
    expenses: [
      { description: 'Rental car', amountCents: 12000, payer: 0, shares: [1, 1, 1] },
      { description: 'Hotel', amountCents: 9000, payer: 1, shares: [1, 2, 1] },
    ],
  };

  assert.deepEqual(calculateBalances(trip), [5750, 500, -6250]);
});

test('an expense breakdown shows each person’s share and who paid the charge', () => {
  const trip = {
    people: ['Ada', 'Ben', 'Cora'],
    expenses: [{ description: 'Hotel', amountCents: 9000, payer: 1, shares: [1, 2, 1] }],
  };

  assert.deepEqual(calculateExpenseBreakdown(trip, trip.expenses[0]), [
    { person: 'Ada', paidCents: 0, owesCents: 2250 },
    { person: 'Ben', paidCents: 9000, owesCents: 4500 },
    { person: 'Cora', paidCents: 0, owesCents: 2250 },
  ]);
});

test('remainder cents are assigned deterministically and still settle to zero', () => {
  const trip = {
    people: ['Ada', 'Ben', 'Cora'],
    expenses: [{ description: 'Coffee', amountCents: 100, payer: 0, shares: [1, 1, 1] }],
  };

  assert.deepEqual(calculateBalances(trip), [66, -33, -33]);
});

test('settlements produce a compact list of transfers', () => {
  const people = ['Ada', 'Ben', 'Cora'];
  const transfers = suggestTransfers(people, [5750, 500, -6250]);

  assert.deepEqual(transfers, [
    { from: 'Cora', to: 'Ada', amountCents: 5750 },
    { from: 'Cora', to: 'Ben', amountCents: 500 },
  ]);
});

test('settlements use the fewest transfers when a greedy pairing would not', () => {
  const transfers = suggestTransfers(
    ['Ada', 'Ben', 'Cora', 'Dev', 'Eli'],
    [800, 500, 500, -1000, -800],
  );

  assert.equal(transfers.length, 3);
  assert.deepEqual(transfers, [
    { from: 'Dev', to: 'Ben', amountCents: 500 },
    { from: 'Dev', to: 'Cora', amountCents: 500 },
    { from: 'Eli', to: 'Ada', amountCents: 800 },
  ]);
});
