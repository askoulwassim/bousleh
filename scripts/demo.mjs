#!/usr/bin/env node
/*
 * Demo data, to try Bousleh before giving it your own work:
 *   pnpm demo            seed ~/.bousleh-demo with a fictional cast (once; a second run leaves it)
 *   pnpm demo --reset    wipe ~/.bousleh-demo and seed it again, with dates from today
 *
 * The cast is packages/home/preview/demo-data.mjs: Alex Rivera, a group PM at Northwind, with scopes,
 * strategies, commitments late, due and snoozed, meetings, a bet, metrics, Horizon findings and watch
 * lists, a queue and an inbox file. It is written through the engine's ops, like any other door.
 *
 * It only ever writes to ~/.bousleh-demo (or --home <dir>, for a folder that doesn't exist yet), and
 * refuses any folder that exists without its demo.json marker, so it never touches your real data.
 * Then `scripts/setup-mac.sh --demo` registers it in Claude as the bousleh-demo server, and
 * `pnpm demo:home` shows Home on it in a browser.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DEMO_HOME = join(homedir(), '.bousleh-demo');
const MARKER = 'demo.json';

/** The folders demo data must never go into: your real data, wherever it is. */
function realHomes() {
  const homes = [join(homedir(), '.bousleh')];
  if (process.env.BOUSLEH_HOME?.trim()) homes.push(resolve(process.env.BOUSLEH_HOME.trim()));
  return homes.map((h) => resolve(h));
}

/** The engine, built if it isn't yet. */
async function engineModule() {
  const entry = join(REPO, 'packages/engine/dist/index.js');
  if (!existsSync(entry) || !existsSync(join(REPO, 'packages/home/node_modules'))) {
    console.log('Building first (pnpm install, pnpm build)...');
    for (const args of [
      ['install', '--frozen-lockfile', '--reporter=silent'],
      ['-s', 'build'],
    ]) {
      const out = spawnSync('pnpm', args, { cwd: REPO, stdio: 'inherit' });
      if (out.status !== 0) throw new Error(`pnpm ${args.join(' ')} failed`);
    }
  }
  return import(pathToFileURL(entry).href);
}

/** Whether a folder holds demo data this script wrote. */
export function isDemo(home) {
  return existsSync(join(home, MARKER));
}

/**
 * Make sure the demo folder holds demo data. Seeds it when it doesn't exist (or is empty), re-seeds
 * it on reset, leaves it alone otherwise. Refuses your real data and any folder it didn't write.
 */
export async function ensureDemo({ home = DEMO_HOME, reset = false, now = new Date(), log = console.log } = {}) {
  home = resolve(home);
  if (realHomes().includes(home)) throw new Error(`${home} is where your real data lives; demo data never goes there.`);
  const exists = existsSync(home);
  const empty = exists && readdirSync(home).length === 0;
  if (exists && !empty && !isDemo(home)) {
    throw new Error(`${home} exists and isn't a Bousleh demo folder (no ${MARKER}); leaving it alone.`);
  }
  if (exists && !empty && !reset) {
    const { seeded } = JSON.parse(readFileSync(join(home, MARKER), 'utf8'));
    log(`Demo data is already in ${home} (seeded ${seeded}). Run pnpm demo --reset for fresh dates.`);
    return { home, seeded: false };
  }
  if (exists && !empty) {
    rmSync(home, { recursive: true, force: true });
    log(`Wiped the old demo data in ${home}.`);
  }
  const { openEngine } = await engineModule();
  const { fillDemo, readFixtures } = await import(pathToFileURL(join(REPO, 'packages/home/preview/demo-data.mjs')).href);
  const engine = openEngine({ home });
  try {
    await fillDemo(engine, now);
    writeFileSync(
      join(home, MARKER),
      `${JSON.stringify({ demo: true, seeded: now.toISOString(), note: 'Fictional demo data from scripts/demo.mjs. Not anyone’s real work.' }, null, 2)}\n`,
      { mode: 0o600 },
    );
    const run = async (name, input = {}) => {
      const out = await engine.runOp(name, input, { actor: 'agent', now: () => now });
      if (out.status !== 'ok') throw new Error(`${name}: ${out.message}`);
      return out.output;
    };
    const f = await readFixtures(run, now);
    const c = f.pulse_today.commitments;
    const lines = [
      `Seeded ${home} with a fictional cast: Alex Rivera, a group PM at Northwind.`,
      `  scopes: ${f.context_strata.columns.map((col) => col.name).join(', ')} (and Platform, a team in Northwind)`,
      `  people: Alex (you), Rowan Vale (your manager), the PMs Sam Ortiz, Priya Nair and Dana Reyes, Mira Chen, Theo Brandt`,
      `  commitments: ${c.overdue.by_me.length + c.overdue.to_me.length} late, ${c.due_today.by_me.length + c.due_today.to_me.length} due today, ${c.snoozed.by_me + c.snoozed.to_me + c.snoozed.other} snoozed, more coming up and undated`,
      `  meetings: ${f.pulse_today.meetings.length} today, one held yesterday, one on Friday`,
      `  Horizon: ${f.watchlists_get.watch_lists.length} watch lists, ${f.pulse_today.new_findings.total} new findings`,
      `  inbox: ${f.pulse_today.inbox.waiting} file waiting; queue: ${f.queue_list.items.length} items`,
    ];
    for (const line of lines) log(line);
    return { home, seeded: true };
  } finally {
    engine.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  let home = DEMO_HOME;
  let reset = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--reset') reset = true;
    else if (args[i] === '--home') {
      home = args[i + 1] ?? '';
      i += 1;
    } else {
      console.error(`unknown option: ${args[i]}\nusage: pnpm demo [--reset] [--home <dir>]`);
      process.exit(2);
    }
  }
  try {
    const out = await ensureDemo({ home, reset });
    if (out.seeded || !reset) {
      console.log('\nNext:');
      console.log('  pnpm demo:home              see Home on this data in your browser (http://localhost:4173)');
      console.log('  scripts/setup-mac.sh --demo  add it to Claude as the bousleh-demo server, then say "Pulse: where am I?"');
    }
  } catch (err) {
    console.error(`demo: ${err.message}`);
    process.exit(1);
  }
}
