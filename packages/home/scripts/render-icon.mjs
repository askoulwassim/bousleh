// Renders assets/app-icon.svg to assets/app-icon-1024.png with the Playwright Chromium on this
// machine. Run by hand when the icon changes: node scripts/render-icon.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH ?? 'playwright');
const svg = readFileSync(join(root, 'assets/app-icon.svg'), 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.locator('svg').screenshot({ path: join(root, 'assets/app-icon-1024.png'), omitBackground: true });
} finally {
  await browser.close();
}
console.log('home: assets/app-icon-1024.png');
