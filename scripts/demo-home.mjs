#!/usr/bin/env node
/*
 * See Home on the demo data, in a browser, before installing anything:
 *   pnpm demo:home              serve it on http://localhost:4173 (Ctrl-C stops it)
 *   pnpm demo:home --file       write it to packages/home/preview/out/demo-home.html instead
 *   pnpm demo:home --port 5000  another port
 *
 * Reads ~/.bousleh-demo with read-only ops (seeding it first, as `pnpm demo` does, if it isn't there),
 * builds the page, and runs it with the preview's stand-in for the Claude page runtime
 * (packages/home/preview/runtime.mjs), as the installed app with full access. It is a look, not a
 * door: presses answer as if they worked, but nothing is written, nothing runs and Claude never opens.
 * The server listens on 127.0.0.1 only.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEMO_HOME, ensureDemo, REPO } from './demo.mjs';

const args = process.argv.slice(2);
const toFile = args.includes('--file');
const portAt = args.indexOf('--port');
const port = portAt >= 0 ? Number(args[portAt + 1]) : 4173;
const mod = (path) => import(pathToFileURL(join(REPO, path)).href);

try {
  await ensureDemo({ home: DEMO_HOME });
} catch (err) {
  console.error(`demo:home: ${err.message}`);
  process.exit(1);
}

const { openEngine } = await mod('packages/engine/dist/index.js');
const { fixturesFrom } = await mod('packages/home/preview/seed.mjs');
const { fakeRuntime, inject } = await mod('packages/home/preview/runtime.mjs');
const { buildPage } = await mod('packages/home/scripts/build.mjs');

const engine = openEngine({ home: DEMO_HOME });
let fixtures;
try {
  fixtures = await fixturesFrom(engine);
} finally {
  engine.close();
}
const html = inject(await buildPage(), fakeRuntime(fixtures, 'live', null, { where: 'app', repo: REPO }));

function writeFile() {
  const out = join(REPO, 'packages/home/preview/out/demo-home.html');
  mkdirSync(join(REPO, 'packages/home/preview/out'), { recursive: true });
  writeFileSync(out, html);
  console.log(`Home on the demo data: ${out}`);
  if (process.platform === 'darwin') execFile('open', [out], () => {});
}

if (toFile) {
  writeFile();
} else {
  const server = createServer((req, res) => {
    if (req.url !== '/' && req.url !== '/index.html') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
  });
  server.on('error', (err) => {
    console.log(`Port ${port} isn't free (${err.code}); writing the page to a file instead.`);
    writeFile();
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Home on the demo data (${DEMO_HOME}): http://localhost:${port}`);
    console.log('A look, not a door: presses answer as if they worked, but nothing is written. Ctrl-C stops it.');
  });
}
