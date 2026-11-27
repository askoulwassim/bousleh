// Preview harness: renders the built page against fixtures from preview/seed.mjs, with a stand-in
// for the Claude page runtime, and screenshots it at wide (2560), desktop (1440), tablet (1024) and phone (390) widths, live,
// from a snapshot, and with no data. Also screenshots the Claude Design boards for comparison.
//
//   node preview/shoot.mjs [out-dir]      (default: preview/out/shots)
//
// Uses the Playwright Chromium already on the machine. Fonts are fetched through curl so the
// machine's own certificate setup applies. Nothing here ends up in dist.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPage } from '../scripts/build.mjs';
import { seed } from './seed.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? 'playwright');
const outDir = process.argv[2] ?? join(here, 'out/shots');
mkdirSync(outDir, { recursive: true });
mkdirSync(join(here, 'out'), { recursive: true });

/**
 * The stand-in runtime, injected before the page's script. mode: live | snapshot | nosnap.
 * where: panel (beside a chat: desktop offers only install) | app (the installed window, with every
 * desktop module) | web (no desktop, no sample). perms: the installed app's permission states.
 * Every call is recorded on window.__calls, __execs, __spawns, __tray and __badge for checking.
 */
function fakeRuntime(fixtures, mode, stored, opts = {}) {
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
    fs: Object.freeze({ readFile: async (path) => { if (path === '~/.bousleh/app.json') return JSON.stringify({ repo: '/opt/bousleh', updated: '2026-11-27T15:00:00Z' }); throw new Error('ENOENT: ' + path); } }),
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

const inject = (html, script) => html.replace('<meta charset="utf-8">', `<meta charset="utf-8">${script}`);

/** A Claude Design board as a plain page: the <x-dc> wrapper and its loader removed. */
function boardPage(file) {
  const src = readFileSync(file, 'utf8');
  const helmet = /<helmet>([\s\S]*?)<\/helmet>/.exec(src)?.[1] ?? '';
  const body = /<\/helmet>([\s\S]*?)<\/x-dc>/.exec(src)?.[1] ?? '';
  return `<!doctype html><html><head><meta charset="utf-8">${helmet}</head><body>${body}</body></html>`;
}

const fontCache = new Map();
async function routeFonts(context) {
  await context.route(/fonts\.(googleapis|gstatic)\.com/, async (route) => {
    const url = route.request().url();
    try {
      if (!fontCache.has(url)) {
        const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
        fontCache.set(url, execFileSync('curl', ['-sfL', '-A', ua, url], { maxBuffer: 1 << 26 }));
      }
      const body = fontCache.get(url);
      const type = url.includes('googleapis') ? 'text/css' : 'font/woff2';
      await route.fulfill({ status: 200, body, headers: { 'content-type': type, 'access-control-allow-origin': '*' } });
    } catch {
      await route.abort();
    }
  });
}

async function shot(browser, html, name, width, height, steps = null) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: width < 720 ? 2 : 1 });
  await routeFonts(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  if (steps) await steps(page);
  const writes = await page.evaluate(() => window.__writes ?? []);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.screenshot({ path: join(outDir, `${name}.png`), fullPage: true });
  await context.close();
  console.log(
    `${name}: ${width}px${overflow > 0 ? ` OVERFLOW ${overflow}px` : ''}${errors.length ? ` errors: ${errors.join(' | ')}` : ''}`,
  );
  return writes;
}

