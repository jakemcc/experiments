import { setup } from './main';

describe('Commitment UI', () => {
  beforeEach(() => {
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
      <div id="success-visual"></div>`;
    localStorage.clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('restores saved toggle states on load', () => {
    localStorage.setItem('commitToggle', 'true');
    localStorage.setItem('commitFirstSetAt', String(Date.now()));
    localStorage.setItem('heldToggle', 'true');
    setup();
    const commitYes = document.getElementById('commit-yes') as HTMLInputElement;
    const heldYes = document.getElementById('held-yes') as HTMLInputElement;
    expect(commitYes.checked).toBe(true);
    expect(heldYes.checked).toBe(true);
  });

  it('locks commit toggle after 30 seconds', () => {
    setup();
    const commitYes = document.getElementById('commit-yes') as HTMLInputElement;
    commitYes.checked = true;
    commitYes.dispatchEvent(new Event('change'));
    jest.advanceTimersByTime(30000);
    const commitNo = document.getElementById('commit-no') as HTMLInputElement;
    expect(commitYes.disabled).toBe(true);
    expect(commitNo.disabled).toBe(true);
  });

  it('allows clearing a selection without selecting the other', () => {
    setup();
    const commitYes = document.getElementById('commit-yes') as HTMLInputElement;
    const commitNo = document.getElementById('commit-no') as HTMLInputElement;
    commitYes.checked = true;
    commitYes.dispatchEvent(new Event('change'));
    expect(commitYes.checked).toBe(true);
    expect(commitNo.checked).toBe(false);
    commitYes.checked = false;
    commitYes.dispatchEvent(new Event('change'));
    expect(commitYes.checked).toBe(false);
    expect(commitNo.checked).toBe(false);
  });

  it('does not allow both commit options to be selected', () => {
    setup();
    const commitYes = document.getElementById('commit-yes') as HTMLInputElement;
    const commitNo = document.getElementById('commit-no') as HTMLInputElement;
    commitYes.checked = true;
    commitYes.dispatchEvent(new Event('change'));
    commitNo.checked = true;
    commitNo.dispatchEvent(new Event('change'));
    expect(commitYes.checked).toBe(false);
    expect(commitNo.checked).toBe(true);
  });

  it('does not allow both held options to be selected', () => {
    setup();
    const heldYes = document.getElementById('held-yes') as HTMLInputElement;
    const heldNo = document.getElementById('held-no') as HTMLInputElement;
    heldYes.checked = true;
    heldYes.dispatchEvent(new Event('change'));
    heldNo.checked = true;
    heldNo.dispatchEvent(new Event('change'));
    expect(heldYes.checked).toBe(false);
    expect(heldNo.checked).toBe(true);
  });

  it('records held days on reset', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    localStorage.setItem('commitFirstSetAt', String(yesterday.getTime()));
    localStorage.setItem('heldToggle', 'true');
    setup();
    const successes = JSON.parse(localStorage.getItem('heldSuccessDates') || '[]');
    expect(successes).toContain(yesterday.toISOString().split('T')[0]);
    expect(localStorage.getItem('heldToggle')).toBeNull();
  });

  it('records failed days on reset', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    localStorage.setItem('commitFirstSetAt', String(yesterday.getTime()));
    localStorage.setItem('heldToggle', 'false');
    setup();
    const failures = JSON.parse(localStorage.getItem('heldFailureDates') || '[]');
    expect(failures).toContain(yesterday.toISOString().split('T')[0]);
    expect(localStorage.getItem('heldToggle')).toBeNull();
  });

  it('prompts for held selection when missing from previous day', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    localStorage.setItem('commitFirstSetAt', String(yesterday.getTime()));
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    setup();
    expect(alertSpy).toHaveBeenCalledWith('Please record whether you held your commitment yesterday.');
    const heldYes = document.getElementById('held-yes') as HTMLInputElement;
    heldYes.checked = true;
    heldYes.dispatchEvent(new Event('change'));
    const successes = JSON.parse(localStorage.getItem('heldSuccessDates') || '[]');
    expect(successes).toContain(yesterday.toISOString().split('T')[0]);
    expect(localStorage.getItem('heldToggle')).toBeNull();
    const commitYes = document.getElementById('commit-yes') as HTMLInputElement;
    expect(commitYes.disabled).toBe(false);
    alertSpy.mockRestore();
  });

  it('warns and clears after multiple days of inactivity', () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    localStorage.setItem('commitFirstSetAt', String(twoDaysAgo.getTime()));
    localStorage.setItem('commitToggle', 'true');
    const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
    setup();
    expect(alertSpy).toHaveBeenCalledWith('It has been a while since your last visit. Please open the app more often.');
    expect(localStorage.getItem('commitToggle')).toBeNull();
    alertSpy.mockRestore();
  });

  it('renders success visualization', () => {
    const todayStr = new Date().toISOString().split('T')[0];
    localStorage.setItem('heldSuccessDates', JSON.stringify([todayStr]));
    setup();
    const squares = document.querySelectorAll('#success-visual .day');
    expect(squares.length).toBe(7);
    expect(squares[squares.length - 1].classList.contains('success')).toBe(true);
  });

  it('renders failure visualization', () => {
    const todayStr = new Date().toISOString().split('T')[0];
    localStorage.setItem('heldFailureDates', JSON.stringify([todayStr]));
    setup();
    const squares = document.querySelectorAll('#success-visual .day');
    expect(squares.length).toBe(7);
    expect(squares[squares.length - 1].classList.contains('failure')).toBe(true);
  });
});
