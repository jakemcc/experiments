import { setup } from './main';

describe('Commitment UI', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div>
        <span>Commit:</span>
        <button id="commit-yes" class="choice yes" type="button">Yes</button>
        <button id="commit-no" class="choice no" type="button">No</button>
      </div>
      <div>
        <span>Held it:</span>
        <button id="held-yes" class="choice yes" type="button">Yes</button>
        <button id="held-no" class="choice no" type="button">No</button>
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
    const commitYes = document.getElementById('commit-yes') as HTMLButtonElement;
    const heldYes = document.getElementById('held-yes') as HTMLButtonElement;
    expect(commitYes.classList.contains('selected')).toBe(true);
    expect(heldYes.classList.contains('selected')).toBe(true);
  });

  it('locks commit toggle after 30 seconds', () => {
    setup();
    const commitYes = document.getElementById('commit-yes') as HTMLButtonElement;
    commitYes.click();
    jest.advanceTimersByTime(30000);
    const commitNo = document.getElementById('commit-no') as HTMLButtonElement;
    expect(commitYes.disabled).toBe(true);
    expect(commitNo.disabled).toBe(true);
  });

  it('allows clearing a selection without selecting the other', () => {
    setup();
    const commitYes = document.getElementById('commit-yes') as HTMLButtonElement;
    const commitNo = document.getElementById('commit-no') as HTMLButtonElement;
    commitYes.click();
    expect(commitYes.classList.contains('selected')).toBe(true);
    expect(commitNo.classList.contains('selected')).toBe(false);
    commitYes.click();
    expect(commitYes.classList.contains('selected')).toBe(false);
    expect(commitNo.classList.contains('selected')).toBe(false);
  });

  it('does not allow both commit options to be selected', () => {
    setup();
    const commitYes = document.getElementById('commit-yes') as HTMLButtonElement;
    const commitNo = document.getElementById('commit-no') as HTMLButtonElement;
    commitYes.click();
    commitNo.click();
    expect(commitYes.classList.contains('selected')).toBe(false);
    expect(commitNo.classList.contains('selected')).toBe(true);
  });

  it('does not allow both held options to be selected', () => {
    setup();
    const heldYes = document.getElementById('held-yes') as HTMLButtonElement;
    const heldNo = document.getElementById('held-no') as HTMLButtonElement;
    heldYes.click();
    heldNo.click();
    expect(heldYes.classList.contains('selected')).toBe(false);
    expect(heldNo.classList.contains('selected')).toBe(true);
  });
});
