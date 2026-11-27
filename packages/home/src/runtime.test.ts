import { describe, expect, it } from 'vitest';
import type { AskBlock } from './ask.js';
import { esc } from './escape.js';
import { reachOf } from './launch.js';
import { buildViewModel } from './model.js';
import { askHtml, firstLaunchHtml, healthRows, logHtml } from './panels.js';
import { actRow, initialUi, renderPage, routeAttrs, type UiState, whereOf, whereTag } from './render.js';
import { hashView, readSnapshot, SNAPSHOT_MAX_BYTES, shouldWrite, snapshotDoc } from './snapshot.js';
import { calendarArgs, normalizeCalendar, unwrapBousleh } from './sources.js';
import { tokensCss } from './tokens.js';
import type { FocusItemVM } from './types.js';

/* Reading connector results, the snapshot document, tokens, and safe rendering. */

const NOW = new Date(2026, 9, 25, 9, 30);
const ui = (over: Partial<UiState> = {}): UiState => ({ ...initialUi(), mode: 'live', stamp: '09:30', ...over });

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
          detail: 'owed to Rowan, your manager',
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

const CMT = 'cmt_01JBX000000000000000000F01';
const OPEN = reachOf({ installed: true, fullAccess: 'granted', platform: 'darwin', repo: '/opt/b', sample: true, live: true });

describe('where each button goes, and its tag', () => {
  it('tags launchers Here, In Claude, On this Mac or Copy', () => {
    expect(whereTag('here')).toBe('<span class="where here">Here</span>');
    expect(whereTag('claude')).toContain('<span class="where claude">In Claude<svg');
    expect(whereTag('mac')).toBe('<span class="where mac">On this Mac</span>');
    expect(whereTag('copy')).toBe('<span class="where copy">Copy</span>');
  });

  it('answers here when Ask can, opens Claude with full access, and copies otherwise', () => {
    const live = ui({ reach: OPEN });
    expect(whereOf({ ask: 'p2' }, live)).toBe('here');
    expect(whereOf({ capture: true }, live)).toBe('here');
    expect(whereOf({}, live)).toBe('claude');
    // The fallback: not installed, no full access, the phone, the web.
    const plain = ui();
    expect(whereOf({ ask: 'p2' }, plain)).toBe('copy');
    expect(whereOf({}, plain)).toBe('copy');
    expect(whereOf({ capture: true }, plain)).toBe('here');
    expect(routeAttrs({ prompt: 'p1', ask: 'p2' })).toBe('data-prompt="p1" data-ask="p2"');
    expect(routeAttrs({ prompt: 'p1', capture: true })).toBe('data-action="capture"');
  });

  it('draws every launcher with a tag, Copy until Home can open Claude', () => {
    const vm = buildViewModel({}, NOW);
    vm.primary = { label: 'Answer 3', prompt: 'p1' };
    expect(renderPage(vm, ui())).toContain('data-prompt="p1">Answer 3<span class="where copy">Copy</span>');
    expect(renderPage(vm, ui({ reach: OPEN }))).toContain('Answer 3<span class="where claude">In Claude');
    vm.primary = { label: 'Where am I?', prompt: 'p1', ask: 'p2' };
    expect(renderPage(vm, ui({ reach: OPEN }))).toContain('data-prompt="p1" data-ask="p2">Where am I?<span class="where here">Here</span>');
  });

  it('shows the footer Install as app only where the desktop app offers it', () => {
    const vm = buildViewModel({}, NOW);
    expect(renderPage(vm, ui())).not.toContain('data-action="install"');
    expect(renderPage(vm, ui({ install: true }))).toContain(
      '<button class="btn sm" type="button" data-action="install">Install as app</button>',
    );
    expect(renderPage(vm, ui({ app: { fullAccess: true, needsSetup: false }, version: '0.2.0' }))).toContain(
      'Installed app · full access on · Home v0.2.0',
    );
  });
});

