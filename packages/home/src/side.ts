import { app, refreshReach } from './app.js';
import { ASK_TOOL_NAMES, ASK_TOOLS, type AskBlock, askFailure, askInput, parseAnswer, SERVER, suggestions } from './ask.js';
import ASK_PROMPT from './ask-prompt.md';
import { copyPrompt, copyText, openClaude } from './claude.js';
import { esc } from './escape.js';
import { clock, localDay } from './format.js';
import { icons, logoSmall } from './icons.js';
import { PUBLISH_HOME, runBlocker } from './launch.js';
import {
  type AskLookups,
  type AskState,
  askHtml,
  blockedHtml,
  type HealthRow,
  healthRows,
  healthRowsHtml,
  type LogLine,
  logHtml,
  type RunState,
  runStatus,
} from './panels.js';
import type { ChildProcess, SampleError, SampleTool } from './platform.js';
import { prompts } from './prompts.js';
import { whereTag } from './render.js';
import { COMMANDS, elapsed, privacyHint, type RunKind, runSpec, SETUP_COMMAND, scriptLine, splitLines, tuneLines } from './runs.js';
import { unwrapBousleh } from './sources.js';

/*
 * The rail's side panel (440 px, beside Home): Ask, Tune now and Health. Ask answers read-only
 * questions here with the sample capability and the bousleh read tools. Tune and Health run fixed
 * commands on this Mac and stream their lines. The panel's skeleton is built once, so the Ask box
 * keeps what is typed; only the answer and the logs are redrawn.
 */

const side = () => document.getElementById('side') as HTMLElement;
const part = <T extends HTMLElement>(selector: string) => side().querySelector(selector) as T;

// ---------------------------------------------------------------- skeleton

export function initSide(): void {
  side().innerHTML = `<section class="sp sp-ask" aria-label="Ask" hidden>
<div class="sp-h"><span class="disp sp-t">Ask</span><span class="where here">Here</span><span class="sp-fill"></span><button class="ic sm" type="button" data-action="side-close" aria-label="Close the panel">${icons.close}</button></div>
<form class="askbar" data-form="ask">${logoSmall(22)}<input class="ask-in" type="text" name="q" autocomplete="off" aria-label="Ask Bousleh" placeholder="Ask about anything you've filed. Answers here, changes nothing."><button class="ic sm ask-mic" type="button" data-action="ask-mic" aria-label="Dictate" hidden>${icons.mic(18)}</button><button class="btn sm" type="submit">Ask</button></form>
<span class="mono ask-note" hidden></span>
<div class="chips ask-sugg"></div>
<div class="ask-out" aria-live="polite"></div>
</section>
<section class="sp sp-tune" aria-label="Tune now" hidden>
<div class="sp-h"><span class="disp sp-t">Tune now</span><span class="where mac">On this Mac</span><span class="sp-fill"></span><span class="mono run-status"></span><button class="ic sm" type="button" data-action="side-close" aria-label="Close the panel">${icons.close}</button></div>
<div class="run-blocked"></div>
<div class="log mono tune-log" role="log" aria-live="polite"></div>
<p class="sp-note">Runs Claude Code on this Mac with the Bousleh plugin: the Tune skill, headless. Safe fixes only; judgment calls go to your queue; changes to Bousleh come as a pull request it never merges.</p>
<div class="sp-acts tune-acts"></div>
</section>
<section class="sp sp-health" aria-label="Health" hidden>
<div class="sp-h"><span class="disp sp-t">Health</span><span class="where mac">On this Mac</span><span class="sp-fill"></span><span class="mono hl-at"></span><button class="ic sm" type="button" data-action="side-close" aria-label="Close the panel">${icons.close}</button></div>
<div class="hl-rows"></div>
<div class="run-blocked hl-blocked"></div>
<div class="sp-acts hl-acts"></div>
<div class="log mono hl-log" role="log" aria-live="polite" hidden></div>
</section>`;
  side().addEventListener('submit', (event) => {
    event.preventDefault();
    void ask(part<HTMLInputElement>('.ask-in').value);
  });
}

// ---------------------------------------------------------------- opening and closing

export function openSide(which: 'ask' | 'tune' | 'health'): void {
  app.ui.side = which;
  if (which === 'health') void openHealth();
  app.schedule();
  if (which === 'ask') requestAnimationFrame(() => part<HTMLInputElement>('.ask-in')?.focus());
}

export function closeSide(): boolean {
  if (app.ui.side === null) return false;
  app.ui.side = null;
  app.schedule();
  return true;
}

