// Preview fixtures: runs the real engine on a throwaway data home filled with clearly fake data,
// then saves each op's output as JSON, so the preview renders exactly the shapes the page reads live.
// Never touches ~/.bousleh. Output: preview/out/fixtures.json (ignored by git).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openEngine } from '../../engine/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));

export async function seed(now = new Date()) {
  const home = mkdtempSync(join(tmpdir(), 'bousleh-home-preview-'));
  // Everything is filed over the last few days, ending now.
  let t = now.getTime() - 3 * 86_400_000;
  const tick = () => {
    t += 1000;
    return new Date(t);
  };
  const ctx = { actor: 'agent', now: tick };
  const engine = openEngine({ home });
  const run = async (name, input) => {
    const out = await engine.runOp(name, input, ctx);
    if (out.status !== 'ok') throw new Error(`${name}: ${out.code} ${out.message}`);
    return out.output;
  };
  const day = (offset, h = 0, m = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, h, m);
  const iso = (d) => d.toISOString();
  const date = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const put = async (kind, title, altitude, scopes, more = {}) =>
    (await run('deposits.write', { kind, title, altitude, scopes, ...more })).id;

  try {
    for (const [slug, name, kind] of [
      ['lantern', 'Lantern', 'product'],
      ['orchard', 'Orchard', 'product'],
      ['tidepool', 'Tidepool', 'project'],
      ['kestrel', 'Kestrel', 'company'],
      ['quill', 'Quill', 'project'],
    ]) {
      await run('scopes.add', { slug, name, kind });
    }
    const me = await put('person', 'Rowan Vale', 1000, [], { attrs: { role: 'pm', is_user: true } });
    const dana = await put('person', 'Dana Reyes', 10000, [], { attrs: { role: 'stakeholder', org: 'Kestrel' } });
    const milo = await put('person', 'Milo Brandt', 100, [], { attrs: { role: 'engineer' } });

    // 50,000: one strategy per scope, all forming.
    const lanternStrategy = await put('strategy', 'Own the team and enterprise brownfield loop', 50000, ['lantern']);
    await put('strategy', 'A job search run by your own agents', 50000, ['orchard']);
    await put('strategy', 'A self-hosted second brain', 50000, ['tidepool']);
    await put('strategy', 'Make the product you already have better, fast', 50000, ['kestrel']);
    await put('strategy', 'A personal operating system for product leadership', 50000, ['quill']);

    // 10,000
    await put('initiative', 'Agent-first hub', 10000, ['lantern'], { links: [{ kind: 'owned_by', to: dana }] });
    await put('observation', 'Two teams asked for the same export', 10000, ['lantern'], { links: [{ kind: 'about', to: dana }] });
    await put('idea', 'Integrate on top of Lantern', 10000, ['quill']);

    // 1,000: a bet, its experiments, problems and metrics.
    await put('idea', 'The POC lane is the killer feature', 1000, ['lantern'], {
      status: 'bet',
      attrs: {
        hypothesis: 'Teams that see a working POC in a day promote one to a real build.',
        kill_criteria: 'Fewer than 3 of 9 POCs promoted within 30 days.',
      },
    });
    for (let i = 1; i <= 7; i += 1) {
      await put(
        'idea',
        `Experiment ${i}: ${['Seed from the repo', 'One-click staging', 'Feedback in the POC', 'Profile first', 'Weekly digest', 'Shared hub page', 'Promote by issue'][i - 1]}`,
        1000,
        ['lantern'],
        {
          status: i === 1 ? 'running' : 'open',
          attrs: { rank: i },
        },
      );
    }
    const truth = await put('problem', 'Code is truth', 1000, ['lantern'], { body: 'Specs drift from the code within a week.' });
    await put('problem', 'Brownfield onboarding takes days', 1000, ['lantern'], { status: 'solved' });
    for (const title of ['POCs promoted', 'Time to first POC', 'Weekly active teams']) {
      await put('metric', title, 1000, ['lantern'], { links: [{ kind: 'serves', to: lanternStrategy }] });
    }
    await put('metric', 'Captures filed alone', 1000, ['quill'], { attrs: { cadence: 'weekly' } });
    await put('metric', 'Mornings in Pulse', 1000, ['quill'], { attrs: { cadence: 'weekly' } });
    await put('commitment', 'Send the hub plan to Dana', 1000, ['lantern'], {
      attrs: { due: date(day(12)) },
      links: [
        { kind: 'owed_by', to: me },
        { kind: 'owed_to', to: dana },
      ],
    });

    // 100
    const friday = day((5 - now.getDay() + 7) % 7 || 7, 15, 0);
    await put('meeting', 'Lantern Weekly', 100, ['lantern'], {
      status: 'planned',
      attrs: { held_at: iso(friday) },
      links: [{ kind: 'attended_by', to: dana }],
    });
    await put('decision', 'Ship the hub behind a flag', 100, ['lantern'], {
      attrs: { decided_at: date(now) },
      links: [{ kind: 'related', to: truth }],
    });
    await put('decision', 'Name tables in the singular', 100, ['lantern'], {
      attrs: { decided_at: date(now) },
      links: [{ kind: 'about', to: milo }],
    });
    await put('commitment', 'Answer the open seeding questions', 100, ['quill'], { links: [{ kind: 'owed_by', to: me }] });
    await put('commitment', 'Milo sends the schema notes', 100, ['lantern'], {
      links: [
        { kind: 'owed_by', to: milo },
        { kind: 'owed_to', to: me },
      ],
    });

    // Watch lists and findings.
    const lanternList = await run('watchlists.set', {
      scope: 'lantern',
      entries: [
        { type: 'competitor', name: 'Gizmo Build', url: 'https://gizmo.example.com' },
        { type: 'competitor', name: 'Northwind Studio', url: 'https://northwind.example.com' },
        { type: 'competitor', name: 'Contoso Agents' },
        { type: 'competitor', name: 'Fabrikam Dev' },
        { type: 'topic', name: 'Spec-driven development' },
        { type: 'competitor', name: 'Tailspin' },
        { type: 'topic', name: 'Brownfield agents', added_by: 'horizon', reason: 'Came up in three findings' },
      ],
    });
    const kestrelList = await run('watchlists.set', {
      scope: 'kestrel',
      entries: [
        { type: 'outlet', name: 'Kestrel Notes', url: 'https://notes.example.com' },
        { type: 'outlet', name: 'Kestrel Video' },
      ],
    });
    t = day(0, 6, 40).getTime() - 60_000 * 30;
    if (t > now.getTime()) t = now.getTime() - 3_600_000;
    await run('watch.file', {
      watch_list_id: lanternList.id,
      findings: [
        {
          title: 'Gizmo Build ships repo-aware POCs',
          url: 'https://gizmo.example.com/blog/repo-aware',
          published_at: date(day(-2)),
          summary:
            'Gizmo Build now seeds a prototype from an existing repository, the same brownfield loop the POC lane bets on. Teams on the beta report a first build in under an hour.',
        },
        {
          title: 'Northwind Studio raises a Series B for agent workflows',
          url: 'https://northwind.example.com/news/series-b',
          published_at: date(day(-3)),
          summary: 'The round funds team features and an enterprise tier.',
        },
        {
          title: 'Why spec-driven development keeps failing in big codebases',
          url: 'https://essays.example.org/spec-driven',
          published_at: date(day(-5)),
          summary: 'An essay on specs drifting from code, and what tools do about it.',
        },
      ],
    });
    await run('watch.file', {
      watch_list_id: kestrelList.id,
      findings: [
        {
          title: 'Kestrel Notes: shipping faster without a rewrite',
          url: 'https://notes.example.com/p/faster',
          published_at: date(day(-6)),
          summary: 'A post on improving an existing product in small steps.',
        },
      ],
    });
    await run('watchlists.apply', {
      id: kestrelList.id,
      changes: [{ action: 'remove', type: 'outlet', name: 'Kestrel Video', reason: 'Nothing new in a month' }],
    });

    // The ambiguity queue and assets.
    await run('queue.add', { draft: { kind: 'idea', title: 'Maybe a mobile capture app?' }, reason: 'Which scope?' });
    await run('queue.add', { draft: { kind: 'commitment', title: 'Call back about the offsite' }, reason: 'Who is it owed to?' });
    for (const [title, scope, type] of [
      ['Lantern strategy', 'lantern', 'doc'],
      ['POC lane deck', 'lantern', 'slides'],
      ['Hub design', 'lantern', 'design'],
      ['Orchard brief', 'orchard', 'doc'],
      ['Kestrel plan', 'kestrel', 'doc'],
      ['Quill map', 'quill', 'doc'],
    ]) {
      await run('assets.add', {
        url: `https://docs.example.com/${scope}/${title.toLowerCase().replace(/\s+/g, '-')}`,
        title,
        type,
        scopes: [scope],
      });
    }

    t = now.getTime();
    const read = (name, input = {}) => run(name, input);
    return {
      context_strata: await read('context.strata', { per_cell: 10 }),
      pulse_today: await read('pulse.today'),
      watch_digest: await read('watch.digest'),
      watch_digest_to_read: await read('watch.digest', { status: ['to_read'], limit: 1 }),
      watchlists_get: await read('watchlists.get'),
      queue_list: await read('queue.list'),
      commitments_list: await read('commitments.list', { status: 'open', limit: 200 }),
      assets_list: await read('assets.list', { limit: 50 }),
      list_events: {
        events: [
          { summary: 'Focus block', start: { dateTime: iso(day(0, 9, 0)) }, end: { dateTime: iso(day(0, 11, 0)) } },
          { summary: 'Team offsite', start: { date: date(now) }, end: { date: date(day(1)) } },
        ],
      },
    };
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
