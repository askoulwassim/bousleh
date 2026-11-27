import { describe, expect, it } from 'vitest';
import { actCall, captureName, captureText, dayWords, failure, minDay, quickDays, resultLabel, undoCall, validDay } from './acts.js';

/* Acting on a commitment from Home (Done, Date, Snooze, Close, and Undo), and captures sent to the inbox. */

const ID = 'cmt_01JBX000000000000000000F01';
// Friday Nov 27, 2026, 15:42 local.
const FRI = new Date(2026, 10, 27, 15, 42);

describe('actCall', () => {
  it('maps each act to one Bousleh op', () => {
    expect(actCall('done', ID)).toEqual({ tool: 'commitments_close', input: { id: ID, status: 'done' } });
    expect(actCall('close', ID)).toEqual({ tool: 'commitments_close', input: { id: ID, status: 'dropped', note: 'Closed from Home.' } });
    expect(actCall('date', ID, '2026-11-30')).toEqual({ tool: 'vault_supersede', input: { id: ID, attrs: { due: '2026-11-30' } } });
    expect(actCall('snooze', ID, '2026-12-04')).toEqual({ tool: 'commitments_snooze', input: { id: ID, until: '2026-12-04' } });
  });
});

describe('undoCall', () => {
  it('reopens a commitment marked done or closed', () => {
    for (const act of ['done', 'close'] as const) {
      expect(undoCall(act, ID, { due: null, surface_on: null })).toEqual({ tool: 'vault_supersede', input: { id: ID, status: 'open' } });
    }
  });

  it('puts back the due date and the snooze a Date replaced', () => {
    expect(undoCall('date', ID, { due: null, surface_on: null })).toEqual({
      tool: 'vault_supersede',
      input: { id: ID, attrs: { due: null, surface_on: null } },
    });
    // Dating one back from a snooze ends the snooze; Undo brings both back.
    expect(undoCall('date', ID, { due: '2026-11-20', surface_on: '2026-11-25' })).toEqual({
      tool: 'vault_supersede',
      input: { id: ID, attrs: { due: '2026-11-20', surface_on: '2026-11-25' } },
    });
  });

  it('wakes a snoozed commitment, or puts back the snooze it had', () => {
    expect(undoCall('snooze', ID, { due: null, surface_on: null })).toEqual({ tool: 'commitments_snooze', input: { id: ID, until: null } });
    expect(undoCall('snooze', ID, { due: null, surface_on: '2026-11-25' })).toEqual({
      tool: 'vault_supersede',
      input: { id: ID, attrs: { surface_on: '2026-11-25' } },
    });
  });
});

describe('the day picker', () => {
  it('offers today and the coming Monday, Wednesday and Friday for a due date', () => {
    expect(quickDays('date', FRI)).toEqual([
      { label: 'Today', day: '2026-11-27' },
      { label: 'Mon 30 Nov', day: '2026-11-30' },
      { label: 'Wed 2 Dec', day: '2026-12-02' },
      { label: 'Fri 4 Dec', day: '2026-12-04' },
    ]);
    // On a Tuesday the days come in date order: Wednesday first.
    expect(quickDays('date', new Date(2026, 11, 1)).map((p) => p.day)).toEqual(['2026-12-01', '2026-12-02', '2026-12-04', '2026-12-07']);
  });

  it('starts a snooze tomorrow, never today, and keeps each day once', () => {
    expect(quickDays('snooze', FRI)).toEqual([
      { label: 'Tomorrow', day: '2026-11-28' },
      { label: 'Monday', day: '2026-11-30' },
      { label: 'In a week', day: '2026-12-04' },
      { label: 'In two weeks', day: '2026-12-11' },
    ]);
    // On a Sunday, tomorrow is Monday: one pick.
    expect(quickDays('snooze', new Date(2026, 10, 29)).map((p) => p.label)).toEqual(['Tomorrow', 'In a week', 'In two weeks']);
    expect(minDay('date', FRI)).toBe('2026-11-27');
    expect(minDay('snooze', FRI)).toBe('2026-11-28');
  });

  it('takes a typed day only when it is a real day on or after the earliest', () => {
    expect(validDay('2026-11-30', '2026-11-28')).toBe('2026-11-30');
    expect(validDay('2026-11-27', '2026-11-28')).toBeNull();
    expect(validDay('', '2026-11-28')).toBeNull();
    expect(validDay('30/11/2026', '2026-11-28')).toBeNull();
  });
});

describe('what a card says', () => {
  it('names the result, with the day in words', () => {
    expect(dayWords('2026-11-30')).toBe('Mon 30 Nov');
    expect(resultLabel('done', undefined, '2026-11-27')).toBe('Marked done');
    expect(resultLabel('close', undefined, '2026-11-27')).toBe('Closed');
    expect(resultLabel('date', '2026-11-30', '2026-11-27')).toBe('Due Mon 30 Nov');
    expect(resultLabel('date', '2026-11-27', '2026-11-27')).toBe('Due today');
    expect(resultLabel('snooze', '2026-11-30', '2026-11-27')).toBe('Snoozed till Mon 30 Nov');
  });

  it('says a failure in a few words', () => {
    expect(failure({ code: 'server_not_connected' })).toBe("Couldn't reach Bousleh");
    expect(failure({ code: 'approval_required' })).toBe('Needs your OK in the Claude app');
    expect(failure({ code: 'conflict' })).toBe('Not changed (conflict)');
    expect(failure(null)).toBe('Not changed (error)');
  });
});

describe('captures', () => {
  it('drops a prompt lead-in and names the inbox file', () => {
    expect(captureText('Capture this: Rowan wants the deck by Friday')).toBe('Rowan wants the deck by Friday');
    expect(captureText('  Drop this:  an idea for Atlas ')).toBe('an idea for Atlas');
    expect(captureText('Capture this: ')).toBe('');
    expect(captureText('Plain note')).toBe('Plain note');
    expect(captureName(FRI)).toBe('capture-2026-11-27-1542-home.md');
  });
});
