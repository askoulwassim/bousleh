import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { defineOp, NoInput, OPS, type OpContext, type OpOutcome } from '@bousleh/contracts';
import { DRIVE_INBOX_ENV, intakeHandlers } from '@bousleh/intake';
import { defineHandler } from '@bousleh/vault';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ALL_HANDLERS, type Engine, openEngine } from './engine.js';

/* End to end through runOp: the inbox sweep, list, take and settle, and the ambiguity queue. */

let clock = Date.parse('2026-10-25T09:00:00.000Z');
const tick = () => {
  clock += 1000;
  return new Date(clock);
};
const ctx: OpContext = { actor: 'agent', now: tick };

let home: string;
let drive: string;
let engine: Engine;
let savedEnv: string | undefined;

beforeEach(async () => {
  savedEnv = process.env[DRIVE_INBOX_ENV];
  home = mkdtempSync(join(tmpdir(), 'bousleh-intake-'));
  drive = mkdtempSync(join(tmpdir(), 'bousleh-drive-'));
  process.env[DRIVE_INBOX_ENV] = drive;
  engine = openEngine({ home });
  ok(await engine.runOp('scopes.add', { slug: 'bousleh', name: 'Bousleh', kind: 'project' }, ctx));
});
afterEach(() => {
  engine.close();
  if (savedEnv === undefined) delete process.env[DRIVE_INBOX_ENV];
  else process.env[DRIVE_INBOX_ENV] = savedEnv;
  rmSync(home, { recursive: true, force: true });
  rmSync(drive, { recursive: true, force: true });
});

function ok<T = Record<string, unknown>>(outcome: OpOutcome): T {
  if (outcome.status !== 'ok') throw new Error(`expected ok, got ${outcome.code}: ${outcome.message}`);
  return outcome.output as T;
}
function failed(outcome: OpOutcome): { code: string; message: string } {
  if (outcome.status !== 'error') throw new Error('expected an error');
  return outcome;
}
const run = (name: string, input: unknown = {}) => engine.runOp(name, input, ctx);
const query = <T>(sql: string, ...params: unknown[]): T[] => {
  const db = new Database(join(home, 'vault.db'), { readonly: true });
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
};
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

let arrival = Date.parse('2026-10-20T08:00:00.000Z');
/** Write a file with a distinct, increasing modification time, so arrival order is deterministic. */
function drop(path: string, content: string | Buffer): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  arrival += 60_000;
  utimesSync(path, new Date(arrival), new Date(arrival));
  return path;
}

interface InboxFile {
  sha256: string;
  source: string;
  name: string;
  path: string;
  size: number;
  arrived_at: string;
  text: boolean;
}
interface Sweep {
  drive: { configured: boolean; path: string | null; available: boolean; message: string };
  moved_in: InboxFile[];
  duplicates: { sha256: string; source: string; name: string; moved_to: string }[];
  waiting: InboxFile[];
}

