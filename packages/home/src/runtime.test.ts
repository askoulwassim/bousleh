import { describe, expect, it } from 'vitest';
import { esc } from './escape.js';
import { buildViewModel } from './model.js';
import { renderPage, type UiState } from './render.js';
import { hashView, readSnapshot, SNAPSHOT_MAX_BYTES, shouldWrite, snapshotDoc } from './snapshot.js';
import { calendarArgs, normalizeCalendar, unwrapBousleh } from './sources.js';
import { tokensCss } from './tokens.js';

/* Reading connector results, the snapshot document, tokens, and safe rendering. */

const NOW = new Date(2026, 9, 25, 9, 30);
const ui = (over: Partial<UiState> = {}): UiState => ({
  mode: 'live',
  stamp: '09:30',
  filter: 'all',
  docsOpen: false,
  errors: {},
  approval: false,
  done: {},
  acted: {},
  confirm: null,
  install: false,
  ...over,
});

describe('unwrapBousleh', () => {
  it('reads structuredContent ok and error, the payload, and the text block', () => {
    expect(unwrapBousleh({ content: [], structuredContent: { status: 'ok', output: { a: 1 } } })).toEqual({ ok: true, output: { a: 1 } });
    expect(unwrapBousleh({ content: [], payload: { status: 'ok', output: [] } })).toEqual({ ok: true, output: [] });
    expect(unwrapBousleh({ content: [], structuredContent: { status: 'error', code: 'not_found', message: 'nope' } })).toEqual({
      ok: false,
      code: 'not_found',
      message: 'nope',
    });
    expect(unwrapBousleh({ content: [{ type: 'text', text: '{"b":2}' }] })).toEqual({ ok: true, output: { b: 2 } });
    expect(unwrapBousleh({ content: [{ type: 'text', text: 'invalid_input: bad date' }] })).toEqual({
      ok: false,
      code: 'invalid_input',
      message: 'bad date',
    });
    expect(unwrapBousleh(null).ok).toBe(false);
  });
});

describe('calendar', () => {
  it('normalizes events from any envelope, leaving out declined and cancelled ones', () => {
    const events = normalizeCalendar({
      events: [
        { summary: 'Sync', start: { dateTime: '2026-10-25T10:00:00+01:00' } },
        { summary: 'Offsite', start: { date: '2026-10-25' } },
        {
          summary: 'Declined',
          start: { dateTime: '2026-10-25T11:00:00Z' },
          attendees: [{ email: 'me@example.com', self: true, responseStatus: 'declined' }],
        },
        { summary: 'Gone', status: 'cancelled', start: { dateTime: '2026-10-25T12:00:00Z' } },
        { start: { dateTime: '2026-10-25T13:00:00Z' } },
      ],
    });
    expect(events).toEqual([
      { title: 'Sync', start: '2026-10-25T10:00:00+01:00', allDay: false },
      { title: 'Offsite', start: '2026-10-25', allDay: true },
    ]);
    expect(normalizeCalendar([{ title: 'Bare', startTime: '2026-10-25T09:00:00' }])).toHaveLength(1);
    expect(normalizeCalendar('nonsense')).toEqual([]);
  });

  it('asks for one local day, with no offset', () => {
    expect(calendarArgs(NOW)).toEqual({
      startTime: '2026-10-25T00:00:00',
      endTime: '2026-10-26T00:00:00',
      pageSize: 50,
      orderBy: 'startTime',
    });
  });
});

