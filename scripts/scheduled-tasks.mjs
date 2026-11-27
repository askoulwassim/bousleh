#!/usr/bin/env node
// The scheduled tasks, as data: reads docs/scheduled-tasks.md (their only definition) and prints
// each task's exact name, where it runs, its cron (local time), its working folder and its prompt,
// as JSON. Claude applies this output literally (docs/scheduled-tasks.md, "How to apply"), so every
// Mac gets the same tasks, created or updated by name, with nothing left to judgment.
//
//   node scripts/scheduled-tasks.mjs [--repo <absolute path>]   the JSON (repo: this clone, by default)
//   node scripts/scheduled-tasks.mjs --list                     one line per task, for people
//
// Exits 1 if the file doesn't parse into complete tasks, so CI catches a broken definition.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const repoArg = args.indexOf('--repo');
const repo = repoArg >= 0 ? args[repoArg + 1] : resolve(here, '..');
if (!repo?.startsWith('/')) fail('--repo needs an absolute path');

const text = readFileSync(resolve(here, '..', 'docs', 'scheduled-tasks.md'), 'utf8');
const sections = text.split(/\n## (?=Task \d+: )/).slice(1);
const tasks = sections.map((section) => {
  const name = /^Task \d+: (.+)\n/.exec(section)?.[1]?.trim();
  const runs = /^- \*\*Runs:\*\* (.+)$/m.exec(section)?.[1] ?? '';
  const cron = /^- \*\*Cron:\*\* `([^`]+)`/m.exec(section)?.[1]?.trim();
  const prompt = /\nPrompt:\n\n```text\n([\s\S]*?)\n```/.exec(section)?.[1];
  const mac = /requires this Mac/.test(runs);
  const cloud = /in the cloud/.test(runs);
  if (!name || !cron || !prompt || mac === cloud) fail(`a task in docs/scheduled-tasks.md is incomplete: ${name ?? section.slice(0, 40)}`);
  if (cron.split(/\s+/).length !== 5) fail(`${name}: the cron needs five fields, local time: ${cron}`);
  return {
    name,
    runs: mac ? 'mac' : 'cloud',
    cron,
    timezone: 'local',
    folder: mac ? repo : null,
    prompt,
  };
});
if (tasks.length === 0) fail('no tasks found in docs/scheduled-tasks.md');
if (new Set(tasks.map((t) => t.name)).size !== tasks.length) fail('two tasks share a name');

if (args.includes('--list')) {
  for (const t of tasks) console.log(`${t.name}: ${t.runs === 'mac' ? 'on this Mac' : 'in the cloud'}, cron "${t.cron}" local time`);
} else {
  console.log(JSON.stringify({ repo, tasks }, null, 2));
}

function fail(message) {
  console.error(`scheduled-tasks: ${message}`);
  process.exit(1);
}
