import { describe, expect, it } from 'vitest';
import { actCall, actDoneState, captureName, captureText, minDay, quickDays } from './acts.js';

/* Acting on a commitment from Home, and captures sent to the inbox. */

const ID = 'cmt_01JBX000000000000000000F01';
// Wednesday Oct 28, 2026, 09:05 local.
const WED = new Date(2026, 9, 28, 9, 5);

describe('actCall', () => {
  it('maps each act to one Bousleh op', () => {
    expect(actCall('done', ID)).toEqual({ tool: 'commitments_close', input: { id: ID, status: 'done' } });
    expect(actCall('drop', ID)).toEqual({ tool: 'commitments_close', input: { id: ID, status: 'dropped', note: 'Dropped from Home.' } });
    expect(actCall('date', ID, '2026-10-30')).toEqual({ tool: 'vault_supersede', input: { id: ID, attrs: { due: '2026-10-30' } } });
    expect(actCall('snooze', ID, '2026-11-02')).toEqual({ tool: 'commitments_snooze', input: { id: ID, until: '2026-11-02' } });
    expect(['done', 'drop', 'date', 'snooze'].map((a) => actDoneState(a as 'done'))).toEqual(['done', 'dropped', 'dated', 'snoozed']);
  });
});

describe('quickDays', () => {
  it('offers today for a due date, never for a snooze', () => {
    expect(quickDays('date', WED)).toEqual([
      { label: 'Today', day: '2026-10-28' },
      { label: 'Tomorrow', day: '2026-10-29' },
      { label: 'Friday', day: '2026-10-30' },
      { label: 'Next Monday', day: '2026-11-02' },
    ]);
    expect(quickDays('snooze', WED)).toEqual([
      { label: 'Tomorrow', day: '2026-10-29' },
      { label: 'Monday', day: '2026-11-02' },
      { label: 'In a week', day: '2026-11-04' },
      { label: 'In two weeks', day: '2026-11-11' },
    ]);
    expect(minDay('date', WED)).toBe('2026-10-28');
    expect(minDay('snooze', WED)).toBe('2026-10-29');
  });

  it('keeps each day once, and Friday on a Friday is next week', () => {
    const thu = new Date(2026, 9, 29);
    // Tomorrow is Friday: one pick for that day.
    expect(quickDays('date', thu).map((p) => p.label)).toEqual(['Today', 'Tomorrow', 'Next Monday']);
    expect(quickDays('date', new Date(2026, 9, 30))[2]).toEqual({ label: 'Friday', day: '2026-11-06' });
  });
});

describe('captures', () => {
  it('drops the prompt lead-in and names the inbox file', () => {
    expect(captureText('Capture this: Peter wants the deck by Friday')).toBe('Peter wants the deck by Friday');
    expect(captureText('  Drop this:  idea for Zeus ')).toBe('idea for Zeus');
    expect(captureText('Capture this: ')).toBe('');
    expect(captureText('Plain note')).toBe('Plain note');
    expect(captureName(WED)).toBe('capture-2026-10-28-0905-home.md');
  });
});
