import { describe, expect, it } from 'vitest';
import { checkKindFields, checkLink, ID_PATTERN, KIND_NAMES, KINDS, kindOfId, LINK_KIND_NAMES } from '../index.js';

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
    expect(checkKindFields('problem', { status: 'open' }).ok).toBe(false);
    expect(checkKindFields('strategy', { status: 'done' }).ok).toBe(false);
  });
});

describe('idea statuses (Oct 25)', () => {
  it('are open, bet, parked, dropped and concluded, with no won or lost', () => {
    expect(KINDS.idea.statuses).toEqual(['open', 'bet', 'parked', 'dropped', 'concluded']);
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
    expect(checkKindFields('idea', {}, { status: 'concluded' })).toMatchObject({ ok: true, value: { status: 'concluded' } });
    expect(checkKindFields('idea', { status: 'concluded' }, { status: 'concluded' }).ok).toBe(true);
    expect(checkKindFields('idea', { status: 'open' }, { status: 'concluded' }).ok).toBe(false);
  });
});

describe('links', () => {
  it('lets concludes run only from a decision to an idea', () => {
    expect(LINK_KIND_NAMES).toContain('concludes');
    expect(checkLink('concludes', 'decision', 'idea')).toBeNull();
    expect(checkLink('concludes', 'decision', 'problem')).not.toBeNull();
    expect(checkLink('concludes', 'problem', 'idea')).not.toBeNull();
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
    expect(ID_PATTERN.test('prb_01JBX0000000000000000000AB')).toBe(true);
    expect(ID_PATTERN.test('prb_01jbx0000000000000000000ab')).toBe(false);
  });
});