const fixtures = await seed();
writeFileSync(join(here, 'out/fixtures.json'), JSON.stringify(fixtures, null, 2));
const page = await buildPage();
const browser = await chromium.launch();
try {
  const writes = await shot(browser, inject(page, fakeRuntime(fixtures, 'live')), 'home-live-desktop', 1440, 900);
  await shot(browser, inject(page, fakeRuntime(fixtures, 'live')), 'home-live-phone', 390, 844);
  await shot(browser, inject(page, fakeRuntime(fixtures, 'live')), 'home-live-tablet', 1024, 800);
  await shot(browser, inject(page, fakeRuntime(fixtures, 'live')), 'home-live-wide', 2560, 1300);
  const snapshot = writes.find((w) => w.path === 'snapshot/latest')?.data;
  if (!snapshot) console.log('no snapshot was written by the live page');
  writeFileSync(join(here, 'out/snapshot.json'), JSON.stringify(snapshot ?? null, null, 2));
  await shot(browser, inject(page, fakeRuntime(fixtures, 'snapshot', snapshot)), 'home-snapshot-phone', 390, 844);
  await shot(browser, inject(page, fakeRuntime(fixtures, 'snapshot', snapshot)), 'home-snapshot-desktop', 1440, 900);
  await shot(browser, inject(page, fakeRuntime(fixtures, 'nosnap', null)), 'home-empty-phone', 390, 844);
  await shot(browser, page, 'home-no-runtime-desktop', 1440, 900);

  // The installed app, with full access: tags read In Claude, acts and panels work in place.
  const appRt = (o = {}) => inject(page, fakeRuntime(fixtures, 'live', null, { where: 'app', ...o }));
  const report = async (p, label) =>
    console.log(
      `  ${label}:`,
      JSON.stringify(
        await p.evaluate(() => ({
          calls: window.__calls,
          execs: window.__execs,
          spawns: window.__spawns,
          tray: window.__tray,
          badge: window.__badge,
          shortcut: window.__shortcut,
          tools: window.__sampleTools,
        })),
      ),
    );
  await shot(browser, appRt(), 'app-window', 1440, 900, async (p) => report(p, 'shell'));
  await shot(browser, appRt(), 'app-first-confirm', 1440, 900, async (p) => {
    await p.click('.fc [data-act="close"]');
    await p.waitForTimeout(100);
  });
  await shot(browser, appRt(), 'app-first-picker', 1440, 900, async (p) => {
    await p.click('.fc [data-act="date"]');
    await p.waitForTimeout(100);
  });
  await shot(browser, appRt(), 'app-first-done', 1440, 900, async (p) => {
    await p.click('.fc [data-act="done"]');
    await p.click('.fc [data-act="done"]');
    await p.waitForTimeout(200);
    await report(p, 'done');
  });
  await shot(browser, appRt(), 'app-ask', 1440, 900, async (p) => {
    await p.click('[data-action="side-ask"]');
    await p.click('[data-action="ask-sugg"][data-i="0"]');
    await p.waitForTimeout(400);
    await report(p, 'ask');
  });
  await shot(browser, appRt(), 'app-open-claude', 1440, 900, async (p) => {
    await p.click('.lb[data-prompt]:not([data-ask])');
    await p.waitForTimeout(150);
    await report(p, 'open');
  });
  await shot(browser, appRt(), 'app-capture', 1440, 900, async (p) => {
    await p.click('.hdr [data-action="capture"]');
    await p.fill('.cap-text', 'I owe Rowan the Q1 plan by Wednesday, and Priya wants the design review moved.');
    await p.click('[data-action="cap-send"]');
    await p.waitForTimeout(200);
    await report(p, 'capture');
  });
  await shot(browser, appRt(), 'app-tune', 1440, 900, async (p) => {
    await p.click('[data-action="side-tune"]');
    await p.click('[data-action="run-tune"]');
    await p.waitForTimeout(600);
    await report(p, 'tune');
  });
  await shot(browser, appRt(), 'app-health', 1440, 900, async (p) => {
    await p.click('[data-action="side-health"]');
    await p.waitForTimeout(600);
  });
  await shot(
    browser,
    appRt({ perms: { 'full-access': 'prompt', 'menu-bar': 'granted', shortcuts: 'prompt' }, firstSeen: false }),
    'app-first-launch',
    1440,
    900,
  );
  await shot(
    browser,
    appRt({ perms: { 'full-access': 'denied', 'menu-bar': 'granted', shortcuts: 'granted' } }),
    'app-no-full-access',
    1440,
    900,
    async (p) => {
      await p.click('[data-action="side-tune"]');
      await p.waitForTimeout(100);
    },
  );
  await shot(
    browser,
    inject(page, fakeRuntime(fixtures, 'live', null, { where: 'panel' })),
    'panel-capture-dictation-off',
    1440,
    900,
    async (p) => {
      await p.click('.hdr [data-action="capture"]');
    },
  );
  if (process.env.BOARDS !== '0') {
    const boards = join(here, '../../../docs/design/home');
    for (const file of readdirSync(boards).filter((f) => f.startsWith('Home'))) {
      const phone = file.includes('Phone');
      await shot(browser, boardPage(join(boards, file)), `design-${file.replace('.dc.html', '')}`, phone ? 390 : 1440, 900);
    }
  }
} finally {
  await browser.close();
}