export function toggleSide(which: 'ask' | 'tune' | 'health'): void {
  if (app.ui.side === which) closeSide();
  else openSide(which);
}

// ---------------------------------------------------------------- Ask

let current: AskState | null = null;
let controller: AbortController | null = null;
let speaking = false;
let dictating = false;

function lookups(): AskLookups {
  const commitments = new Map<string, { title: string }>();
  for (const c of app.sources.commitments?.commitments ?? []) commitments.set(c.id, { title: c.title });
  const findings = new Map<string, { title: string; status: string; url: string }>();
  for (const g of app.sources.digest?.groups ?? [])
    for (const f of g.findings) findings.set(f.id, { title: f.title, status: f.status, url: f.url });
  return { commitments, findings, tts: app.caps.tts !== null, speaking };
}

/** A tool's output for Claude: JSON, cut to stay inside what a page tool may return. */
function forClaude(output: unknown): string {
  const text = JSON.stringify(output) ?? 'null';
  return text.length > 30_000 ? `${text.slice(0, 30_000)}… (cut: ask for less, with a scope or a limit)` : text;
}

/** The read tools as page functions: each calls the bousleh server. Never a write tool. */
function readTools(state: AskState): SampleTool[] {
  return ASK_TOOLS.filter((t) => ASK_TOOL_NAMES.has(t.name)).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    execute: async (input: Record<string, unknown>, context: { signal: AbortSignal }) => {
      const mcp = app.caps.mcp;
      if (!mcp) throw new Error('the bousleh server is not connected');
      if (current === state) {
        state.reading = t.name;
        if (!state.tools.includes(t.name)) state.tools.push(t.name);
        app.schedule();
      }
      const result = await mcp.callTool(SERVER, t.name, input ?? {});
      if (context.signal.aborted) throw new Error('stopped');
      const out = unwrapBousleh(result);
      if (!out.ok) throw new Error(`${out.code}: ${out.message}`);
      return forClaude(out.output);
    },
  }));
}

/** Ask a question: answered here when this view can, else copied for a chat. */
export async function ask(question: string): Promise<void> {
  const q = question.trim();
  if (!q) return;
  if (app.ui.side !== 'ask') openSide('ask');
  const sample = app.caps.sample;
  if (!app.ui.reach.ask || !sample) {
    await copyPrompt(q, app.askOff ? 'answers here are off' : 'answers here need the desktop app with Bousleh live');
    return;
  }
  controller?.abort();
  stopSpeaking();
  const ctl = new AbortController();
  controller = ctl;
  const state: AskState = { q, status: 'reading', reading: '', tools: [], blocks: [], error: '' };
  current = state;
  part<HTMLInputElement>('.ask-in').value = '';
  app.schedule();
  const ctx = { today: localDay(new Date()), scopes: (app.sources.strata?.columns ?? []).map((c) => ({ slug: c.slug, name: c.name })) };
  try {
    const value = await sample.json(askInput(ASK_PROMPT, q, ctx), { tools: readTools(state), signal: ctl.signal });
    if (current !== state) return;
    state.blocks = parseAnswer(value);
    if (state.blocks.length === 0) {
      state.status = 'error';
      state.error = askFailure('empty_completion').text;
    } else state.status = 'done';
  } catch (err) {
    if (current !== state) return;
    const code = (err as SampleError | null)?.code ?? 'upstream_error';
    if (code === 'cancelled') state.status = 'stopped';
    else {
      const f = askFailure(code);
      state.status = 'error';
      state.error = f.text;
      if (f.off) {
        app.askOff = true;
        refreshReach();
      }
    }
  } finally {
    if (controller === ctl) controller = null;
  }
  app.schedule();
}

export function stopAsk(): void {
  controller?.abort();
}

function handoff(i: number): AskBlock | undefined {
  const b = current?.blocks[i];
  return b?.type === 'handoff' ? b : undefined;
}

export function onAskAction(action: string, target: HTMLElement): void {
  switch (action) {
    case 'ask-stop':
      stopAsk();
      return;
    case 'ask-open': {
      const b = handoff(Number(target.dataset.i));
      if (b?.type === 'handoff') void openClaude(b.prompt);
      return;
    }
    case 'ask-copy': {
      const b = handoff(Number(target.dataset.i));
      if (b?.type === 'handoff') void copyText(b.prompt).then((ok) => app.toast(ok ? 'Copied.' : 'The clipboard was not available.'));
      return;
    }
    case 'ask-continue':
      if (current) void openClaude(current.q);
      return;
    case 'ask-speak':
      void speak();
      return;
    case 'ask-mic':
      dictate();
      return;
    case 'ask-sugg': {
      const i = Number(target.dataset.i);
      const s = suggestionList()[i];
      if (!s) return;
      if (s.claude) void openClaude(prompts.captureQueue(queued()));
      else void ask(s.question);
      return;
    }
  }
}

