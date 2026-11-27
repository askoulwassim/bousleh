// The demo data: a fictional cast (Alex Rivera, a group PM at Northwind, and the people and scopes
// around them), written through the real engine's ops. Used by preview/seed.mjs (a throwaway home for
// the preview and the screenshots) and by scripts/demo.mjs (~/.bousleh-demo, for trying Bousleh in
// Claude). No real people, companies or addresses: every email and url is at a .example domain.
//
// Dates are relative to `now`, so the data always has something late, due today, coming up and snoozed.

/** Every op a read of Home makes, as fixtures keyed by MCP tool name (the shapes the page reads live). */
export async function readFixtures(run, now = new Date()) {
  const day = (offset, h = 0, m = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, h, m);
  return {
    context_strata: await run('context.strata', { per_cell: 10 }),
    pulse_today: await run('pulse.today'),
    watch_digest: await run('watch.digest'),
    watch_digest_to_read: await run('watch.digest', { status: ['to_read'], limit: 1 }),
    watchlists_get: await run('watchlists.get'),
    queue_list: await run('queue.list'),
    commitments_list: await run('commitments.list', { status: 'open', limit: 200 }),
    assets_list: await run('assets.list', { limit: 50 }),
    // The calendar is Claude's Google Calendar connector, not the engine: two stand-in events.
    list_events: {
      events: [
        { summary: 'Focus block', start: { dateTime: day(0, 9, 0).toISOString() }, end: { dateTime: day(0, 11, 0).toISOString() } },
        {
          summary: 'Northwind all-hands',
          start: { dateTime: day(0, 16, 0).toISOString() },
          end: { dateTime: day(0, 17, 0).toISOString() },
        },
      ],
    },
  };
}

/**
 * Write the demo cast into an open engine. `engine` is from openEngine(); writes are stamped over
 * the three days before `now`. Returns a counted summary of what was written.
 */
