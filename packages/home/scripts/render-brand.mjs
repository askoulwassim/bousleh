// Renders the README's social preview, docs/assets/social-preview.png (1280 × 640), with the
// Playwright Chromium on this machine, as render-icon.mjs does for the app icon. The fonts are the
// ones Home inlines (build.mjs), so nothing is fetched. Run by hand when the mark or the line changes:
//   node scripts/render-brand.mjs
//
// The logos beside it (docs/assets/logo-dark.svg, logo-light.svg) are the Ba Ring from assets/logo.svg
// with the wordmark outlined from Bricolage Grotesque 800, so GitHub draws them without the font.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fontFaces, loadTokens } from './build.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '../../docs/assets/social-preview.png');
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH ?? 'playwright');
const ring = readFileSync(join(root, 'assets/logo.svg'), 'utf8').replace(/<title>.*?<\/title>/, '');
const c = (await loadTokens()).tokens.color;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFaces()}
html,body{margin:0}
.card{width:1280px;height:640px;box-sizing:border-box;padding:0 112px;display:flex;align-items:center;gap:64px;
  background:${c.bg} radial-gradient(820px 560px at 100% 0%, ${c.glow}, transparent 70%);color:${c.fg};overflow:hidden}
.ring svg{width:240px;height:240px;display:block}
.words{display:flex;flex-direction:column;gap:14px}
.mark{display:flex;align-items:baseline;gap:28px}
.en{font:800 132px/0.9 'Bricolage Grotesque';letter-spacing:-0.05em}
.ar{font:500 44px/1 'Noto Kufi Arabic';color:${c.muted}}
.line{font:500 34px/1.3 Figtree;color:${c.muted};max-width:760px}
.line b{color:${c.fg};font-weight:600}
</style></head><body><div class="card">
<div class="ring">${ring}</div>
<div class="words">
<div class="mark"><span class="en">bousleh</span><span class="ar" lang="ar" dir="rtl">بوصلة</span></div>
<span class="line">A compass for product leaders, built on Claude.</span>
</div>
</div></body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 640 } });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.card').screenshot({ path: out });
} finally {
  await browser.close();
}
console.log('home: docs/assets/social-preview.png');
