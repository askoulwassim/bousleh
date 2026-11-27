// Builds dist/home.html: one self-contained page. All JS, CSS and fonts inline, so opening it pings
// nobody. No data is ever written into it: the page reads its data at run time.
// Ask's instructions (src/ask-prompt.md) are bundled in as text. The desktop permissions Home uses
// are declared in the claude-artifacts-manifest tag, exactly the ones it calls.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/**
 * The fonts Home uses, self-hosted from the @fontsource packages (all SIL OFL; THIRD_PARTY_NOTICES.md).
 * Only the latin subset of the three Latin families, as variable fonts (Bricolage Grotesque keeps its
 * optical size axis, as Google served it), and the arabic subset of Noto Kufi Arabic at 500, which only
 * draws the lockup. Each face keeps the family name the tokens use.
 */
const FONTS = [
  {
    pkg: '@fontsource-variable/bricolage-grotesque',
    css: 'opsz.css',
    face: 'bricolage-grotesque-latin-opsz-normal',
    family: 'Bricolage Grotesque',
  },
  { pkg: '@fontsource-variable/figtree', css: 'wght.css', face: 'figtree-latin-wght-normal', family: 'Figtree' },
  { pkg: '@fontsource-variable/jetbrains-mono', css: 'wght.css', face: 'jetbrains-mono-latin-wght-normal', family: 'JetBrains Mono' },
  { pkg: '@fontsource/noto-kufi-arabic', css: '500.css', face: 'noto-kufi-arabic-arabic-500-normal', family: 'Noto Kufi Arabic' },
];

/** One @font-face rule per font, its woff2 inlined as base64, its weights and unicode-range taken from the package's own CSS. */
export function fontFaces() {
  return FONTS.map(({ pkg, css, face, family }) => {
    const dir = dirname(require.resolve(`${pkg}/package.json`));
    const sheet = readFileSync(join(dir, css), 'utf8');
    const block = new RegExp(`/\\* ${face} \\*/\\s*@font-face\\s*{([^}]*)}`).exec(sheet)?.[1];
    if (!block) throw new Error(`home: no ${face} face in ${pkg}/${css}`);
    const prop = (name) => new RegExp(`${name}:\\s*([^;]+);`).exec(block)?.[1].trim();
    const file = /url\(\.\/(files\/[^)]+\.woff2)\)/.exec(block)?.[1];
    if (!file) throw new Error(`home: no woff2 for ${face}`);
    const data = readFileSync(join(dir, file)).toString('base64');
    return `@font-face{font-family:'${family}';font-style:normal;font-display:swap;font-weight:${prop('font-weight')};src:url(data:font/woff2;base64,${data}) format('woff2');unicode-range:${prop('unicode-range')}}`;
  }).join('\n');
}

/** Bundle a TypeScript entry to a string. */
async function bundle(entry, format) {
  const out = await build({
    entryPoints: [join(root, entry)],
    bundle: true,
    write: false,
    format,
    target: 'es2022',
    minify: format === 'iife',
    legalComments: 'none',
    logLevel: 'warning',
    loader: { '.md': 'text' },
  });
  return out.outputFiles[0].text;
}

/** The tokens module the page uses (src/tokens.ts), bundled and loaded here. */
export async function loadTokens() {
  const code = await bundle('src/tokens.ts', 'esm');
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

/** The tokens CSS, computed by the same module the page uses. */
async function tokensCss() {
  return (await loadTokens()).tokensCss();
}

/** Collapse a stylesheet: comments and runs of whitespace out. Enough for a hand-written file. */
function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

/** The permissions Home asks the desktop app for: full access (open Claude, run Tune and the checks), the menu bar item, the Capture shortcut. */
export const PERMISSIONS = ['full-access', 'menu-bar', 'shortcuts'];

export async function buildPage() {
  const [js, tokens] = await Promise.all([bundle('src/main.ts', 'iife'), tokensCss()]);
  const fonts = fontFaces();
  const css = minifyCss(readFileSync(join(root, 'src/styles.css'), 'utf8'));
  const favicon = readFileSync(join(root, 'assets/favicon.svg'), 'utf8').trim();
  const faviconUri = `data:image/svg+xml,${encodeURIComponent(favicon)}`;
  // The installed app's icon (desktop capability): drawn onto a 256 px canvas at run time, from this SVG.
  const appIcon = readFileSync(join(root, 'assets/app-icon.svg'), 'utf8').trim();
  const appIconUri = `data:image/svg+xml,${encodeURIComponent(appIcon)}`;
  const version = JSON.parse(readFileSync(join(root, '../../package.json'), 'utf8')).version ?? '';
  const manifest = JSON.stringify({ permissions: PERMISSIONS });
  // A literal "</script" inside the bundle would end the script element early.
  const safeJs = js.replace(/<\/script/gi, '<\\/script');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Bousleh Home</title>
<meta name="description" content="Bousleh Home: every scope at every altitude, what needs you, and what Horizon found.">
<link rel="icon" type="image/svg+xml" href="${faviconUri}">
<meta name="bousleh-app-icon" content="${appIconUri}">
<meta name="bousleh-version" content="${version}">
<script type="application/json" id="claude-artifacts-manifest">${manifest}</script>
<style>${fonts}
${tokens}
${css}</style>
</head>
<body>
<div id="app"></div>
<div id="sheet" class="sheet" hidden><div class="card sheet-card" role="dialog" aria-modal="true" aria-labelledby="sheet-t"><span id="sheet-t" class="disp sheet-t"></span><textarea aria-labelledby="sheet-t" spellcheck="false"></textarea><span class="sheet-n"></span><div class="sheet-a"><button class="btn2 sm" type="button" data-action="sheet-close">Close</button><button class="btn" type="button" data-action="sheet-copy">Copy</button></div></div></div>
<aside id="side" class="side" hidden aria-label="Side panel"></aside>
<div id="capture" class="cap-wrap" hidden></div>
<div id="first" class="first" hidden></div>
<div id="toast" class="toast" role="status" aria-live="polite"></div>
<script>${safeJs}</script>
</body>
</html>
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const html = await buildPage();
  // Home must stay one file that pings nobody: no stylesheet, script or font from the network.
  if (/<(link|script)[^>]+(href|src)="https?:/i.test(html) || /url\((['"]?)https?:/i.test(html))
    throw new Error('home: the page loads something from the network');
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'dist/home.html'), html);
  console.log(`home: dist/home.html (${(html.length / 1024).toFixed(1)} KB)`);
}