describe('snapshot', () => {
  const view = buildViewModel({}, NOW);

  it('writes only when the view changed, and reads back only what has the right shape', () => {
    const doc = snapshotDoc(view, NOW);
    expect(doc).not.toBeNull();
    expect(doc?.hash).toBe(hashView(view));
    expect(shouldWrite(view, null)).toBe(true);
    expect(shouldWrite(view, doc)).toBe(false);
    expect(shouldWrite({ ...view, date: '2026-10-26' }, doc)).toBe(true);
    expect(readSnapshot(JSON.parse(JSON.stringify(doc)))?.view).toEqual(view);
    expect(readSnapshot({ v: 1, taken_at: 'yesterday', view })).toBeNull();
    expect(readSnapshot({ v: 1, taken_at: NOW.toISOString(), view: { ...view, cells: 'x' } })).toBeNull();
    expect(readSnapshot(null)).toBeNull();
  });

  it('refuses a document too big for the db', () => {
    const big = {
      ...view,
      docs: Array.from({ length: 4000 }, (_, i) => ({ title: `Doc ${i} ${'x'.repeat(60)}`, url: 'https://example.com', type: 'doc' })),
    };
    expect(JSON.stringify(big).length).toBeGreaterThan(SNAPSHOT_MAX_BYTES);
    expect(snapshotDoc(big, NOW)).toBeNull();
  });
});

describe('tokens', () => {
  it('declares the same values on :root and both dark-mode hooks', () => {
    const css = tokensCss();
    expect(css.match(/--bsl-bg:#0B0809;/g)).toHaveLength(3);
    expect(css).toContain('@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){');
    expect(css).toContain(':root[data-theme="dark"]{');
    expect(css).toContain('--bsl-accent:#C93A63;');
  });
});

describe('rendering', () => {
  it('escapes data and keeps only http(s) links', () => {
    expect(esc('<img src=x onerror=alert(1)> & "q"')).toBe('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot;');
    const vm = buildViewModel({}, NOW);
    vm.docs = [{ title: '<script>alert(1)</script>', url: 'javascript:alert(1)', type: 'doc' }];
    vm.horizon.lead = {
      id: 'fnd_01JBX000000000000000000001',
      title: '<b>bold</b>',
      url: 'https://example.com/a',
      scope: null,
      scopeName: '',
      altitude: null,
      source: 'example.com',
      age: '1d',
      summary: '"quoted"',
      status: 'new',
      shapePrompt: 'p1',
    };
    const html = renderPage(vm, ui({ docsOpen: true }));
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>bold</b>');
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(html).not.toContain('javascript:');
  });

  it('draws the focus strip above the grid, says so when it is empty, and nothing without Pulse', () => {
    const vm = buildViewModel({}, NOW);
    expect(renderPage(vm, ui())).not.toContain('class="focus"');
    vm.focus = { items: [], more: 0, snoozed: null, morePrompt: 'p2' };
    const empty = renderPage(vm, ui());
    expect(empty).toContain('class="focus"');
    expect(empty).toContain('Nothing pressing today.');
    vm.focus = {
      items: [
        {
          kind: 'commitment',
          eyebrow: '2 days late',
          title: '<i>Send the one-pager</i>',
          detail: 'owed to Peter, your manager',
          scopeName: 'Lantern',
          altitude: 1000,
          tone: 'needs',
          prompt: 'p1',
          label: 'Send the one-pager',
        },
      ],
      more: 2,
      snoozed: '3 snoozed · next Nov 20',
      morePrompt: 'p2',
    };
    const html = renderPage(vm, ui());
    expect(html).toContain('class="focus"');
    expect(html).toContain('&lt;i&gt;Send the one-pager&lt;/i&gt;');
    expect(html).toContain('3 snoozed · next Nov 20');
    expect(html).toContain('+2 more');
    expect(html.indexOf('class="focus"')).toBeLessThan(html.indexOf('aria-label="Strata"'));
  });

  it('shows Save and Skip only when live, and the stamp for each mode', () => {
    const vm = buildViewModel({}, NOW);
    vm.horizon.lead = {
      id: 'fnd_01JBX000000000000000000002',
      title: 'A finding',
      url: 'https://example.com/b',
      scope: null,
      scopeName: '',
      altitude: null,
      source: 'example.com',
      age: '1d',
      summary: '',
      status: 'new',
      shapePrompt: 'p1',
    };
    expect(renderPage(vm, ui())).toContain('data-op="save"');
    const snap = renderPage(vm, ui({ mode: 'snapshot', stamp: '20:43' }));
    expect(snap).not.toContain('data-op="save"');
    expect(snap).toContain('Snapshot 20:43');
    expect(renderPage(vm, ui({ mode: 'empty', stamp: '' }))).toContain('No data yet');
  });
});
