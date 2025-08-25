import { setup } from './main';

describe('Commitment UI', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div>
        <label>Commit: <input type="checkbox" id="commit-toggle"></label>
        <span id="commit-label">No</span>
      </div>
      <div>
        <label>Held it: <input type="checkbox" id="held-toggle"></label>
        <span id="held-label">No</span>
      </div>`;
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
    const commit = document.getElementById('commit-toggle') as HTMLInputElement;
    const held = document.getElementById('held-toggle') as HTMLInputElement;
    expect(commit.checked).toBe(true);
    expect(held.checked).toBe(true);
  });

  it('locks commit toggle after 30 seconds', () => {
    setup();
    const commit = document.getElementById('commit-toggle') as HTMLInputElement;
    commit.checked = true;
    commit.dispatchEvent(new Event('change'));
    jest.advanceTimersByTime(30000);
    expect(commit.disabled).toBe(true);
  });
});