function queued(): number {
  return app.sources.pulse?.inbox.queued ?? app.sources.queue?.items.length ?? 0;
}

function suggestionList() {
  return suggestions(app.sources.strata?.columns[0]?.name ?? null, queued());
}

/** What the answer says, as plain text to read aloud: paragraphs, bullets and item titles. */
function spoken(): string {
  const parts: string[] = [];
  for (const b of current?.blocks ?? []) {
    if (b.type === 'p' || b.type === 'li') parts.push(b.text);
    else if (b.type === 'commitment' || b.type === 'finding') parts.push(b.title);
  }
  return parts.join('\n').slice(0, 2000);
}

async function speak(): Promise<void> {
  const tts = app.caps.tts;
  if (!tts) return;
  if (speaking) {
    stopSpeaking();
    return;
  }
  const text = spoken();
  if (!text) return;
  speaking = true;
  app.schedule();
  try {
    await tts.speak(text);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'not_granted') app.caps.tts = null;
    else if (code !== 'stopped') app.toast("Couldn't read it aloud just now.");
  }
  speaking = false;
  app.schedule();
}

function stopSpeaking(): void {
  if (!speaking) return;
  speaking = false;
  void app.caps.tts?.stop().catch(() => {});
}

/** Dictation into the Ask box, where the window offers it. Starts from the click itself. */
function dictate(): void {
  const d = app.caps.dictation;
  if (!d) return;
  if (dictating) {
    void d.stop().catch(() => {});
    return;
  }
  app.dictTarget = 'ask';
  d.start().catch((err: { code?: string }) => {
    if (err?.code === 'not_granted' || err?.code === 'unavailable') app.caps.dictation = null;
    app.schedule();
  });
}

/** Dictated words for the Ask box (main.ts routes dictation to Ask or Capture). */
export function onAskDictation(kind: 'final' | 'state', text: string, state?: string): void {
  if (kind === 'final') {
    const input = part<HTMLInputElement>('.ask-in');
    input.value = `${input.value}${input.value ? text : text.trimStart()}`;
    return;
  }
  dictating = state !== 'idle';
  part<HTMLElement>('.ask-mic')?.classList.toggle('on', dictating);
}

// ---------------------------------------------------------------- runs on this Mac

const runs: Partial<Record<RunKind, RunState & { proc: ChildProcess | null; stopping: boolean }>> = {};
let ticker = 0;
const MAX_LINES = 600;

const stamp = () => {
  const d = new Date();
  return `${clock(d)}:${String(d.getSeconds()).padStart(2, '0')}`;
};

function push(r: RunState, raw: string, tune: boolean): void {
  const lines = tune ? tuneLines(raw) : [scriptLine(raw)].filter((l) => l !== null);
  for (const l of lines) r.lines.push({ t: stamp(), text: l.text, tone: l.tone } satisfies LogLine);
  if (r.lines.length > MAX_LINES) r.lines.splice(0, r.lines.length - MAX_LINES);
}