export async function fillDemo(engine, now = new Date()) {
  let t = now.getTime() - 3 * 86_400_000;
  const tick = () => {
    t += 1000;
    return new Date(t);
  };
  const ctx = { actor: 'agent', now: tick };
  const counts = {};
  const run = async (name, input) => {
    const out = await engine.runOp(name, input, ctx);
    if (out.status !== 'ok') throw new Error(`${name}: ${out.code} ${out.message}`);
    counts[name] = (counts[name] ?? 0) + 1;
    return out.output;
  };
  const day = (offset, h = 0, m = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, h, m);
  const iso = (d) => d.toISOString();
  const date = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const put = async (kind, title, altitude, scopes, more = {}) =>
    (await run('deposits.write', { kind, title, altitude, scopes, ...more })).id;

  // ------------------------------------------------------------ scopes
  // Northwind is the company; Harbor and Atlas are its products, Platform a team inside it.
  // Hiring and Bousleh are Alex's own projects. Top-level scopes are Home's columns.
  for (const [slug, name, kind, parent] of [
    ['northwind', 'Northwind', 'company'],
    ['harbor', 'Harbor', 'product'],
    ['atlas', 'Atlas', 'product'],
    ['hiring', 'Hiring', 'project'],
    ['bousleh', 'Bousleh', 'project'],
    ['platform', 'Platform', 'team', 'northwind'],
  ]) {
    await run('scopes.add', { slug, name, kind, ...(parent ? { parent } : {}) });
  }

  // ------------------------------------------------------------ people
  const rowan = await put('person', 'Rowan Vale', 50000, [], {
    attrs: { role: 'stakeholder', org: 'Northwind', emails: ['rowan@northwind.example'] },
    body: 'VP of Product. Cares about the mid-market number and short decks.',
  });
  const me = await put('person', 'Alex Rivera', 10000, [], {
    attrs: { role: 'pm', org: 'Northwind', emails: ['alex@northwind.example', 'alex@example.com'], is_user: true },
    body: 'Group PM for Harbor and Atlas.',
    links: [{ kind: 'reports_to', to: rowan }],
  });
  const pm = (title, email) =>
    put('person', title, 1000, [], {
      attrs: { role: 'pm', org: 'Northwind', emails: [email] },
      links: [{ kind: 'reports_to', to: me }],
    });
  const sam = await pm('Sam Ortiz', 'sam@northwind.example');
  const priya = await pm('Priya Nair', 'priya@northwind.example');
  const dana = await pm('Dana Reyes', 'dana@northwind.example');
  const mira = await put('person', 'Mira Chen', 10000, [], {
    attrs: { role: 'stakeholder', org: 'Northwind', emails: ['mira@northwind.example'] },
    body: 'Design lead. Wants research before any new surface.',
  });
  const theo = await put('person', 'Theo Brandt', 100, [], {
    attrs: { role: 'engineer', org: 'Northwind', emails: ['theo@northwind.example'] },
  });

  // ------------------------------------------------------------ 50,000: one strategy per scope
  await put('strategy', 'Win mid-market teams with one workspace', 50000, ['northwind'], { status: 'aligned' });
  const harborStrategy = await put('strategy', 'Make the first deploy take a day, not a month', 50000, ['harbor'], { status: 'contested' });
  await put('strategy', 'Answers, not dashboards', 50000, ['atlas']);
  await put('strategy', 'Two senior PMs hired by March', 50000, ['hiring']);
  await put('strategy', 'A personal operating system for product leadership', 50000, ['bousleh']);
  await put('term', 'TTFD', 50000, ['northwind'], {
    attrs: { aliases: ['time to first deploy'], definition: 'Days from sign-up to a team’s first production deploy.' },
  });

  // ------------------------------------------------------------ 10,000
  await put('initiative', 'Template gallery', 10000, ['harbor'], { status: 'active', links: [{ kind: 'owned_by', to: sam }] });
  await put('initiative', 'Shared billing service', 10000, ['platform'], { status: 'proposed', links: [{ kind: 'owned_by', to: theo }] });
  await put('observation', 'Two teams asked for the same CSV export', 10000, ['atlas'], { links: [{ kind: 'about', to: dana }] });
  await put('idea', 'Show Atlas answers inside Harbor', 10000, ['atlas']);
  await put('signal', 'Setup took our team a week', 10000, ['harbor'], {
    attrs: { source: 'customer call', sentiment: 'negative', tags: ['onboarding'] },
  });
  await put('signal', 'We still copy numbers into slides by hand', 10000, ['atlas'], {
    attrs: { source: 'customer call', sentiment: 'negative', tags: ['export'] },
  });

  // ------------------------------------------------------------ 1,000: a bet, its experiments, problems and metrics
  await put('idea', 'Templates are the fastest path to a first deploy', 1000, ['harbor'], {
    status: 'bet',
    attrs: {
      hypothesis: 'Teams that start from a template deploy within a day.',
      kill_criteria: 'Fewer than 3 of 9 pilot teams deploy in a day within 30 days.',
    },
  });
  const experiments = [
    'Start from a template',
    'One-click staging',
    'Feedback in the preview',
    'Import from the repo',
    'Weekly digest',
    'Shared team page',
    'Promote by issue',
  ];
  for (const [i, name] of experiments.entries()) {
    await put('idea', `Experiment ${i + 1}: ${name}`, 1000, ['harbor'], { status: i === 0 ? 'running' : 'open', attrs: { rank: i + 1 } });
  }
  const drift = await put('problem', 'Setup docs drift from the product', 1000, ['harbor'], {
    body: 'The setup guide is wrong within a week of each release.',
  });
  await put('problem', 'Onboarding takes days', 1000, ['harbor'], { status: 'solved' });
  await put('problem', 'Nobody trusts the weekly numbers', 1000, ['atlas']);
  const ttfd = await run('metrics.upsert', {
    title: 'Time to first deploy',
    altitude: 1000,
    scopes: ['harbor'],
    status: 'measured',
    cadence: 'weekly',
    unit: 'days',
    serves: harborStrategy,
    owner: sam,
  });
  for (const [ago, value] of [
    [14, 9],
    [7, 6],
  ]) {
    await run('metrics.reading', { metric_id: ttfd.id, value, observed_at: date(day(-ago)), source: 'Harbor dashboard' });
  }
  await run('metrics.upsert', {
    title: 'Teams deployed in a day',
    altitude: 1000,
    scopes: ['harbor'],
    status: 'defined',
    serves: harborStrategy,
  });
  await run('metrics.upsert', {
    title: 'Weekly active teams',
    altitude: 1000,
    scopes: ['atlas'],
    status: 'instrumented',
    cadence: 'weekly',
  });
  await run('metrics.upsert', { title: 'Captures filed alone', altitude: 1000, scopes: ['bousleh'], cadence: 'weekly' });

  // ------------------------------------------------------------ commitments: late, due today, coming up, undated, snoozed
  const owe = (to, more = {}) => ({ ...more, links: [{ kind: 'owed_by', to: me }, ...(to ? [{ kind: 'owed_to', to }] : [])] });
  const owed = (by, more = {}) => ({
    ...more,
    links: [
      { kind: 'owed_by', to: by },
      { kind: 'owed_to', to: me },
    ],
  });
  await put(
    'commitment',
    'Send Rowan the pricing notes',
    1000,
    ['northwind'],
    owe(rowan, { attrs: { due: date(day(-2)), size: 'major' } }),
  );
  await put('commitment', 'Review the Atlas launch brief', 1000, ['atlas'], owe(dana, { attrs: { due: date(now), size: 'major' } }));
  await put(
    'commitment',
    'Ask Priya for the interview loop notes',
    100,
    ['hiring'],
    owe(priya, { attrs: { due: date(now), size: 'minor' } }),
  );
  await put('commitment', 'Send the Q1 plan to Rowan', 10000, ['harbor'], owe(rowan, { attrs: { due: date(day(9)), size: 'major' } }));
  await put('commitment', 'Write the capture rules for the inbox', 1000, ['bousleh'], owe(null, { attrs: { size: 'major' } }));
  await put('commitment', 'Theo sends the schema notes', 100, ['harbor'], owed(theo, { attrs: { due: date(day(-1)), size: 'minor' } }));
  await put(
    'commitment',
    'Theo confirms the staging fix',
    100,
    ['harbor'],
    owed(theo, { attrs: { surface_on: date(now), size: 'minor' } }),
  );
  await put('commitment', 'Chase the offer approval', 1000, ['hiring'], owe(null, { attrs: { surface_on: date(day(6)), size: 'major' } }));

  // ------------------------------------------------------------ 100: meetings, decisions, growth notes
  const review = await put('meeting', 'Atlas launch review', 10000, ['atlas'], {
    attrs: { held_at: iso(day(-1, 11, 0)) },
    body: 'Went through the launch brief. Export is the top ask; dates hold.',
    links: [
      { kind: 'attended_by', to: me },
      { kind: 'attended_by', to: dana },
      { kind: 'attended_by', to: mira },
    ],
  });
  await put('decision', 'Launch Atlas answers behind a flag', 1000, ['atlas'], {
    attrs: { decided_at: date(day(-1)), reversible: true },
    links: [{ kind: 'from_moment', to: review }],
  });
  await put('decision', 'Name tables in the singular', 100, ['harbor'], {
    attrs: { decided_at: date(now) },
    links: [
      { kind: 'about', to: theo },
      { kind: 'related', to: drift },
    ],
  });
  await put('meeting', 'Rowan 1:1', 10000, ['northwind'], {
    status: 'planned',
    attrs: { held_at: iso(day(0, 14, 0)) },
    links: [
      { kind: 'attended_by', to: rowan },
      { kind: 'attended_by', to: me },
    ],
  });
  const friday = day((5 - now.getDay() + 7) % 7 || 7, 15, 0);
  await put('meeting', 'Harbor weekly', 1000, ['harbor'], {
    status: 'planned',
    attrs: { held_at: iso(friday) },
    links: [{ kind: 'attended_by', to: sam }],
  });
  await put('growth_note', 'Sam: lead the template review without me', 1000, ['harbor'], {
    body: 'Told Sam to run the next review end to end. He wants to grow into owning Harbor.',
    links: [{ kind: 'about', to: sam }],
  });

  // ------------------------------------------------------------ watch lists and findings (fictional companies and outlets)
  const harborList = await run('watchlists.set', {
    scope: 'harbor',
    entries: [
      { type: 'competitor', name: 'Gizmo Build', url: 'https://gizmo.example' },
      { type: 'competitor', name: 'Quarry AI', url: 'https://quarry.example' },
      { type: 'topic', name: 'Internal developer platforms' },
      { type: 'podcast', name: 'Product Loop', url: 'https://productloop.example' },
      { type: 'topic', name: 'Template-first onboarding', added_by: 'horizon', reason: 'Came up in three findings' },
    ],
  });
  const atlasList = await run('watchlists.set', {
    scope: 'atlas',
    entries: [
      { type: 'competitor', name: 'Lumen Search', url: 'https://lumen.example' },
      { type: 'topic', name: 'Answer engines' },
    ],
  });
  const northwindList = await run('watchlists.set', {
    scope: 'northwind',
    entries: [
      { type: 'outlet', name: 'Signal Weekly', url: 'https://signalweekly.example' },
      { type: 'outlet', name: 'Mid-market Monthly' },
    ],
  });
  // The scan files them early this morning.
  t = day(0, 6, 40).getTime() - 60_000 * 30;
  if (t > now.getTime()) t = now.getTime() - 3_600_000;
  await run('watch.file', {
    watch_list_id: harborList.id,
    findings: [
      {
        title: 'Gizmo Build ships template-first deploys',
        url: 'https://gizmo.example/blog/templates',
        published_at: date(day(-2)),
        summary:
          'Gizmo Build now starts every new project from a template, the same path the Harbor bet is on. Beta teams report a first deploy in under a day.',
      },
      {
        title: 'Quarry AI raises a Series B for agent workflows',
        url: 'https://quarry.example/news/series-b',
        published_at: date(day(-3)),
        summary: 'The round funds team features and an enterprise tier.',
      },
      {
        title: 'Product Loop: why setup docs always drift',
        url: 'https://productloop.example/episodes/setup-docs',
        published_at: date(day(-5)),
        summary: 'An episode on docs falling behind the product, and what teams do about it.',
      },
    ],
  });
  await run('watch.file', {
    watch_list_id: atlasList.id,
    findings: [
      {
        title: 'Lumen Search adds answer cards to its workspace',
        url: 'https://lumen.example/changelog/answer-cards',
        published_at: date(day(-1)),
        summary: 'Short answers with their sources, pinned to a team page. Close to the Atlas answers launch.',
      },
    ],
  });
  await run('watch.file', {
    watch_list_id: northwindList.id,
    findings: [
      {
        title: 'Signal Weekly: growing in the mid-market without a sales team',
        url: 'https://signalweekly.example/p/mid-market',
        published_at: date(day(-6)),
        summary: 'How three software companies sold to 200-person teams with product-led trials.',
      },
    ],
  });
  // The scan proposes dropping one of the user's own entries: the engine queues it for them.
  await run('watchlists.apply', {
    id: northwindList.id,
    changes: [{ action: 'remove', type: 'outlet', name: 'Mid-market Monthly', reason: 'Nothing new in a month' }],
  });

  // ------------------------------------------------------------ the queue, the inbox and assets
  await run('queue.add', { draft: { kind: 'idea', title: 'Maybe a mobile capture app?' }, reason: 'Which scope?' });
  await run('queue.add', { draft: { kind: 'commitment', title: 'Call back about the offsite' }, reason: 'Who is it owed to?' });
  const stamp = `${date(now)}-0815`;
  await run('inbox.drop', {
    name: `capture-${stamp}-phone.md`,
    content: `---\nbousleh: drop\ncaptured_at: ${iso(day(0, 8, 15))}\n---\n\nPriya says the second interview loop is too long. I owe her a shorter version by Thursday.\n`,
    source: 'local',
  });
  for (const [title, scope, type] of [
    ['Harbor strategy', 'harbor', 'doc'],
    ['Template bet deck', 'harbor', 'slides'],
    ['Harbor onboarding design', 'harbor', 'design'],
    ['Atlas launch brief', 'atlas', 'doc'],
    ['PM interview loop', 'hiring', 'doc'],
    ['Northwind plan', 'northwind', 'doc'],
    ['Bousleh map', 'bousleh', 'doc'],
  ]) {
    await run('assets.add', {
      url: `https://docs.example/${scope}/${title.toLowerCase().replace(/\s+/g, '-')}`,
      title,
      type,
      scopes: [scope],
    });
  }

  t = now.getTime();
  return counts;
}
