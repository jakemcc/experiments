import {
  setup,
  adjustDay,
  clearAllStoredDataForTests,
  getStoredValueForTests,
} from './main';

async function flushAsyncOperations() {
  await Promise.resolve();
  const timeoutFn = setTimeout as unknown as { mock?: unknown; _isMockFunction?: boolean };
  const usingFakeTimers = typeof (timeoutFn as { clock?: unknown }).clock === 'object';
  if (usingFakeTimers && typeof jest !== 'undefined' && typeof jest.runOnlyPendingTimers === 'function') {
    try {
      jest.runOnlyPendingTimers();
    } catch {
      // Timers are not mocked; ignore.
    }
  }
  await new Promise((resolve) => {
    if (typeof setImmediate === 'function') {
      setImmediate(resolve);
    } else {
      setTimeout(resolve, 0);
    }
  });
}

async function waitForCondition(condition: () => boolean | Promise<boolean>, maxAttempts = 20) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await condition()) {
      return;
    }
    await flushAsyncOperations();
  }
  throw new Error('Condition not met within allotted attempts');
}

function mockDate(dateString: string): () => void {
  const RealDate = Date;
  const fixedTime = new RealDate(dateString).getTime();
  class MockDate extends Date {
    constructor(...args: ConstructorParameters<typeof Date>) {
      if (args.length > 0) {
        super(...args);
      } else {
        super(fixedTime);
      }
    }
    static now() {
      return fixedTime;
    }
    static parse = RealDate.parse;
    static UTC = RealDate.UTC;
  }
  globalThis.Date = MockDate as unknown as DateConstructor;
  return () => {
    globalThis.Date = RealDate;
  };
}