/** Start one of the fixed runs. Refused, with the reason, where runs on this Mac aren't offered. */
export function startRun(kind: RunKind): void {
  const desktop = app.caps.desktop;
  const repo = app.facts.repo;
  if (!app.ui.reach.run || !desktop?.childProcess || !repo) {
    app.toast(runBlocker(app.facts) ?? 'Runs on this Mac are not offered here.');
    return;
  }
  if (runs[kind]?.status === 'running') return;
  const spec = runSpec(kind, repo);
  const r: RunState & { proc: ChildProcess | null; stopping: boolean } = {
    kind,
    status: 'running',
    lines: [{ t: stamp(), text: `$ ${COMMANDS[kind]}`, tone: 'muted' }],
    started: Date.now(),
    ended: 0,
    code: null,
    proc: null,
    stopping: false,
  };
  runs[kind] = r;
  const tune = kind === 'tune';
  let out = '';
  let err = '';
  const end = (status: RunState['status'], code: number | null) => {
    if (r.status !== 'running') return;
    if (out.trim()) push(r, out, tune);
    if (err.trim()) push(r, err, false);
    const hint = status === 'failed' && !r.stopping ? privacyHint(r.lines, repo) : null;
    if (hint) r.lines.push({ t: stamp(), text: hint.text, tone: hint.tone });
    r.status = r.stopping ? 'stopped' : status;
    r.code = code;
    r.ended = Date.now();
    r.proc = null;
    if (kind !== 'tune') void readHealth();
    app.schedule();
  };
  try {
    const proc = desktop.childProcess.spawn(spec.command, spec.args, { cwd: spec.cwd });
    r.proc = proc;
    proc.stdout.on('data', (chunk) => {
      const s = splitLines(out, chunk);
      out = s.rest;
      for (const line of s.lines) push(r, line, tune);
      app.schedule();
    });
    proc.stderr.on('data', (chunk) => {
      const s = splitLines(err, chunk);
      err = s.rest;
      for (const line of s.lines) push(r, line, false);
      app.schedule();
    });
    proc.on('exit', (code: number | null) => end(code === 0 ? 'done' : 'failed', code));
    proc.on('error', (e: Error) => {
      r.lines.push({ t: stamp(), text: `Could not run it: ${e.message}`, tone: 'error' });
      end('failed', null);
    });
  } catch (e) {
    r.lines.push({ t: stamp(), text: `Could not run it: ${(e as Error).message}`, tone: 'error' });
    end('failed', null);
  }
  if (!ticker) ticker = window.setInterval(tick, 1000);
  app.schedule();
}

function tick(): void {
  if (!Object.values(runs).some((r) => r?.status === 'running')) {
    clearInterval(ticker);
    ticker = 0;
  }
  app.schedule();
}

export function stopRun(kind: RunKind): void {
  const r = runs[kind];
  if (r?.status !== 'running' || !r.proc) return;
  r.stopping = true;
  void r.proc.kill('SIGTERM').catch(() => {});
}

// ---------------------------------------------------------------- Health

let health: { rows: HealthRow[]; at: string } | null = null;

async function readHealth(): Promise<void> {
  const mcp = app.caps.mcp;
  let output: unknown = null;
  if (mcp) {
    try {
      const out = unwrapBousleh(await mcp.callTool(SERVER, 'vault_health', {}));
      if (out.ok) output = out.output;
    } catch {
      output = null;
    }
  }
  health = { rows: healthRows(output, app.facts.repo), at: clock(new Date()) };
  app.schedule();
}

async function openHealth(): Promise<void> {
  await readHealth();
  // The check changes nothing: run it on opening, once, where runs are offered.
  if (app.ui.reach.run && !runs.check && !runs.setup) startRun('check');
}

// ---------------------------------------------------------------- run and copy actions

export async function onRunAction(action: string): Promise<void> {
  switch (action) {
    case 'run-tune':
      startRun('tune');
      return;
    case 'run-tune-stop':
      stopRun('tune');
      return;
    case 'run-check':
      startRun('check');
      return;
    case 'run-setup':
      startRun('setup');
      return;
    case 'run-setup-stop':
      stopRun('setup');
      return;
    case 'copy-setup':
      if (await copyText(SETUP_COMMAND)) app.toast('Copied scripts/setup-mac.sh. Run it once in Terminal, in the repo folder.');
      else app.toast('Run scripts/setup-mac.sh once, in the repo folder.');
      return;
    case 'copy-tune':
      await copyPrompt('Tune: run the Friday tune-up now.', 'for the Code tab on the repo');
      return;
    case 'publish-home':
      await openClaude(PUBLISH_HOME, { code: true });
      return;
    case 'health-refresh':
      await readHealth();
      return;
  }
}

/** The one button that helps when runs aren't offered. */
function unblock(): { action: string; label: string } | null {
  const f = app.facts;
  if (!f.installed) return app.ui.install ? { action: 'install', label: 'Install as app' } : null;
  if (f.platform && f.platform !== 'darwin') return null;
  if (f.fullAccess === 'prompt') return { action: 'perm-full', label: 'Allow full access' };
  if (f.fullAccess === 'denied') return { action: 'permissions-manage', label: 'Permissions' };
  if (f.repo === null) return { action: 'copy-setup', label: 'Copy the command' };
  return null;
}

// ---------------------------------------------------------------- paint

let lastAsk = '';
const lastHtml = new Map<string, string>();

function setHtml(el: HTMLElement | null, key: string, html: string): void {
  if (!el || lastHtml.get(key) === html) return;
  lastHtml.set(key, html);
  el.innerHTML = html;
}

