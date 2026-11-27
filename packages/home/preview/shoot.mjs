// Preview harness: renders the built page against fixtures from preview/seed.mjs, with a stand-in
// for the Claude page runtime, and screenshots it at wide (2560), desktop (1440), tablet (1024) and phone (390) widths, live,
// from a snapshot, and with no data. Also screenshots the Claude Design boards for comparison.
//
//   node preview/shoot.mjs [out-dir]      (default: preview/out/shots)
//   node preview/shoot.mjs --readme       the README's pictures of Home, into docs/assets: home-desktop.png
//                                         (1440 wide), home-phone.png (390 wide) and home.gif (needs ffmpeg)
//
// The fixtures are the demo cast (preview/demo-data.mjs), on a throwaway engine. The stand-in runtime
// is preview/runtime.mjs. Uses the Playwright Chromium already on the machine. Home's fonts are inline;
// the design boards still load theirs from Google Fonts, fetched through curl so the machine's own
// certificate setup applies. Nothing here ends up in dist.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPage } from '../scripts/build.mjs';
import { fakeRuntime, inject } from './runtime.mjs';
import { seed } from './seed.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? 'playwright');
const args = process.argv.slice(2);
const readme = args.includes('--readme');
const assets = join(here, '../../../docs/assets');
const outDir = readme ? assets : (args.find((a) => !a.startsWith('--')) ?? join(here, 'out/shots'));
mkdirSync(outDir, { recursive: true });
mkdirSync(join(here, 'out'), { recursive: true });

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

/**
 * The README's pictures: the installed app on the demo data, the window and the phone as they first
 * open (not full page), and a short GIF that marks a commitment done, asks a question, captures a
 * thought and runs Tune. The GIF is recorded with Playwright's video and cut down with ffmpeg.
 */
async function readmeShots(browser, html) {
  const still = async (name, width, height) => {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
    const p = await context.newPage();
    await p.setContent(html, { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(600);
    await p.screenshot({ path: join(assets, `${name}.png`) });
    await context.close();
    console.log(`docs/assets/${name}.png`);
  };
  await still('home-desktop', 1440, 900);
  await still('home-phone', 390, 844);

  const videoDir = mkdtempSync(join(tmpdir(), 'bousleh-gif-'));
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
    });
    const p = await context.newPage();
    await p.setContent(html, { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(2200);
    await p.click('.fc [data-act="done"]');
    await p.waitForTimeout(700);
    await p.click('.fc [data-act="done"]');
    await p.waitForTimeout(1800);
    await p.click('[data-action="side-ask"]');
    await p.waitForTimeout(700);
    await p.click('[data-action="ask-sugg"][data-i="0"]');
    await p.waitForTimeout(2600);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(500);
    await p.click('.hdr [data-action="capture"]');
    await p.waitForTimeout(500);
    await p.type('.cap-text', 'I owe Rowan the Q1 plan by Wednesday.', { delay: 35 });
    await p.waitForTimeout(400);
    await p.click('[data-action="cap-send"]');
    await p.waitForTimeout(1600);
    await p.keyboard.press('Escape');
    await p.waitForTimeout(400);
    await p.click('[data-action="side-tune"]');
    await p.waitForTimeout(500);
    await p.click('[data-action="run-tune"]');
    await p.waitForTimeout(2600);
    const video = p.video();
    await context.close();
    const webm = await video.path();
    const gif = join(assets, 'home.gif');
    const filters =
      'fps=8,scale=880:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle';
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-t', '20', '-i', webm, '-vf', filters, '-loop', '0', gif]);
    console.log(`docs/assets/home.gif (${(statSync(gif).size / 1024 / 1024).toFixed(1)} MB)`);
  } finally {
    rmSync(videoDir, { recursive: true, force: true });
  }
}

const fixtures = await seed();
writeFileSync(join(here, 'out/fixtures.json'), JSON.stringify(fixtures, null, 2));
const page = await buildPage();
const browser = await chromium.launch();
try {
  if (readme) {
    await readmeShots(browser, inject(page, fakeRuntime(fixtures, 'live', null, { where: 'app' })));
  } else {
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
  }
} finally {
  await browser.close();
}
