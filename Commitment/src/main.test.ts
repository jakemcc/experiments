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
});
