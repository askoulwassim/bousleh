import {
  type Act,
  actCall,
  type Before,
  CONFIRM_MS,
  failure,
  minDay,
  resultLabel,
  type ToolCall,
  UNDO_MS,
  undoCall,
  validDay,
} from './acts.js';
import { app } from './app.js';
import { SERVER } from './ask.js';
import { localDay } from './format.js';
import { unwrapBousleh } from './sources.js';

/*
 * The ops Home runs itself, each on one press, live only: Done, Date, Snooze and Close on a commitment
 * (with Undo), and Save and Skip on a Horizon finding.
 */

/** Reads to refresh once a write has settled. */
const AFTER_WRITE = ['pulse_today', 'context_strata', 'commitments_list'];

function invalidate(tools: string[]): void {
  const mcp = app.caps.mcp;
  if (!mcp) return;
  for (const tool of tools) void mcp.invalidate(SERVER, tool).catch(() => {});
}

async function call(c: ToolCall): Promise<void> {
  const mcp = app.caps.mcp;
  if (!mcp) throw { code: 'server_not_connected' };
  const out = unwrapBousleh(await mcp.callTool(SERVER, c.tool, c.input));
  if (!out.ok) throw { code: out.code, message: out.message };
}

/** What the commitment held before acting, from the live list, so Undo can put it back. */
function beforeOf(id: string): Before {
  const c = app.sources.commitments?.commitments.find((x) => x.id === id);
  return { due: c?.due ?? null, surface_on: c?.surface_on ?? null };
}

let confirmTimer = 0;

/** A press on an action row: data-act on a button, with data-id and maybe data-day. */
export function onAct(act: string, id: string, surface: 'first' | 'ask', day?: string): void {
  const ui = app.ui;
  if (!app.caps.mcp || ui.mode !== 'live') return;
  switch (act) {
    case 'undo':
      void undo(id);
      return;
    case 'retry': {
      const a = ui.acted[id];
      if (a?.state === 'error') void run(a.act, id, a.day);
      return;
    }
    case 'pick':
      if (ui.picker?.id === id && day) void run(ui.picker.act, id, day);
      return;
    case 'set': {
      const p = ui.picker;
      if (!p || p.id !== id) return;
      const valid = validDay(p.value, minDay(p.act, new Date()));
      if (valid) void run(p.act, id, valid);
      else app.toast(p.act === 'date' ? 'Pick today or a later day.' : 'Pick tomorrow or a later day.');
      return;
    }
  }
  if (ui.acted[id]) return;
  if (act === 'date' || act === 'snooze') {
    ui.confirm = null;
    ui.picker = ui.picker?.id === id && ui.picker.act === act && ui.picker.surface === surface ? null : { id, act, surface, value: '' };
    app.schedule();
    return;
  }
  if (act !== 'done' && act !== 'close') return;
  const key = `${id}:${act}`;
  if (ui.confirm !== key) {
    ui.confirm = key;
    ui.picker = null;
    clearTimeout(confirmTimer);
    confirmTimer = window.setTimeout(() => {
      if (app.ui.confirm === key) {
        app.ui.confirm = null;
        app.schedule();
      }
    }, CONFIRM_MS);
    app.schedule();
    return;
  }
  ui.confirm = null;
  void run(act, id);
}

/** Escape: drop a pending second press or an open picker. True when it did something. */
export function cancelPending(): boolean {
  if (app.ui.confirm || app.ui.picker) {
    app.ui.confirm = null;
    app.ui.picker = null;
    app.schedule();
    return true;
  }
  return false;
}

async function run(act: Act, id: string, day?: string): Promise<void> {
  const ui = app.ui;
  const before = beforeOf(id);
  const c = actCall(act, id, day);
  const item = app.view.focus?.items.find((f) => f.id === id);
  if (item) ui.kept[id] = item;
  ui.picker = null;
  ui.acted[id] = { act, state: 'busy', label: '', undo: null, undoUntil: 0, retry: null, ...(day ? { day } : {}) };
  app.schedule();
  try {
    await call(c);
    ui.acted[id] = {
      act,
      state: 'done',
      label: resultLabel(act, day, localDay(new Date())),
      undo: undoCall(act, id, before),
      undoUntil: Date.now() + UNDO_MS,
      retry: null,
      ...(day ? { day } : {}),
    };
    window.setTimeout(() => settle(id), UNDO_MS);
  } catch (err) {
    ui.acted[id] = { act, state: 'error', label: failure(err), undo: null, undoUntil: 0, retry: c, ...(day ? { day } : {}) };
  }
  app.schedule();
}

/** The Undo window closed: refresh the reads, and the next one takes the card out of First. */
function settle(id: string): void {
  const a = app.ui.acted[id];
  if (a?.state !== 'done') return;
  a.undo = null;
  invalidate(AFTER_WRITE);
  app.schedule();
}

/** A fresh Pulse read: forget the acts whose Undo window has closed. */
export function forgetSettled(): void {
  for (const [id, a] of Object.entries(app.ui.acted)) {
    if (a.state === 'done' && a.undo === null) {
      delete app.ui.acted[id];
      delete app.ui.kept[id];
    }
  }
}

async function undo(id: string): Promise<void> {
  const a = app.ui.acted[id];
  if (a?.state !== 'done' || !a.undo) return;
  const reverse = a.undo;
  app.ui.acted[id] = { ...a, state: 'busy', label: 'Undoing…' };
  app.schedule();
  try {
    await call(reverse);
    delete app.ui.acted[id];
    delete app.ui.kept[id];
    app.toast('Undone. It’s back where it was.');
    invalidate(AFTER_WRITE);
  } catch (err) {
    app.ui.acted[id] = { ...a, undo: null };
    app.toast(`Couldn't undo: ${failure(err)}`);
  }
  app.schedule();
}

/** Save or Skip on a Horizon finding: vault_supersede to to_read or dismissed. */
export async function supersedeFinding(id: string, op: 'save' | 'skip'): Promise<void> {
  const ui = app.ui;
  if (!app.caps.mcp || ui.mode !== 'live') return;
  ui.done[id] = 'busy';
  app.schedule();
  try {
    await call({ tool: 'vault_supersede', input: { id, status: op === 'save' ? 'to_read' : 'dismissed' } });
    ui.done[id] = op === 'save' ? 'saved' : 'skipped';
    app.toast(op === 'save' ? 'Saved to the reading list' : 'Skipped');
    invalidate(['watch_digest', 'context_strata']);
  } catch (err) {
    delete ui.done[id];
    app.toast(failure(err));
  }
  app.schedule();
}