describe('Commitment UI', () => {
  beforeEach(async () => {
    document.body.innerHTML = `
      <div>
        <span>Commit:</span>
        <label><input type="checkbox" name="commit" id="commit-yes" value="yes"> Yes</label>
        <label><input type="checkbox" name="commit" id="commit-no" value="no"> No</label>
      </div>
      <div>
        <span>Held it:</span>
        <label><input type="checkbox" name="held" id="held-yes" value="yes"> Yes</label>
        <label><input type="checkbox" name="held" id="held-no" value="no"> No</label>
      </div>
      <div id="held-prompt" hidden></div>
      <div id="success-visual"></div>`;
    localStorage.clear();
    await clearAllStoredDataForTests();
  });

  afterEach(() => {
    jest.useRealTimers();
    window.history.pushState({}, '', '/');
  });

  it('restores saved toggle states on load', async () => {
    localStorage.setItem('commitToggle', 'true');
    localStorage.setItem('commitFirstSetAt', String(Date.now()));
    localStorage.setItem('heldToggle', 'true');
    await setup();
    const commitYes = document.getElementById('commit-yes') as HTMLInputElement;
    const heldYes = document.getElementById('held-yes') as HTMLInputElement;
    expect(commitYes.checked).toBe(true);
    expect(heldYes.checked).toBe(true);
  });

  it('locks commit toggle after 30 seconds', async () => {
    const timeoutSpy = jest.spyOn(window, 'setTimeout');
    try {
      await setup();
      const commitYes = document.getElementById('commit-yes') as HTMLInputElement;
      const commitNo = document.getElementById('commit-no') as HTMLInputElement;
      commitYes.checked = true;
      commitYes.dispatchEvent(new Event('change'));
      await waitForCondition(() =>
        timeoutSpy.mock.calls.some(([, delay]) => typeof delay === 'number' && delay > 0)
      );
      const lockCall = timeoutSpy.mock.calls
        .slice()
        .reverse()
        .find(([, delay]) => typeof delay === 'number' && (delay as number) > 0);
      expect(lockCall).toBeDefined();
      const [lockCallback, delay] = lockCall as [() => void, number];
      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(30000);
      lockCallback();
      expect(commitYes.disabled).toBe(true);
      expect(commitNo.disabled).toBe(true);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it('allows clearing a selection without selecting the other', async () => {
    await setup();
    const commitYes = document.getElementById('commit-yes') as HTMLInputElement;
    const commitNo = document.getElementById('commit-no') as HTMLInputElement;
    commitYes.checked = true;
    commitYes.dispatchEvent(new Event('change'));
    await flushAsyncOperations();
    expect(commitYes.checked).toBe(true);
    expect(commitNo.checked).toBe(false);
    commitYes.checked = false;
    commitYes.dispatchEvent(new Event('change'));
    await flushAsyncOperations();
    expect(commitYes.checked).toBe(false);
    expect(commitNo.checked).toBe(false);
  });

  it('does not allow both commit options to be selected', async () => {
    await setup();
    const commitYes = document.getElementById('commit-yes') as HTMLInputElement;
    const commitNo = document.getElementById('commit-no') as HTMLInputElement;
    commitYes.checked = true;
    commitYes.dispatchEvent(new Event('change'));
    await flushAsyncOperations();
    commitNo.checked = true;
    commitNo.dispatchEvent(new Event('change'));
    await flushAsyncOperations();
    expect(commitYes.checked).toBe(false);
    expect(commitNo.checked).toBe(true);
  });

  it('does not allow both held options to be selected', async () => {
    await setup();
    const heldYes = document.getElementById('held-yes') as HTMLInputElement;
    const heldNo = document.getElementById('held-no') as HTMLInputElement;
    heldYes.checked = true;
    heldYes.dispatchEvent(new Event('change'));
    await flushAsyncOperations();
    heldNo.checked = true;
    heldNo.dispatchEvent(new Event('change'));
    await flushAsyncOperations();
    expect(heldYes.checked).toBe(false);
    expect(heldNo.checked).toBe(true);
  });

  it('records held days on reset', async () => {
    const restoreDate = mockDate('2023-01-02T05:00:00Z');
    try {
      const commitTime = new Date('2023-01-01T22:00:00Z');
      localStorage.setItem('commitFirstSetAt', String(commitTime.getTime()));
      localStorage.setItem('heldToggle', 'true');
      await setup();
      const successRaw = await getStoredValueForTests('heldSuccessDates');
      const successes = JSON.parse(successRaw || '[]');
      expect(successes).toContain(commitTime.toISOString().split('T')[0]);
      expect(await getStoredValueForTests('heldToggle')).toBeNull();
    } finally {
      restoreDate();
    }
  });

  it('records failed days on reset', async () => {
    const restoreDate = mockDate('2023-01-02T05:00:00Z');
    try {
      const commitTime = new Date('2023-01-01T22:00:00Z');
      localStorage.setItem('commitFirstSetAt', String(commitTime.getTime()));
      localStorage.setItem('heldToggle', 'false');
      await setup();
      const failureRaw = await getStoredValueForTests('heldFailureDates');
      const failures = JSON.parse(failureRaw || '[]');
      expect(failures).toContain(commitTime.toISOString().split('T')[0]);
      expect(await getStoredValueForTests('heldToggle')).toBeNull();
    } finally {
      restoreDate();
    }
  });

  it('prompts for held selection when missing from previous day', async () => {
    const restoreDate = mockDate('2023-01-02T05:00:00Z');
    try {
      const commitTime = new Date('2023-01-01T22:00:00Z');
      localStorage.setItem('commitFirstSetAt', String(commitTime.getTime()));
      localStorage.setItem('commitToggle', 'true');
      await setup();
      expect(await getStoredValueForTests('commitFirstSetAt')).not.toBeNull();
      const prompt = document.getElementById('held-prompt') as HTMLElement;
      expect(prompt.hidden).toBe(false);
      expect(prompt.textContent).toBe('Please record whether you held your commitment yesterday.');
      const heldYes = document.getElementById('held-yes') as HTMLInputElement;
      heldYes.checked = true;
      heldYes.dispatchEvent(new Event('change'));
      await waitForCondition(() => prompt.hidden);
      const rawSuccesses = await getStoredValueForTests('heldSuccessDates');
      const successes = JSON.parse(rawSuccesses || '[]');
      expect(successes).toContain(commitTime.toISOString().split('T')[0]);
      expect(await getStoredValueForTests('heldToggle')).toBeNull();
      const commitYes = document.getElementById('commit-yes') as HTMLInputElement;
      expect(commitYes.disabled).toBe(false);
      expect(prompt.hidden).toBe(true);
    } finally {
      restoreDate();
    }
  });

  it('updates success visualization after recording held result', async () => {
    const restoreDate = mockDate('2023-01-02T05:00:00Z');
    try {
      const commitTime = new Date('2023-01-01T22:00:00Z');
      localStorage.setItem('commitFirstSetAt', String(commitTime.getTime()));
      localStorage.setItem('commitToggle', 'true');
      await setup();
      expect(await getStoredValueForTests('commitFirstSetAt')).not.toBeNull();
      const heldYes = document.getElementById('held-yes') as HTMLInputElement;
      heldYes.checked = true;
      heldYes.dispatchEvent(new Event('change'));
      await waitForCondition(() => {
        const squares = document.querySelectorAll('#success-visual .day');
        return squares.length >= 2 && squares[squares.length - 2].classList.contains('success');
      });
      const squares = document.querySelectorAll('#success-visual .day');
      expect(squares[squares.length - 2].classList.contains('success')).toBe(true);
    } finally {
      restoreDate();
    }
  });

  it('records success for the previous local day when crossing UTC midnight', async () => {
    const realOffset = Date.prototype.getTimezoneOffset;
    Date.prototype.getTimezoneOffset = () => 300;
    const restoreDate = mockDate('2023-01-02T13:00:00Z');
    try {
      const commitTime = new Date('2023-01-02T03:00:00Z');
      localStorage.setItem('commitFirstSetAt', String(commitTime.getTime()));
      localStorage.setItem('commitToggle', 'true');
      await setup();
      const heldYes = document.getElementById('held-yes') as HTMLInputElement;
      heldYes.checked = true;
      heldYes.dispatchEvent(new Event('change'));
      await waitForCondition(() => {
        const squares = document.querySelectorAll('#success-visual .day');
        return squares.length >= 2 && squares[squares.length - 2].classList.contains('success');
      });
      const successes = JSON.parse((await getStoredValueForTests('heldSuccessDates')) || '[]');
      expect(successes).toContain('2023-01-01');
      const squares = document.querySelectorAll('#success-visual .day');
      expect(squares[squares.length - 2].classList.contains('success')).toBe(true);
    } finally {
      Date.prototype.getTimezoneOffset = realOffset;
      restoreDate();
    }
  });

  it('warns and clears after multiple days of inactivity', async () => {
    const restoreDate = mockDate('2023-01-03T05:00:00Z');
    try {
      const commitTime = new Date('2023-01-01T22:00:00Z');
      localStorage.setItem('commitFirstSetAt', String(commitTime.getTime()));
      localStorage.setItem('commitToggle', 'true');
      const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
      await setup();
      expect(alertSpy).toHaveBeenCalledWith('It has been a while since your last visit. Please open the app more often.');
      expect(await getStoredValueForTests('commitToggle')).toBeNull();
      alertSpy.mockRestore();
    } finally {
      restoreDate();
    }
  });

  it('renders success visualization', async () => {
    const restoreDate = mockDate('2023-01-05T12:00:00Z');
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      localStorage.setItem('heldSuccessDates', JSON.stringify([todayStr]));
      await setup();
      const squares = document.querySelectorAll('#success-visual .day');
      expect(squares.length).toBe(7);
      expect(squares[squares.length - 1].classList.contains('success')).toBe(true);
    } finally {
      restoreDate();
    }
  });

  it('renders failure visualization', async () => {
    const restoreDate = mockDate('2023-01-05T12:00:00Z');
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      localStorage.setItem('heldFailureDates', JSON.stringify([todayStr]));
      await setup();
      const squares = document.querySelectorAll('#success-visual .day');
      expect(squares.length).toBe(7);
      expect(squares[squares.length - 1].classList.contains('failure')).toBe(true);
    } finally {
      restoreDate();
    }
  });

  it('shows dates under success visualization', async () => {
    const restoreDate = mockDate('2023-01-05T12:00:00Z');
    try {
      await setup();
      const labels = document.querySelectorAll('#success-visual .day-date');
      expect(labels.length).toBe(7);
      const today = new Date();
      const expected = `${today.getMonth() + 1}/${today.getDate()}`;
      expect(labels[labels.length - 1].textContent).toBe(expected);
    } finally {
      restoreDate();
    }
  });

  it('highlights the current day', async () => {
    const restoreDate = mockDate('2023-01-05T12:00:00Z');
    try {
      await setup();
      const squares = document.querySelectorAll('#success-visual .day');
      expect(squares.length).toBe(7);
      expect(squares[squares.length - 1].classList.contains('current')).toBe(true);
    } finally {
      restoreDate();
    }
  });

  it('shows admin controls when admin query param present', async () => {
    window.history.pushState({}, '', '/?admin=true');
    await setup();
    expect(document.getElementById('admin-next-day')).not.toBeNull();
    expect(document.getElementById('admin-clear-data')).not.toBeNull();
  });

  it('clears data with admin clear button', async () => {
    window.history.pushState({}, '', '/?admin=true');
    localStorage.setItem('commitToggle', 'true');
    const originalLocation = window.location;
    const reloadSpy = jest.fn();
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, reload: reloadSpy },
      configurable: true,
    });
    await setup();
    const clearBtn = document.getElementById('admin-clear-data') as HTMLButtonElement;
    clearBtn.click();
    await waitForCondition(async () => (await getStoredValueForTests('commitToggle')) === null);
    expect(reloadSpy).toHaveBeenCalled();
    Object.defineProperty(window, 'location', { value: originalLocation });
  });

  it('adjusts day offset', async () => {
    await adjustDay(1);
    expect(await getStoredValueForTests('adminDayOffset')).toBe('1');
  });
});