/** Redraw what changed in the panel. Called on every paint. */
export function paintSide(): void {
  const el = side();
  const which = app.ui.side;
  el.hidden = which === null;
  document.body.classList.toggle('side-open', which !== null);
  for (const key of ['ask', 'tune', 'health'] as const) part<HTMLElement>(`.sp-${key}`).hidden = which !== key;
  if (which === 'ask') paintAsk();
  else if (which === 'tune') paintTune();
  else if (which === 'health') paintHealth();
}

function paintAsk(): void {
  const ui = app.ui;
  part<HTMLElement>('.ask-mic').hidden = app.caps.dictation === null;
  const note = part<HTMLElement>('.ask-note');
  note.hidden = ui.reach.ask;
  note.textContent = app.askOff
    ? 'Answers here are off for this page: Ask copies your question for a chat.'
    : 'Answers here need the desktop app with Bousleh live. Here, Ask copies your question for a chat.';
  const chips = suggestionList()
    .map(
      (s, i) =>
        `<button class="chip" type="button" data-action="ask-sugg" data-i="${i}">${esc(s.label)}${s.claude ? whereTag(ui.reach.open ? 'claude' : 'copy') : ''}</button>`,
    )
    .join('');
  setHtml(part('.ask-sugg'), 'sugg', chips);
  const html = askHtml(current, ui, lookups());
  if (html !== lastAsk) {
    lastAsk = html;
    part<HTMLElement>('.ask-out').innerHTML = html;
  }
}

function paintTune(): void {
  const r = runs.tune;
  const blocker = runBlocker(app.facts);
  setHtml(part('.sp-tune .run-blocked'), 'tune-blocked', blocker && !r ? blockedHtml(blocker, unblock()) : '');
  part<HTMLElement>('.run-status').textContent = r ? runStatus(r, Date.now(), elapsed) : '';
  part<HTMLElement>('.run-status').className =
    `mono run-status ${r?.status === 'running' ? 't-moving' : r?.status === 'done' ? 't-muted' : 't-needs'}`;
  const log = part<HTMLElement>('.tune-log');
  log.hidden = !r;
  const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
  setHtml(log, 'tune-log', r ? logHtml(r.lines, r.status === 'running') : '');
  if (atEnd) log.scrollTop = log.scrollHeight;
  let acts = '';
  if (r?.status === 'running') acts = `<button class="btn2 sm" type="button" data-action="run-tune-stop">${icons.stop}Stop</button>`;
  else if (app.ui.reach.run)
    acts = `<button class="btn sm" type="button" data-action="run-tune">${icons.play}${r ? 'Run again' : 'Run Tune now'}</button>`;
  else acts = `<button class="btn2 sm" type="button" data-action="copy-tune">Copy the prompt${whereTag('copy')}</button>`;
  setHtml(part('.tune-acts'), 'tune-acts', acts);
}

function paintHealth(): void {
  part<HTMLElement>('.hl-at').textContent = health ? `Checked ${health.at}` : '';
  setHtml(part('.hl-rows'), 'hl-rows', health ? healthRowsHtml(health.rows) : '<span class="muted-note">Reading…</span>');
  const blocker = runBlocker(app.facts);
  setHtml(part('.hl-blocked'), 'hl-blocked', blocker ? blockedHtml(blocker, unblock()) : '');
  const setup = runs.setup?.status === 'running' ? runs.setup : null;
  const check = runs.check?.status === 'running' ? runs.check : null;
  const can = app.ui.reach.run;
  const mac = whereTag(can ? 'mac' : 'copy');
  const acts = [
    can && !check && !setup ? `<button class="btn2 sm" type="button" data-action="run-check">Check setup${mac}</button>` : '',
    setup
      ? `<button class="btn2 sm" type="button" data-action="run-setup-stop">${icons.stop}Stop setup</button>`
      : can
        ? `<button class="btn2 sm" type="button" data-action="run-setup">Rerun setup${mac}</button>`
        : '',
    `<button class="btn2 sm" type="button" data-action="publish-home">Finish setup${whereTag(app.ui.reach.open && app.facts.repo ? 'claude' : 'copy')}</button>`,
    '<button class="btn2 sm" type="button" data-action="health-refresh">Refresh</button>',
  ].join('');
  setHtml(part('.hl-acts'), 'hl-acts', acts);
  const shown = runs.setup && runs.setup.started >= (runs.check?.started ?? 0) ? runs.setup : runs.check;
  const log = part<HTMLElement>('.hl-log');
  log.hidden = !shown;
  const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
  setHtml(log, 'hl-log', shown ? logHtml(shown.lines, shown.status === 'running') : '');
  if (atEnd) log.scrollTop = log.scrollHeight;
}
