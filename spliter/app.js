const HASH_PREFIX = '#trip=';

export function createDefaultTrip() {
  return {
    people: ['Alex', 'Blair', 'Casey'],
    expenses: [
      { description: 'Rental car', amountCents: 24000, payer: 0, shares: [1, 1, 1] },
      { description: 'Hotel', amountCents: 18000, payer: 1, shares: [1, 2, 1] },
    ],
  };
}

export function createExpense(personCount, payer = 0) {
  return {
    description: '',
    amountCents: 0,
    payer: Number.isInteger(payer) && payer >= 0 && payer < personCount ? payer : 0,
    shares: Array(personCount).fill(1),
  };
}

function cloneDefaultTrip() {
  return structuredClone(createDefaultTrip());
}

function validTrip(value) {
  return value
    && typeof value === 'object'
    && Array.isArray(value.people)
    && value.people.length >= 2
    && value.people.every((person) => typeof person === 'string' && person.trim())
    && Array.isArray(value.expenses)
    && value.expenses.every((expense) => (
      expense
      && typeof expense === 'object'
      && typeof expense.description === 'string'
      && Number.isSafeInteger(expense.amountCents)
      && expense.amountCents >= 0
      && Number.isInteger(expense.payer)
      && expense.payer >= 0
      && expense.payer < value.people.length
      && Array.isArray(expense.shares)
      && expense.shares.length === value.people.length
      && expense.shares.every((share) => Number.isFinite(share) && share >= 0)
    ));
}

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromBase64Url(value) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeTrip(trip) {
  return `${HASH_PREFIX}${toBase64Url(JSON.stringify(trip))}`;
}

export function decodeTrip(hash) {
  if (typeof hash !== 'string' || !hash.startsWith(HASH_PREFIX)) {
    return cloneDefaultTrip();
  }

  try {
    const trip = JSON.parse(fromBase64Url(hash.slice(HASH_PREFIX.length)));
    return validTrip(trip) ? trip : cloneDefaultTrip();
  } catch {
    return cloneDefaultTrip();
  }
}

function splitAmount(amountCents, shares) {
  const totalShares = shares.reduce((total, share) => total + share, 0);
  if (totalShares === 0) return Array(shares.length).fill(0);
  const portions = shares.map((share, index) => {
    const exact = (amountCents * share) / totalShares;
    return { index, amount: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let remaining = amountCents - portions.reduce((total, portion) => total + portion.amount, 0);

  portions
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index)
    .forEach((portion) => {
      if (remaining > 0) {
        portion.amount += 1;
        remaining -= 1;
      }
    });

  return portions.sort((left, right) => left.index - right.index).map((portion) => portion.amount);
}

export function calculateBalances(trip) {
  const balances = Array(trip.people.length).fill(0);

  trip.expenses.forEach((expense) => {
    calculateExpenseBreakdown(trip, expense).forEach((entry, personIndex) => {
      balances[personIndex] += entry.paidCents - entry.owesCents;
    });
  });

  return balances;
}

export function calculateExpenseBreakdown(trip, expense) {
  const owedCents = splitAmount(expense.amountCents, expense.shares);
  return trip.people.map((person, index) => ({
    person,
    paidCents: index === expense.payer ? expense.amountCents : 0,
    owesCents: owedCents[index],
  }));
}

export function suggestTransfers(people, balances) {
  const creditors = balances
    .map((balance, index) => ({ index, amountCents: balance }))
    .filter(({ amountCents }) => amountCents > 0)
    .sort((left, right) => right.amountCents - left.amountCents);
  const debtors = balances
    .map((balance, index) => ({ index, amountCents: -balance }))
    .filter(({ amountCents }) => amountCents > 0)
    .sort((left, right) => right.amountCents - left.amountCents);
  let best = null;

  function findFewestTransfers(remainingDebtors, remainingCreditors, transfers) {
    if (best && transfers.length >= best.length) return;
    const debtorIndex = remainingDebtors.findIndex(({ amountCents }) => amountCents > 0);
    if (debtorIndex === -1) {
      best = transfers;
      return;
    }

    const debtor = remainingDebtors[debtorIndex];
    const triedAmounts = new Set();
    remainingCreditors.forEach((creditor, creditorIndex) => {
      if (creditor.amountCents === 0 || triedAmounts.has(creditor.amountCents)) return;
      triedAmounts.add(creditor.amountCents);
      const amountCents = Math.min(debtor.amountCents, creditor.amountCents);
      const nextDebtors = remainingDebtors.map((item, index) => (
        index === debtorIndex ? { ...item, amountCents: item.amountCents - amountCents } : item
      ));
      const nextCreditors = remainingCreditors.map((item, index) => (
        index === creditorIndex ? { ...item, amountCents: item.amountCents - amountCents } : item
      ));
      findFewestTransfers(nextDebtors, nextCreditors, [
        ...transfers,
        { from: people[debtor.index], to: people[creditor.index], amountCents },
      ]);
    });
  }

  findFewestTransfers(debtors, creditors, []);
  return best || [];
}

function formatMoney(amountCents) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2,
  }).format(amountCents / 100);
}

