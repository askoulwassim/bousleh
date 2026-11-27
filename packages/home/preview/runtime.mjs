// The stand-in for the Claude page runtime (window.claude), used by preview/shoot.mjs and
// scripts/demo-home.mjs. It serves fixtures from preview/seed.mjs (or read from ~/.bousleh-demo) to
// the page's MCP reads, answers its writes with ok without writing anything, and fakes the desktop
// modules (Dock, menu bar, shortcut, runs) so every panel can be seen. Nothing here ends up in dist.

/**
 * The stand-in runtime, injected before the page's script. mode: live | snapshot | nosnap.
 * where: panel (beside a chat: desktop offers only install) | app (the installed window, with every
 * desktop module) | web (no desktop, no sample). perms: the installed app's permission states.
 * repo: the folder ~/.bousleh/app.json names. Every call is recorded on window.__calls, __execs, __spawns, __tray and __badge for checking.
 */
export function fakeRuntime(fixtures, mode, stored, opts = {}) {
  const where = opts.where ?? 'panel';
  const perms = opts.perms ?? {
    'full-access': 'granted',
    'menu-bar': 'granted',
    shortcuts: 'granted',
    overlay: 'unavailable',
    notifications: 'unavailable',
  };
  return `<script>
(() => {
  const fixtures = ${JSON.stringify(fixtures)};
  const mode = ${JSON.stringify(mode)};
  const stored = ${JSON.stringify(stored ?? null)};
  const where = ${JSON.stringify(where)};
  const perms = ${JSON.stringify(perms)};
  const firstSeen = ${JSON.stringify(opts.firstSeen ?? true)};
  const repo = ${JSON.stringify(opts.repo ?? '/opt/bousleh')};
  window.__writes = [];
  window.__calls = [];
  window.__execs = [];
  window.__spawns = [];
  window.__tray = null;
  window.__badge = null;
  const later = (fn, ms = 40) => setTimeout(fn, ms);
  const ok = (output) => ({ content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: { status: 'ok', output } });
  const pick = (tool, input) => (tool === 'watch_digest' && input && input.status ? fixtures.watch_digest_to_read : fixtures[tool]);
  const sha = 'a'.repeat(64);
  const answers = {
    vault_health: { ok: true, version: '0.2.0', home: '~/.bousleh', data: { exists: true, db: true }, ops: 41, backups: { dir: '~/.bousleh-backups', latest: '2026-11-27-0600', count: 14 }, now: new Date().toISOString() },
    inbox_drop: { sha256: sha, duplicate: false, file: null },
    inbox_settle: { sha256: sha, source: 'local', name: 'capture.md', outcome: 'skipped', object_id: null, processed_path: 'inbox/processed/x' },
  };
  const mcp = Object.freeze({
    watchTool(server, tool, input, handler) {
      later(() => {
        if (mode !== 'live') return handler({ type: 'error', error: { code: 'server_not_connected', message: 'no host here' } });
        if (server === 'Google Calendar') return handler({ type: 'data', result: { content: [], payload: fixtures.list_events } });
        handler({ type: 'data', result: ok(pick(tool, input)) });
      });
      return () => {};
    },
    callTool: async (server, tool, input) => {
      window.__calls.push({ server, tool, input });
      if (answers[tool]) return ok(answers[tool]);
      if (fixtures[tool]) return ok(pick(tool, input));
      return ok({ id: input.id });
    },
    invalidate: async () => {},
  });
  const db = Object.freeze({
    doc: (path) => ({
      get: async () => (path === 'app/first-launch' ? { exists: firstSeen, data: () => ({ continued: firstSeen }) } : { exists: stored !== null, data: () => stored }),
      set: async (data) => { window.__writes.push({ path, data }); },
    }),
  });
  const user = Object.freeze({ isOwner: async () => true });
  // sample: reads two tools through the page's own functions, then answers in Home's JSON shape.
  const focus = (fixtures.pulse_today && fixtures.pulse_today.focus) || [];
  const first = focus.find((f) => f.kind === 'commitment');
  const sample = Object.freeze({
    json: async (input, o) => {
      const tools = (o && o.tools) || [];
      window.__sampleTools = tools.map((t) => t.name);
      for (const name of ['pulse_today', 'commitments_list']) {
        const t = tools.find((x) => x.name === name);
        if (t) await t.execute({}, { signal: new AbortController().signal });
        await new Promise((r) => setTimeout(r, 30));
      }
      const blocks = [{ type: 'p', text: first ? 'One thing first: it is late, and the person waiting sees you today.' : 'Nothing needs you right now.' }];
      if (first) blocks.push({ type: 'commitment', id: first.id, title: first.title, why: first.why.join('. ') });
      blocks.push({ type: 'p', text: 'Can wait: the hiring plan (forming, nothing due).', quiet: true });
      blocks.push({ type: 'handoff', mode: 'Communicate', prompt: 'Communicate: draft the Q1 plan for Rowan Vale at 10,000 ft, from the Harbor strategy.' });
      return { blocks };
    },
  });
  const tts = Object.freeze({ speak: async () => ({ playedMs: 10 }), stop: async () => {}, onState: () => () => {} });
  const install = Object.freeze({ state: async () => (where === 'app' ? 'installed' : 'available'), request: async () => 'installed' });
  const fakeProc = (args) => {
    const handlers = { out: [], err: [], exit: [] };
    const lines = args[1].startsWith('claude')
      ? [
          '{"type":"system","subtype":"init"}',
          '{"type":"assistant","message":{"content":[{"type":"text","text":"Reading the week through vault_activity."},{"type":"tool_use","name":"mcp__bousleh__vault_activity","input":{}}]}}',
          '{"type":"assistant","message":{"content":[{"type":"text","text":"Fixed: 2 duplicate people merged (same email)."}]}}',
          '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"gh pr create --title Tune-up"}}]}}',
        ]
      : ['What is set up already (nothing is changed)', '  Claude Desktop: "bousleh" runs node packages/mcp-server/dist/bin.js', '  ✓ Home page: built', '  ! Backups: none yet'];
    let i = 0;
    const tick = () => {
      if (i < lines.length) { for (const h of handlers.out) h(lines[i] + '\\n'); i += 1; setTimeout(tick, 60); }
    };
    setTimeout(tick, 30);
    return {
      stdout: { on: (_e, h) => handlers.out.push(h) },
      stderr: { on: (_e, h) => handlers.err.push(h) },
      on: (e, h) => { if (e === 'exit') handlers.exit.push(h); },
      kill: async () => { for (const h of handlers.exit) h(null, 'SIGTERM'); },
    };
  };
  const app = Object.freeze({
    install,
    permissions: Object.freeze({
      state: async () => ({ ...perms }),
      request: async (names) => { for (const n of names || []) if (perms[n] === 'prompt') perms[n] = 'granted'; return { ...perms }; },
      manage: async () => {},
    }),
    window: Object.freeze({ show: async () => {} }),
    app: Object.freeze({ dock: Object.freeze({ setIcon: async () => ({ written: true }), setBadge: async (t) => { window.__badge = t; return true; } }) }),
    fs: Object.freeze({ readFile: async (path) => { if (path === '~/.bousleh/app.json') return JSON.stringify({ repo, updated: '2026-11-27T15:00:00Z' }); throw new Error('ENOENT: ' + path); } }),
    childProcess: Object.freeze({
      exec: async (command) => { window.__execs.push(command); return { stdout: '', stderr: '', code: 0 }; },
      spawn: (command, args, o) => { window.__spawns.push({ command, args, cwd: o && o.cwd }); return fakeProc(args); },
    }),
    os: Object.freeze({ platform: async () => 'darwin' }),
    globalShortcut: Object.freeze({ register: async (acc) => { window.__shortcut = acc; return true; }, unregister: async () => {} }),
    tray: Object.freeze({ set: async (o) => { window.__tray = { title: o.title, labels: (o.menu || []).map((m) => m.label || '-') }; return true; }, remove: async () => {} }),
  });
  const desktop = where === 'app' ? app : where === 'panel' ? Object.freeze({ install }) : null;
  const caps = { mcp, db, user, desktop, sample: where === 'web' ? null : sample, tts: where === 'web' ? null : tts, dictation: null };
  window.claude = Object.freeze({ use: (name) => new Promise((r) => later(() => r(caps[name] ?? null), 20)) });
})();
</script>`;
}

/** Put a stand-in runtime script in the page, before the page's own script. */
export const inject = (html, script) => html.replace('<meta charset="utf-8">', `<meta charset="utf-8">${script}`);
