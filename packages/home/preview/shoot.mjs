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

/** The stand-in runtime, injected before the page's script. mode: live | snapshot | nosnap. */
function fakeRuntime(fixtures, mode, stored) {
  return `<script>
(() => {
  const fixtures = ${JSON.stringify(fixtures)};
  const mode = ${JSON.stringify(mode)};
  const stored = ${JSON.stringify(stored ?? null)};
  window.__writes = [];
  const later = (fn, ms = 40) => setTimeout(fn, ms);
  const ok = (output) => ({ content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: { status: 'ok', output } });
  const pick = (tool, input) => (tool === 'watch_digest' && input && input.status ? fixtures.watch_digest_to_read : fixtures[tool]);
  const mcp = Object.freeze({
    watchTool(server, tool, input, handler) {
      later(() => {
        if (mode !== 'live') return handler({ type: 'error', error: { code: 'server_not_connected', message: 'no host here' } });
        if (server === 'Google Calendar') return handler({ type: 'data', result: { content: [], payload: fixtures.list_events } });
        handler({ type: 'data', result: ok(pick(tool, input)) });
      });
      return () => {};
    },
    callTool: async (server, tool, input) => ok({ id: input.id }),
    invalidate: async () => {},
  });
  const db = Object.freeze({
    doc: (path) => ({
      get: async () => ({ exists: stored !== null, data: () => stored }),
      set: async (data) => { window.__writes.push({ path, data }); },
    }),
  });
  const user = Object.freeze({ isOwner: async () => true });
  window.claude = Object.freeze({ use: (name) => new Promise((r) => later(() => r({ mcp, db, user }[name] ?? null), 20)) });
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

async function shot(browser, html, name, width, height) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: width < 720 ? 2 : 1 });
  await routeFonts(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
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