describe('inbox.sweep', () => {
  it('moves Drive files into the local inbox instead of copying them, keeping their arrival time', async () => {
    const dictation = drop(join(drive, 'dictation 1.md'), 'Call Peter about the roadmap.');
    const arrivedAt = statSync(dictation).mtime.toISOString();
    drop(join(home, 'inbox', 'notes.txt'), 'A local note.');
    drop(join(home, 'inbox', 'transcripts', 'standup.txt'), 'Speaker 1: hello');

    const sweep = ok<Sweep>(await run('inbox.sweep'));
    expect(sweep.drive).toMatchObject({ configured: true, available: true });
    expect(sweep.moved_in.map((f) => f.path)).toEqual(['inbox/drive/dictation 1.md']);
    expect(sweep.waiting.map((f) => [f.source, f.name])).toEqual([
      ['drive', 'dictation 1.md'],
      ['local', 'notes.txt'],
      ['transcript', 'standup.txt'],
    ]);

    expect(existsSync(dictation)).toBe(false);
    expect(readdirSync(drive)).toEqual([]);
    const local = join(home, 'inbox', 'drive', 'dictation 1.md');
    expect(readFileSync(local, 'utf8')).toBe('Call Peter about the roadmap.');
    expect(statSync(local).mtime.toISOString()).toBe(arrivedAt);

    const list = ok<{ files: InboxFile[]; duplicates: number }>(await run('inbox.list'));
    expect(list.files).toEqual(sweep.waiting);
    expect(list.files[0]).toMatchObject({ sha256: sha('Call Peter about the roadmap.'), size: 29, arrived_at: arrivedAt, text: true });
  });

  it('reports an unset BOUSLEH_DRIVE_INBOX and sweeps only the local inbox', async () => {
    delete process.env[DRIVE_INBOX_ENV];
    drop(join(drive, 'left alone.md'), 'stays in Drive');
    drop(join(home, 'inbox', 'local.md'), 'local');

    const sweep = ok<Sweep>(await run('inbox.sweep'));
    expect(sweep.drive).toMatchObject({ configured: false, path: null, available: false });
    expect(sweep.drive.message).toMatch(/BOUSLEH_DRIVE_INBOX/);
    expect(sweep.waiting.map((f) => f.name)).toEqual(['local.md']);
    expect(existsSync(join(drive, 'left alone.md'))).toBe(true);
  });

  it('reads BOUSLEH_DRIVE_INBOX at call time and reports a folder that is missing', async () => {
    process.env[DRIVE_INBOX_ENV] = join(drive, 'not-there');
    const sweep = ok<Sweep>(await run('inbox.sweep'));
    expect(sweep.drive).toMatchObject({ configured: true, available: false, path: join(drive, 'not-there') });
    expect(sweep.drive.message).toMatch(/not found/);
  });

  it('takes the Drive folder from the handlers when one is injected', async () => {
    delete process.env[DRIVE_INBOX_ENV];
    const intakeOps = new Set(intakeHandlers().map((handler) => handler.op));
    const other = mkdtempSync(join(tmpdir(), 'bousleh-drive-other-'));
    const injected = openEngine({
      home,
      handlers: [...ALL_HANDLERS.filter((handler) => !intakeOps.has(handler.op)), ...intakeHandlers({ driveInbox: () => other })],
    });
    try {
      drop(join(other, 'finding.md'), 'A Horizon finding.');
      const sweep = ok<Sweep>(await injected.runOp('inbox.sweep', {}, ctx));
      expect(sweep.moved_in.map((f) => f.name)).toEqual(['finding.md']);
      expect(readdirSync(other)).toEqual([]);
    } finally {
      injected.close();
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('skips files whose content was seen before, moving them to processed without a second log row', async () => {
    const first = drop(join(home, 'inbox', 'idea.md'), 'Same words.');
    ok(await run('inbox.settle', { sha256: sha('Same words.'), outcome: 'skipped' }));
    expect(existsSync(first)).toBe(false);

    drop(join(home, 'inbox', 'idea.md'), 'Same words.');
    drop(join(drive, 'idea from phone.md'), 'Same words.');
    drop(join(home, 'inbox', 'twin a.md'), 'Twins.');
    drop(join(home, 'inbox', 'twin b.md'), 'Twins.');

    const before = ok<{ files: InboxFile[]; duplicates: number }>(await run('inbox.list'));
    expect(before.files.map((f) => f.name)).toEqual(['twin a.md']);
    expect(before.duplicates).toBe(2);

    const sweep = ok<Sweep>(await run('inbox.sweep'));
    expect(sweep.moved_in).toEqual([]);
    expect(sweep.waiting.map((f) => f.name)).toEqual(['twin a.md']);
    expect(sweep.duplicates.map((d) => [d.source, d.name])).toEqual([
      ['local', 'idea.md'],
      ['local', 'twin b.md'],
      ['drive', 'idea from phone.md'],
    ]);
    for (const d of sweep.duplicates) {
      expect(d.moved_to).toMatch(/^inbox\/processed\/2026-10\//);
      expect(existsSync(join(home, d.moved_to))).toBe(true);
    }
    // Same name and content as the file settled earlier this month, so it gets the next free name.
    expect(sweep.duplicates[0]?.moved_to).toBe(`inbox/processed/2026-10/${sha('Same words.').slice(0, 12)}-2-idea.md`);
    expect(readdirSync(drive)).toEqual([]);
    expect(query('SELECT sha256 FROM inbox_log')).toHaveLength(1);
    expect(ok<{ files: InboxFile[]; duplicates: number }>(await run('inbox.list'))).toMatchObject({ duplicates: 0 });
  });

  it('moves nothing when the op it runs in fails', async () => {
    const failing = defineOp({
      name: 'test.sweep_then_fail',
      description: 'Sweeps the inbox, then fails, for tests.',
      input: NoInput,
      output: NoInput,
    });
    const failingEngine = openEngine({
      home,
      registry: { ...OPS, 'test.sweep_then_fail': failing },
      handlers: [
        ...ALL_HANDLERS,
        defineHandler(failing, async (_input, h) => {
          const sweep = await h.runOp('inbox.sweep', {}, h.ctx);
          if (sweep.status !== 'ok') throw new Error('sweep failed');
          const settle = await h.runOp('inbox.settle', { sha256: sha('local text'), outcome: 'skipped' }, h.ctx);
          if (settle.status !== 'ok') throw new Error('settle failed');
          throw new Error('something broke after the sweep');
        }),
      ],
    });
    try {
      const inDrive = drop(join(drive, 'phone.md'), 'drive text');
      const inLocal = drop(join(home, 'inbox', 'local.md'), 'local text');
      expect(failed(await failingEngine.runOp('test.sweep_then_fail', {}, ctx)).code).toBe('internal');
      expect(existsSync(inDrive)).toBe(true);
      expect(existsSync(inLocal)).toBe(true);
      expect(existsSync(join(home, 'inbox', 'drive'))).toBe(false);
      expect(existsSync(join(home, 'inbox', 'processed'))).toBe(false);
      expect(query('SELECT sha256 FROM inbox_log')).toEqual([]);
    } finally {
      failingEngine.close();
    }
  });
});

describe('inbox.take and inbox.settle', () => {
  it('returns a text file in full and explains files it cannot read', async () => {
    drop(join(home, 'inbox', 'transcripts', 'sync.md'), '﻿# Weekly sync\n\nWe agreed to ship.');
    drop(join(home, 'inbox', 'scan.pdf'), Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]));
    drop(join(home, 'inbox', 'plan.gdoc'), '{"url":"https://docs.google.com/document/d/x"}');
    const files = ok<{ files: InboxFile[] }>(await run('inbox.list')).files;
    expect(files.map((f) => [f.name, f.text])).toEqual([
      ['sync.md', true],
      ['scan.pdf', false],
      ['plan.gdoc', false],
    ]);

    const text = ok<{ file: InboxFile; content: string; reason: null }>(await run('inbox.take', { sha256: files[0]?.sha256 }));
    expect(text).toMatchObject({
      file: { source: 'transcript', name: 'sync.md' },
      content: '# Weekly sync\n\nWe agreed to ship.',
      reason: null,
    });
    const pdf = ok<{ content: null; reason: string }>(await run('inbox.take', { sha256: files[1]?.sha256 }));
    expect(pdf.content).toBeNull();
    expect(pdf.reason).toMatch(/binary/);
    const gdoc = ok<{ content: null; reason: string }>(await run('inbox.take', { sha256: files[2]?.sha256 }));
    expect(gdoc.reason).toMatch(/Google Docs shortcut/);

    expect(failed(await run('inbox.take', { sha256: sha('nothing') })).code).toBe('not_found');
  });

  it('settles a file: logs the outcome with its main object and moves it to processed/<yyyy-mm>/', async () => {
    const path = drop(join(home, 'inbox', 'feedback.md'), 'Exports are slow.');
    const hash = sha('Exports are slow.');
    expect(failed(await run('inbox.settle', { sha256: hash, outcome: 'filed' })).code).toBe('invalid_input');
    expect(failed(await run('inbox.settle', { sha256: hash, outcome: 'filed', object_id: 'sig_01JBX000000000000000000000' })).code).toBe(
      'not_found',
    );
    expect(existsSync(path)).toBe(true);

    const { id } = ok<{ id: string }>(
      await run('deposits.write', { kind: 'signal', title: 'Exports are slow', altitude: 100, scopes: ['bousleh'] }),
    );
    const settled = ok(await run('inbox.settle', { sha256: hash, outcome: 'filed', object_id: id }));
    const processed = `inbox/processed/2026-10/${hash.slice(0, 12)}-feedback.md`;
    expect(settled).toEqual({
      sha256: hash,
      source: 'local',
      name: 'feedback.md',
      outcome: 'filed',
      object_id: id,
      processed_path: processed,
    });
    expect(existsSync(path)).toBe(false);
    expect(readFileSync(join(home, processed), 'utf8')).toBe('Exports are slow.');
    expect(query('SELECT sha256, source, original_name, outcome, object_id, processed_path FROM inbox_log')).toEqual([
      { sha256: hash, source: 'local', original_name: 'feedback.md', outcome: 'filed', object_id: id, processed_path: processed },
    ]);
    expect(ok<{ files: InboxFile[] }>(await run('inbox.list')).files).toEqual([]);

    drop(join(home, 'inbox', 'feedback copy.md'), 'Exports are slow.');
    expect(failed(await run('inbox.settle', { sha256: hash, outcome: 'skipped' }))).toMatchObject({ code: 'conflict' });
  });

  it('keeps a failed file retryable: moved to inbox/failed, not logged', async () => {
    const path = drop(join(home, 'inbox', 'voice.gdoc'), '{"url":"https://docs.google.com/x"}');
    const hash = sha('{"url":"https://docs.google.com/x"}');
    const settled = ok(await run('inbox.settle', { sha256: hash, outcome: 'failed' }));
    const failedPath = `inbox/failed/2026-10/${hash.slice(0, 12)}-voice.gdoc`;
    expect(settled).toMatchObject({ outcome: 'failed', processed_path: failedPath });
    expect(existsSync(path)).toBe(false);
    expect(existsSync(join(home, failedPath))).toBe(true);
    expect(query('SELECT sha256 FROM inbox_log')).toEqual([]);

    // Dropped in again, it is waiting again.
    drop(join(home, 'inbox', 'voice.gdoc'), '{"url":"https://docs.google.com/x"}');
    expect(ok<{ files: InboxFile[] }>(await run('inbox.list')).files.map((file) => file.sha256)).toEqual([hash]);
  });
});

interface QueueItem {
  id: string;
  draft: Record<string, unknown>;
  reason: string;
  candidates: { id: string; kind: string; title: string }[];
  source: { sha256: string; source: string; name: string; outcome: string; processed_path: string | null } | null;
}

describe('the ambiguity queue', () => {
  it('queues a draft, settles its source file as queued, and lists it with its candidates', async () => {
    const { id: problem } = ok<{ id: string }>(
      await run('deposits.write', { kind: 'problem', title: 'Reports are rebuilt by hand', altitude: 1000, scopes: ['bousleh'] }),
    );
    const path = drop(join(drive, 'voice.md'), 'Something about reports, maybe the same problem?');
    ok(await run('inbox.sweep'));
    const hash = sha('Something about reports, maybe the same problem?');

    const added = ok<{ id: string; settled_source: boolean }>(
      await run('queue.add', {
        draft: { kind: 'signal', title: 'Reports again', scopes: ['bousleh'], body: 'Something about reports.' },
        reason: 'Not sure of the altitude, and it may duplicate an existing problem.',
        candidates: [problem],
        source_sha256: hash,
      }),
    );
    expect(added.id).toMatch(/^que_/);
    expect(added.settled_source).toBe(true);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(join(home, 'inbox', 'drive', 'voice.md'))).toBe(false);
    expect(query<{ outcome: string }>('SELECT outcome FROM inbox_log WHERE sha256 = ?', hash)).toEqual([{ outcome: 'queued' }]);

    const { items } = ok<{ items: QueueItem[] }>(await run('queue.list'));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: added.id,
      draft: { kind: 'signal', title: 'Reports again', scopes: ['bousleh'] },
      candidates: [{ id: problem, kind: 'problem', title: 'Reports are rebuilt by hand' }],
      source: { sha256: hash, source: 'drive', name: 'voice.md', outcome: 'queued' },
    });
    expect(items[0]?.draft).not.toHaveProperty('altitude');
    expect(items[0]?.draft).not.toHaveProperty('links');

    // A second item from the same, already settled file does not settle it again.
    const again = ok<{ settled_source: boolean }>(
      await run('queue.add', { draft: { title: 'Another thought' }, reason: 'No kind yet.', source_sha256: hash }),
    );
    expect(again.settled_source).toBe(false);
  });

  it('refuses unknown candidates and source files', async () => {
    expect(failed(await run('queue.add', { draft: {}, reason: 'r', candidates: ['prb_01JBX000000000000000000000'] })).code).toBe(
      'not_found',
    );
    expect(failed(await run('queue.add', { draft: {}, reason: 'r', source_sha256: sha('never seen') })).code).toBe('not_found');
    expect(query('SELECT id FROM deposit_queue')).toEqual([]);
  });

  it('files a queued item as an object, with overrides on top of the draft', async () => {
    const { id } = ok<{ id: string }>(
      await run('queue.add', {
        draft: { kind: 'signal', title: 'Exports are slow', scopes: ['bousleh'], body: 'From a call.' },
        reason: 'Altitude unknown.',
      }),
    );

    // Filing without the missing altitude fails, writes nothing, and leaves the item open.
    expect(failed(await run('queue.resolve', { id, action: 'file' })).code).toBe('invalid_input');
    expect(query('SELECT id FROM objects')).toEqual([]);
    expect(ok<{ items: QueueItem[] }>(await run('queue.list')).items).toHaveLength(1);

    const resolved = ok<{ object: { id: string; kind: string } }>(
      await run('queue.resolve', {
        id,
        action: 'file',
        overrides: { altitude: 100, title: 'Quarterly exports are slow' },
        note: 'Team level.',
      }),
    );
    expect(resolved).toMatchObject({ id, action: 'file', object: { kind: 'signal' } });
    const object = ok<{ version: { title: string; altitude: number; body: string }; scopes: string[] }>(
      await run('vault.get', { id: resolved.object.id }),
    );
    expect(object).toMatchObject({
      version: { title: 'Quarterly exports are slow', altitude: 100, body: 'From a call.' },
      scopes: ['bousleh'],
    });

    const rows = query<{ resolution_json: string; object_id: string }>('SELECT resolution_json, object_id FROM deposit_resolutions');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.object_id).toBe(resolved.object.id);
    expect(JSON.parse(rows[0]?.resolution_json ?? '{}')).toEqual({
      action: 'file',
      overrides: { altitude: 100, title: 'Quarterly exports are slow' },
      note: 'Team level.',
    });
    expect(ok<{ items: QueueItem[] }>(await run('queue.list')).items).toEqual([]);
    expect(failed(await run('queue.resolve', { id, action: 'discard' })).code).toBe('conflict');
  });

  it('discards a queued item without writing an object', async () => {
    const { id } = ok<{ id: string }>(await run('queue.add', { draft: { title: 'Half a thought' }, reason: 'Unclear what it is.' }));
    expect(failed(await run('queue.resolve', { id, action: 'discard', overrides: { altitude: 100 } })).code).toBe('invalid_input');
    ok(await run('queue.resolve', { id, action: 'discard', note: 'Noise.' }));
    expect(query('SELECT id FROM objects')).toEqual([]);
    expect(query('SELECT queue_id, object_id, resolution_json FROM deposit_resolutions')).toEqual([
      { queue_id: id, object_id: null, resolution_json: JSON.stringify({ action: 'discard', note: 'Noise.' }) },
    ]);
    expect(ok<{ items: QueueItem[] }>(await run('queue.list')).items).toEqual([]);
    expect(failed(await run('queue.resolve', { id: 'que_01JBX000000000000000000000', action: 'discard' })).code).toBe('not_found');
  });
});