function amountInputValue(amountCents) {
  return (amountCents / 100).toFixed(2);
}

function renderPersonInputs(trip) {
  return trip.people.map((person, index) => `
    <label class="person-input">
      <span class="sr-only">Person ${index + 1} name</span>
      <input data-person-name="${index}" value="${escapeAttribute(person)}" maxlength="32" />
      <button class="icon-button" type="button" data-remove-person="${index}" aria-label="Remove ${escapeAttribute(person)}" ${trip.people.length <= 2 ? 'disabled' : ''}>×</button>
    </label>
  `).join('');
}

function escapeAttribute(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

function renderExpenseBreakdown(trip, expense) {
  const breakdown = calculateExpenseBreakdown(trip, expense).map((entry) => `
    <li>
      <strong>${escapeAttribute(entry.person)}</strong>
      <span>Owes <b>${formatMoney(entry.owesCents)}</b></span>
      <span class="${entry.paidCents ? 'expense-paid' : 'expense-not-paid'}">Paid <b>${formatMoney(entry.paidCents)}</b></span>
    </li>
  `).join('');

  return `
    <strong>For this expense</strong>
    <ul>${breakdown}</ul>
  `;
}

function renderExpense(expense, expenseIndex, trip) {
  const payerOptions = trip.people.map((person, personIndex) => `
    <option value="${personIndex}" ${expense.payer === personIndex ? 'selected' : ''}>${escapeAttribute(person)}</option>
  `).join('');
  const shares = trip.people.map((person, personIndex) => `
    <label class="share-field">
      <span>${escapeAttribute(person)}</span>
      <input type="number" inputmode="decimal" min="0" step="0.25" value="${expense.shares[personIndex]}" data-share="${expenseIndex}:${personIndex}" aria-label="${escapeAttribute(person)} share of ${escapeAttribute(expense.description || 'expense')}" />
    </label>
  `).join('');
  return `
    <article class="expense-card">
      <div class="expense-topline">
        <label class="field grow">
          <span>What was it?</span>
          <input value="${escapeAttribute(expense.description)}" data-description="${expenseIndex}" placeholder="e.g. Dinner" maxlength="60" />
        </label>
        <label class="field amount-field">
          <span>Cost</span>
          <span class="money-input"><span>$</span><input type="number" inputmode="decimal" min="0" step="0.01" value="${amountInputValue(expense.amountCents)}" data-amount="${expenseIndex}" aria-label="Cost" /></span>
        </label>
        <button class="remove-expense" type="button" data-remove-expense="${expenseIndex}">Remove</button>
      </div>
      <label class="field paid-by">
        <span>Paid by</span>
        <select data-payer="${expenseIndex}">${payerOptions}</select>
      </label>
      <div class="shares">
        <div>
          <strong>Split weights</strong>
          <p>Use any ratio: 1 / 4, 2 / 4, 1 / 4 — or 1 / 1 / 1.</p>
        </div>
        <div class="share-grid">${shares}</div>
      </div>
      <div class="expense-breakdown" id="expense-breakdown-${expenseIndex}">${renderExpenseBreakdown(trip, expense)}</div>
    </article>
  `;
}

function renderResults(trip) {
  const balances = calculateBalances(trip);
  const transfers = suggestTransfers(trip.people, balances);
  const balanceRows = trip.people.map((person, index) => {
    const balance = balances[index];
    const status = balance > 0 ? 'is-owed' : balance < 0 ? 'owes' : 'settled';
    const description = balance > 0
      ? `is owed ${formatMoney(balance)}`
      : balance < 0
        ? `owes ${formatMoney(-balance)}`
        : 'is all settled up';
    return `<li><span>${escapeAttribute(person)}</span><span class="${status}">${description}</span></li>`;
  }).join('');
  const transferRows = transfers.length
    ? transfers.map((transfer) => `<li><strong>${escapeAttribute(transfer.from)}</strong><span>pays</span><strong>${escapeAttribute(transfer.to)}</strong><b>${formatMoney(transfer.amountCents)}</b></li>`).join('')
    : '<li class="settled-message">Everyone is settled up.</li>';

  return { balanceRows, transferRows, transferCount: transfers.length };
}

function renderResultPanels(trip, root) {
  const results = renderResults(trip);
  trip.expenses.forEach((expense, index) => {
    const breakdown = root.getElementById(`expense-breakdown-${index}`);
    if (breakdown) breakdown.innerHTML = renderExpenseBreakdown(trip, expense);
  });
  root.getElementById('balances').innerHTML = results.balanceRows;
  root.getElementById('transfers').innerHTML = results.transferRows;
  root.getElementById('transfer-count').textContent = results.transferCount === 1 ? '1 transfer' : `${results.transferCount} transfers`;
}

function render(trip, root) {
  const results = renderResults(trip);
  root.getElementById('person-inputs').innerHTML = renderPersonInputs(trip);
  root.getElementById('expense-list').innerHTML = trip.expenses.length
    ? trip.expenses.map((expense, index) => renderExpense(expense, index, trip)).join('')
    : '<p class="empty-expenses">No expenses yet. Add the first one when someone pays.</p>';
  root.getElementById('balances').innerHTML = results.balanceRows;
  root.getElementById('transfers').innerHTML = results.transferRows;
  root.getElementById('transfer-count').textContent = results.transferCount === 1 ? '1 transfer' : `${results.transferCount} transfers`;
}

function toCents(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) : 0;
}

