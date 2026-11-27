// Preview fixtures: runs the real engine on a throwaway data home filled with the demo cast
// (preview/demo-data.mjs, the same data `pnpm demo` writes to ~/.bousleh-demo), then saves each op's
// output as JSON, so the preview renders exactly the shapes the page reads live.
// Never touches ~/.bousleh. Output: preview/out/fixtures.json (ignored by git).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openEngine } from '../../engine/dist/index.js';
import { fillDemo, readFixtures } from './demo-data.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** Read Home's fixtures from an engine that already holds data (read-only ops only). */
export function fixturesFrom(engine, now = new Date()) {
  const ctx = { actor: 'agent', now: () => now };
  return readFixtures(async (name, input = {}) => {
    const out = await engine.runOp(name, input, ctx);
    if (out.status !== 'ok') throw new Error(`${name}: ${out.code} ${out.message}`);
    return out.output;
  }, now);
}

export async function seed(now = new Date()) {
  const home = mkdtempSync(join(tmpdir(), 'bousleh-home-preview-'));
  const engine = openEngine({ home });
  try {
    await fillDemo(engine, now);
    return await fixturesFrom(engine, now);
  } finally {
    engine.close();
    rmSync(home, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const fixtures = await seed();
  mkdirSync(join(here, 'out'), { recursive: true });
  writeFileSync(join(here, 'out/fixtures.json'), JSON.stringify(fixtures, null, 2));
  console.log('preview: out/fixtures.json');
}