describe('the action row on a commitment', () => {
  const at = new Date(2026, 10, 27, 15, 42);
  const row = (over: Partial<UiState>) => actRow(CMT, 'Send <b>it</b>', ui(over), 'first', at);

  it('offers Done, Date, Snooze and Close, live only', () => {
    const idle = row({});
    for (const act of ['done', 'date', 'snooze', 'close']) expect(idle).toContain(`data-act="${act}" data-id="${CMT}"`);
    expect(idle).toContain('aria-label="Done: Send &lt;b&gt;it&lt;/b&gt;"');
    expect(row({ mode: 'snapshot' })).toBe('');
  });

  it('asks for a second press on Done and Close', () => {
    const asking = row({ confirm: `${CMT}:close` });
    expect(asking).toContain('class="fa ask"');
    expect(asking).toContain('>Close it?<');
    expect(asking).toContain('Press again to confirm');
    expect(asking).toContain('class="fa dim"');
    expect(row({ confirm: `${CMT}:done` })).toContain('>Mark done?<');
  });

  it('opens the day picker under the row, with the days and any day', () => {
    const html = row({ picker: { id: CMT, act: 'date', surface: 'first', value: '2026-11-30' } });
    expect(html).toContain('Due on');
    expect(html).toContain('data-day="2026-11-27">Today<');
    expect(html).toContain('class="chip on" type="button" data-act="pick" data-id="' + CMT + '" data-day="2026-11-30">Mon 30 Nov<');
    expect(html).toContain('min="2026-11-27" value="2026-11-30"');
    expect(row({ picker: { id: CMT, act: 'snooze', surface: 'first', value: '' } })).toContain('min="2026-11-28"');
    // A picker opened in Ask is not drawn in First.
    expect(row({ picker: { id: CMT, act: 'date', surface: 'ask', value: '' } })).not.toContain('Due on');
  });

  it('says what happened, with Undo while its window is open; a failure has Retry', () => {
    const done = {
      act: 'snooze' as const,
      state: 'done' as const,
      label: 'Snoozed till Mon 30 Nov',
      undo: { tool: 't', input: {} },
      undoUntil: at.getTime() + 1000,
      retry: null,
    };
    expect(row({ acted: { [CMT]: done } })).toContain('Snoozed till Mon 30 Nov');
    expect(row({ acted: { [CMT]: done } })).toContain('data-act="undo"');
    expect(row({ acted: { [CMT]: { ...done, undoUntil: at.getTime() - 1 } } })).not.toContain('data-act="undo"');
    expect(row({ acted: { [CMT]: { ...done, state: 'busy', label: '' } } })).toContain('Snoozing…');
    const failed = row({ acted: { [CMT]: { ...done, state: 'error', label: "Couldn't reach Bousleh", undo: null } } });
    expect(failed).toContain('Couldn&#39;t reach Bousleh');
    expect(failed).toContain('data-act="retry"');
  });

  it('keeps a card acted on in First after a read drops it, until its Undo closes', () => {
    const vm = buildViewModel({}, NOW);
    vm.focus = { items: [], more: 0, snoozed: null, morePrompt: 'p1' };
    const kept: FocusItemVM = {
      kind: 'commitment',
      id: CMT,
      eyebrow: 'late',
      title: 'Kept',
      detail: '',
      scopeName: 'Harbor',
      altitude: 1000,
      tone: 'needs',
      prompt: 'p1',
      label: 'Kept',
    };
    const acted = { act: 'done' as const, state: 'done' as const, label: 'Marked done', undo: null, undoUntil: 0, retry: null };
    expect(renderPage(vm, ui({ kept: { [CMT]: kept }, acted: { [CMT]: acted } }))).toContain('Marked done');
    expect(renderPage(vm, ui({ kept: { [CMT]: kept } }))).not.toContain('Kept');
  });
});