function updateHash(trip) {
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${encodeTrip(trip)}`);
}

function bindEvents(root, state) {
  root.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const { personName, description, amount, share } = target.dataset;
    let changed = false;

    if (personName !== undefined) {
      state.trip.people[Number(personName)] = target.value || `Person ${Number(personName) + 1}`;
      changed = true;
    } else if (description !== undefined) {
      state.trip.expenses[Number(description)].description = target.value;
      changed = true;
    } else if (amount !== undefined) {
      state.trip.expenses[Number(amount)].amountCents = toCents(target.value);
      changed = true;
    } else if (share !== undefined) {
      const [expenseIndex, personIndex] = share.split(':').map(Number);
      state.trip.expenses[expenseIndex].shares[personIndex] = Math.max(0, Number(target.value) || 0);
      changed = true;
    }

    if (changed) {
      updateHash(state.trip);
      renderResultPanels(state.trip, root);
    }
  });

  root.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || target.dataset.payer === undefined) return;
    state.trip.expenses[Number(target.dataset.payer)].payer = Number(target.value);
    updateHash(state.trip);
    renderResultPanels(state.trip, root);
  });

  root.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.id === 'add-person') {
      state.trip.people.push(`Person ${state.trip.people.length + 1}`);
      state.trip.expenses.forEach((expense) => expense.shares.push(1));
    } else if (button.dataset.removePerson !== undefined) {
      const index = Number(button.dataset.removePerson);
      state.trip.people.splice(index, 1);
      state.trip.expenses.forEach((expense) => {
        expense.shares.splice(index, 1);
        if (expense.payer === index) expense.payer = 0;
        else if (expense.payer > index) expense.payer -= 1;
      });
    } else if (button.id === 'add-expense') {
      const previousExpense = state.trip.expenses.at(-1);
      state.trip.expenses.push(createExpense(state.trip.people.length, previousExpense?.payer));
    } else if (button.dataset.removeExpense !== undefined) {
      state.trip.expenses.splice(Number(button.dataset.removeExpense), 1);
    } else if (button.id === 'reset-trip') {
      state.trip = cloneDefaultTrip();
    } else {
      return;
    }
    updateHash(state.trip);
    render(state.trip, root);
  });
}

export function setupApp({ root = document } = {}) {
  const state = { trip: decodeTrip(window.location.hash) };
  bindEvents(root, state);
  window.addEventListener('hashchange', () => {
    state.trip = decodeTrip(window.location.hash);
    render(state.trip, root);
  });

  if (!window.location.hash.startsWith(HASH_PREFIX)) updateHash(state.trip);
  render(state.trip, root);
}
