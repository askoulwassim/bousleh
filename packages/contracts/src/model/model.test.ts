import { describe, expect, it } from 'vitest';
import { checkKindFields, checkLink, effectiveStatus, ID_PATTERN, KIND_NAMES, KINDS, kindOfId, LINK_KIND_NAMES } from '../index.js';

describe('kinds', () => {
  it('gives every kind a unique three-letter prefix', () => {
    const prefixes = KIND_NAMES.map((kind) => KINDS[kind].prefix);
    for (const prefix of prefixes) expect(prefix).toMatch(/^[a-z]{3}$/);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it('lets only people go without a scope', () => {
    expect(KIND_NAMES.filter((kind) => !KINDS[kind].scopeRequired)).toEqual(['person']);
  });

  it('applies the default status and refuses unknown attrs', () => {
    expect(checkKindFields('commitment', {})).toEqual({ ok: true, value: { status: 'open', attrs: {} } });
    const result = checkKindFields('problem', { attrs: { colour: 'red' } });
    expect(result.ok).toBe(false);
  });

  it('refuses a status on a kind without statuses, and a status outside the list', () => {
    expect(checkKindFields('decision', { status: 'open' }).ok).toBe(false);
    expect(checkKindFields('strategy', { status: 'done' }).ok).toBe(false);
  });
});

describe('assets', () => {
  it('need a url and one of the asset types', () => {
    expect(KINDS.asset).toMatchObject({ layer: 'work', prefix: 'ast', scopeRequired: true });
    expect(checkKindFields('asset', { attrs: { url: 'https://claude.ai/artifact/abc', type: 'doc' } }).ok).toBe(true);
    expect(checkKindFields('asset', { attrs: { type: 'doc' } }).ok).toBe(false);
    expect(checkKindFields('asset', { attrs: { url: 'not a url', type: 'doc' } }).ok).toBe(false);
    expect(checkKindFields('asset', { attrs: { url: 'https://github.com/a/b', type: 'video' } }).ok).toBe(false);
    expect(checkKindFields('asset', { status: 'open', attrs: { url: 'https://github.com/a/b', type: 'repo' } }).ok).toBe(false);
  });
});

describe('idea statuses (Oct 25)', () => {
  it('are open, running, bet, parked, dropped and concluded, with no won or lost', () => {
    expect(KINDS.idea.statuses).toEqual(['open', 'running', 'bet', 'parked', 'dropped', 'concluded']);
  });

  it('need nothing extra to be running', () => {
    expect(checkKindFields('idea', { status: 'running' }, { status: 'open' })).toMatchObject({ ok: true, value: { status: 'running' } });
    expect(checkKindFields('idea', { status: 'running' }, { status: 'concluded' }).ok).toBe(false);
  });

  it('need a hypothesis and kill criteria for a bet', () => {
    const bare = checkKindFields('idea', { status: 'bet' });
    expect(bare.ok).toBe(false);
    if (!bare.ok) expect(bare.issues.map((issue) => issue.path).sort()).toEqual(['attrs.hypothesis', 'attrs.kill_criteria']);
    expect(checkKindFields('idea', { status: 'bet', attrs: { hypothesis: 'h', kill_criteria: 'k' } }).ok).toBe(true);
  });

  it('never accept concluded directly', () => {
    expect(checkKindFields('idea', { status: 'concluded' }).ok).toBe(false);
    expect(checkKindFields('idea', { status: 'concluded' }, { status: 'bet' }).ok).toBe(false);
  });

  it('keep a concluded idea concluded', () => {
    const attrs = { hypothesis: 'h', kill_criteria: 'k' };
    expect(checkKindFields('idea', { attrs }, { status: 'concluded' })).toMatchObject({ ok: true, value: { status: 'concluded' } });
    expect(checkKindFields('idea', { status: 'concluded', attrs }, { status: 'concluded' }).ok).toBe(true);
    expect(checkKindFields('idea', { status: 'open', attrs }, { status: 'concluded' }).ok).toBe(false);
  });

  it('keep the hypothesis and kill criteria on a concluded idea that had them', () => {
    const had = { status: 'concluded', attrs: { hypothesis: 'h', kill_criteria: 'k' } };
    expect(checkKindFields('idea', { attrs: { hypothesis: 'h' } }, had).ok).toBe(false);
    expect(checkKindFields('idea', { attrs: {} }, had).ok).toBe(false);
    expect(checkKindFields('idea', { attrs: { hypothesis: 'h', kill_criteria: 'k', rank: 2 } }, had).ok).toBe(true);
    // Concluded from running, without either: still fine.
    expect(checkKindFields('idea', { attrs: { rank: 2 } }, { status: 'concluded', attrs: {} }).ok).toBe(true);
  });
});

describe('glossary terms', () => {
  it('are anchors with prefix trm, need a scope, and default to no aliases', () => {
    expect(KINDS.term).toMatchObject({ layer: 'anchors', prefix: 'trm', scopeRequired: true });
    expect(kindOfId('trm_01JBX0000000000000000000000')).toBe('term');
    expect(checkKindFields('term', {})).toEqual({ ok: true, value: { status: null, attrs: { aliases: [] } } });
    expect(checkKindFields('term', { attrs: { aliases: ['LI', 'logistics intel'], definition: 'Tracking where loads move.' } })).toEqual({
      ok: true,
      value: { status: null, attrs: { aliases: ['LI', 'logistics intel'], definition: 'Tracking where loads move.' } },
    });
    expect(checkKindFields('term', { attrs: { aliases: [''] } }).ok).toBe(false);
    expect(checkKindFields('term', { attrs: { definition: '' } }).ok).toBe(false);
    expect(checkKindFields('term', { status: 'open' }).ok).toBe(false);
  });
});

describe('signal tags', () => {
  it('default to none and must be short lower-case slugs, each once', () => {
    expect(checkKindFields('signal', { attrs: { source: 'Rowan' } })).toEqual({
      ok: true,
      value: { status: null, attrs: { source: 'Rowan', tags: [] } },
    });
    expect(checkKindFields('signal', { attrs: { tags: ['export-speed', 'onboarding'], sentiment: 'negative' } }).ok).toBe(true);
    for (const bad of [['Export Speed'], ['export_speed'], ['-export'], ['a'.repeat(41)], ['onboarding', 'onboarding']]) {
      expect(checkKindFields('signal', { attrs: { tags: bad } }).ok, bad.join(',')).toBe(false);
    }
  });
});

describe('idea rank', () => {
  it('is an optional positive integer, 1 the top', () => {
    expect(checkKindFields('idea', { attrs: { rank: 1 } })).toEqual({ ok: true, value: { status: 'open', attrs: { rank: 1 } } });
    for (const rank of [0, -1, 1.5, '1']) expect(checkKindFields('idea', { attrs: { rank } }).ok, String(rank)).toBe(false);
  });
});

describe('initiatives', () => {
  it('have statuses proposed, active, paused, done and dropped, active by default, and dates', () => {
    expect(KINDS.initiative.statuses).toEqual(['proposed', 'active', 'paused', 'done', 'dropped']);
    expect(checkKindFields('initiative', {})).toEqual({ ok: true, value: { status: 'active', attrs: {} } });
    expect(
      checkKindFields('initiative', { status: 'proposed', attrs: { started_at: '2026-11-09', target_date: '2027-03-31' } }),
    ).toMatchObject({ ok: true, value: { status: 'proposed' } });
    expect(checkKindFields('initiative', { status: 'open' }).ok).toBe(false);
    expect(checkKindFields('initiative', { attrs: { target_date: 'next quarter' } }).ok).toBe(false);
    expect(checkKindFields('initiative', { attrs: { owner: 'per_01JBX0000000000000000000000' } }).ok).toBe(false);
  });

  it('read as active when written before they had statuses, and take a status on their next version', () => {
    expect(effectiveStatus('initiative', null)).toBe('active');
    expect(effectiveStatus('initiative', 'paused')).toBe('paused');
    expect(checkKindFields('initiative', {}, { status: null })).toMatchObject({ ok: true, value: { status: 'active' } });
    expect(checkKindFields('initiative', { status: 'done' }, { status: null })).toMatchObject({ ok: true, value: { status: 'done' } });
  });
});

describe('findings', () => {
  it('carry a reading-queue status, new by default', () => {
    expect(KINDS.finding.statuses).toEqual(['new', 'to_read', 'read', 'dismissed']);
    expect(checkKindFields('finding', { attrs: { url: 'https://example.com/a' } })).toMatchObject({ ok: true, value: { status: 'new' } });
    expect(checkKindFields('finding', { status: 'to_read', attrs: { url: 'https://example.com/a' } }).ok).toBe(true);
    expect(checkKindFields('finding', { status: 'archived', attrs: { url: 'https://example.com/a' } }).ok).toBe(false);
    expect(effectiveStatus('finding', null)).toBe('new');
  });
});

describe('meetings', () => {
  it('are planned or held, held by default and when written before they had statuses', () => {
    expect(KINDS.meeting.statuses).toEqual(['planned', 'held']);
    expect(checkKindFields('meeting', { attrs: { held_at: '2026-10-25' } })).toMatchObject({ ok: true, value: { status: 'held' } });
    expect(checkKindFields('meeting', { status: 'planned', attrs: { held_at: '2026-10-28T14:00:00+01:00' } }).ok).toBe(true);
    expect(checkKindFields('meeting', { status: 'cancelled' }).ok).toBe(false);
    expect(effectiveStatus('meeting', null)).toBe('held');
    expect(checkKindFields('meeting', {}, { status: 'planned' })).toMatchObject({ ok: true, value: { status: 'planned' } });
    expect(checkKindFields('meeting', { status: 'held' }, { status: 'planned' })).toMatchObject({ ok: true, value: { status: 'held' } });
  });

  it('leave kinds without statuses reading as null', () => {
    expect(effectiveStatus('decision', null)).toBeNull();
    expect(effectiveStatus('person', null)).toBeNull();
  });
});

describe('problem statuses', () => {
  it('are open, solved and dropped, open by default and when written before they had statuses', () => {
    expect(KINDS.problem.statuses).toEqual(['open', 'solved', 'dropped']);
    expect(checkKindFields('problem', {})).toMatchObject({ ok: true, value: { status: 'open' } });
    expect(effectiveStatus('problem', null)).toBe('open');
    expect(checkKindFields('problem', {}, { status: null })).toMatchObject({ ok: true, value: { status: 'open' } });
    expect(checkKindFields('problem', { status: 'solved' }, { status: null })).toMatchObject({ ok: true, value: { status: 'solved' } });
    expect(checkKindFields('problem', { status: 'fixed' }).ok).toBe(false);
  });
});

describe('watch list entries', () => {
  it('say who added them: user by default, or horizon with an optional reason', () => {
    expect(checkKindFields('watch_list', { attrs: { entries: [{ type: 'competitor', name: 'Lumen Search' }] } })).toEqual({
      ok: true,
      value: { status: null, attrs: { entries: [{ type: 'competitor', name: 'Lumen Search', added_by: 'user' }] } },
    });
    const scanned = { type: 'outlet', name: 'Signal Weekly', added_by: 'horizon', reason: 'broke 2 stories this week' };
    expect(checkKindFields('watch_list', { attrs: { entries: [scanned] } })).toMatchObject({
      ok: true,
      value: { attrs: { entries: [scanned] } },
    });
    expect(checkKindFields('watch_list', { attrs: { entries: [{ type: 'topic', name: 'x', added_by: 'bot' }] } }).ok).toBe(false);
    expect(checkKindFields('watch_list', { attrs: { entries: [{ type: 'topic', name: 'x', reason: '' }] } }).ok).toBe(false);
  });
});

describe('links', () => {
  it('lets reports_to run only from a person to a person', () => {
    expect(checkLink('reports_to', 'person', 'person')).toBeNull();
    expect(checkLink('reports_to', 'person', 'initiative')).not.toBeNull();
    expect(checkLink('reports_to', 'growth_note', 'person')).not.toBeNull();
  });

  it('lets addresses run only from an idea to a problem', () => {
    expect(checkLink('addresses', 'idea', 'problem')).toBeNull();
    expect(checkLink('addresses', 'problem', 'idea')).not.toBeNull();
    expect(checkLink('addresses', 'decision', 'problem')).not.toBeNull();
  });

  it('lets concludes run only from a decision to an idea', () => {
    expect(LINK_KIND_NAMES).toContain('concludes');
    expect(checkLink('concludes', 'decision', 'idea')).toBeNull();
    expect(checkLink('concludes', 'decision', 'problem')).not.toBeNull();
    expect(checkLink('concludes', 'problem', 'idea')).not.toBeNull();
  });

  it('lets documents run only from an asset, to any kind', () => {
    expect(checkLink('documents', 'asset', 'strategy')).toBeNull();
    expect(checkLink('documents', 'asset', 'person')).toBeNull();
    expect(checkLink('documents', 'problem', 'idea')).not.toBeNull();
  });

  it('checks layers, kinds and same-kind rules', () => {
    expect(checkLink('evidence_for', 'signal', 'problem')).toBeNull();
    expect(checkLink('evidence_for', 'problem', 'problem')).not.toBeNull();
    expect(checkLink('supersedes', 'decision', 'decision')).toBeNull();
    expect(checkLink('supersedes', 'decision', 'idea')).not.toBeNull();
    expect(checkLink('related', 'dump', 'person')).toBeNull();
  });
});

describe('ids', () => {
  it('map a prefix back to its kind', () => {
    expect(kindOfId('prb_01JBX0000000000000000000000')).toBe('problem');
    expect(kindOfId('ver_01JBX0000000000000000000000')).toBeUndefined();
    expect(kindOfId('ast_01JBX0000000000000000000000')).toBe('asset');
    expect(ID_PATTERN.test('prb_01JBX0000000000000000000AB')).toBe(true);
    expect(ID_PATTERN.test('prb_01jbx0000000000000000000ab')).toBe(false);
  });
});
