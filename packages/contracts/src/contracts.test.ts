import { describe, expect, it } from 'vitest';
import { COMMITMENT_SIZES, checkKindFields, commitmentSize, OP_NAMES, OPS, opInputJsonSchema, opOutputJsonSchema } from './index.js';

describe('ops registry', () => {
  it('keys every op by its own name', () => {
    for (const name of OP_NAMES) expect(OPS[name].name).toBe(name);
  });

  it('uses dotted lower-case names that stay unique once dots become underscores', () => {
    const underscored = new Set<string>();
    for (const name of OP_NAMES) {
      expect(name).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
      underscored.add(name.replaceAll('.', '_'));
    }
    expect(underscored.size).toBe(OP_NAMES.length);
  });

  it('gives every op a description and object-shaped JSON Schemas', () => {
    for (const name of OP_NAMES) {
      const def = OPS[name];
      expect(def.description.length, name).toBeGreaterThan(20);
      expect(opInputJsonSchema(def).type, name).toBe('object');
      expect(opOutputJsonSchema(def).type, name).toBe('object');
    }
  });
});

describe('commitment size', () => {
  it('accepts major and minor, refuses anything else, and reads a commitment with no size as major', () => {
    for (const size of COMMITMENT_SIZES) {
      expect(checkKindFields('commitment', { attrs: { size } })).toMatchObject({ ok: true, value: { attrs: { size } } });
    }
    const huge = checkKindFields('commitment', { attrs: { size: 'huge' } });
    expect(huge.ok).toBe(false);
    expect(huge.ok ? [] : huge.issues.map((i) => i.path)).toEqual(['attrs.size']);
    expect(checkKindFields('commitment', {})).toMatchObject({ ok: true, value: { attrs: {} } });
    expect(commitmentSize(undefined)).toBe('major');
    expect(commitmentSize(null)).toBe('major');
    expect(commitmentSize('major')).toBe('major');
    expect(commitmentSize('minor')).toBe('minor');
  });
});