describe('the Ask answer', () => {
  const look = { commitments: new Map([[CMT, { title: 'Live <title>' }]]), findings: new Map(), tts: true, speaking: false };
  const blocks: AskBlock[] = [
    { type: 'p', text: '<img src=x onerror=alert(1)> first', quiet: false },
    { type: 'li', text: 'a & b' },
    { type: 'commitment', id: CMT, title: 'Model title', why: 'Late "since" yesterday' },
    { type: 'commitment', id: 'cmt_01JBX000000000000000000F09', title: 'Unknown one', why: '' },
    { type: 'handoff', mode: 'Communicate', prompt: 'Communicate: draft it <now>' },
  ];

  it('escapes everything Claude wrote, and acts only on commitments Home read itself', () => {
    const html = askHtml({ q: '<script>x</script>', status: 'done', reading: '', tools: ['pulse_today'], blocks, error: '' }, ui(), look);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; first');
    expect(html).toContain('a &amp; b');
    expect(html).toContain('Live &lt;title&gt;');
    expect(html).toContain(`data-act="done" data-id="${CMT}" data-surface="ask"`);
    expect(html).not.toContain('data-id="cmt_01JBX000000000000000000F09"');
    expect(html).toContain('Communicate: draft it &lt;now&gt;');
    expect(html).toContain('Read pulse_today · changed nothing');
    expect(html).toContain('Read it to me');
    expect(html).toContain('Copy for Claude');
    expect(askHtml({ q: 'q', status: 'done', reading: '', tools: [], blocks, error: '' }, ui({ reach: OPEN }), look)).toContain(
      'Open in Claude',
    );
    expect(askHtml({ q: 'q', status: 'done', reading: '', tools: [], blocks, error: '' }, ui(), { ...look, tts: false })).not.toContain(
      'Read it to me',
    );
  });

  it('shows what it is reading, with Stop, and a failure in words', () => {
    expect(askHtml({ q: 'q', status: 'reading', reading: 'context_brief', tools: [], blocks: [], error: '' }, ui(), look)).toContain(
      'Reading context_brief…',
    );
    expect(askHtml({ q: 'q', status: 'reading', reading: '', tools: [], blocks: [], error: '' }, ui(), look)).toContain(
      'data-action="ask-stop"',
    );
    expect(askHtml({ q: 'q', status: 'error', reading: '', tools: [], blocks: [], error: 'Too <many>' }, ui(), look)).toContain(
      'Too &lt;many&gt;',
    );
    expect(askHtml(null, ui(), look)).toBe('');
  });
});

describe('Health, the run log and first launch', () => {
  it('reads vault_health into rows, and says when the repo is unknown', () => {
    const rows = healthRows(
      {
        version: '0.2.0',
        home: '~/.bousleh',
        ops: 41,
        data: { exists: true, db: true },
        backups: { count: 14, latest: '2026-11-27-0600' },
      },
      '/opt/b',
    );
    expect(rows.map((r) => r.ok)).toEqual([true, true, true, true]);
    expect(rows[0]?.detail).toBe('v0.2.0 · 41 ops answered');
    const none = healthRows(null, null);
    expect(none.map((r) => r.ok)).toEqual([false, false, false, false]);
    expect(none[3]?.detail).toBe('Not known: run scripts/setup-mac.sh once');
  });

  it('escapes what a run prints', () => {
    expect(logHtml([{ t: '15:40:02', text: '<b>x</b>', tone: 'ok' }], true)).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('lists each permission with Allow, Allowed or why not, and Open Home', () => {
    const html = firstLaunchHtml({ 'full-access': 'prompt', 'menu-bar': 'granted', shortcuts: 'denied' });
    expect(html).toContain('Let Bousleh work on this Mac');
    expect(html).toContain('data-action="perm" data-perm="full-access">Allow<');
    expect(html).toContain('Allowed');
    expect(html).toContain('Turned off · Change');
    expect(html).toContain('Never sends a message for you.');
    expect(html).toContain('data-action="first-continue">Open Home<');
  });
});
