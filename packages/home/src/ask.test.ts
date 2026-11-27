import { OPS } from '@bousleh/contracts';
import { describe, expect, it } from 'vitest';
import { ASK_TOOLS, askFailure, askInput, HANDOFF_MODES, parseAnswer, suggestions, toolsLine } from './ask.js';
import ASK_PROMPT from './ask-prompt.md?raw';

/* Ask: the read tools it may call, the prompt it sends, and reading the answer into blocks. */

const CMT = 'cmt_01JBX000000000000000000F01';
const FND = 'fnd_01JBX000000000000000000F02';

describe('the tools Ask may call', () => {
  it('are bousleh ops that write nothing, and include the ones the brief names', () => {
    const ops = OPS as Record<string, { readOnly?: boolean }>;
    for (const tool of ASK_TOOLS) {
      const op = ops[tool.name.replace('_', '.')];
      expect(op, tool.name).toBeDefined();
      expect(op?.readOnly, `${tool.name} must be read-only`).toBe(true);
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.description.length).toBeLessThan(1024);
    }
    expect(ASK_TOOLS.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        'pulse_today',
        'commitments_list',
        'context_brief',
        'watch_digest',
        'vault_search',
        'people_get',
        'context_strata',
      ]),
    );
  });
});

describe('the prompt', () => {
  it('bundles the instructions: the user is not assumed, altitude words, the rule, the answer format', () => {
    expect(ASK_PROMPT).toMatch(/Do not assume who the user is/);
    expect(ASK_PROMPT).toMatch(/10,000 ft \(10K\) is cross-team/);
    expect(ASK_PROMPT).toMatch(/Hand off to Claude when/);
    expect(ASK_PROMPT).toMatch(/"type": "handoff"/);
    expect(ASK_PROMPT).not.toMatch(/—/);
  });

  it('sends the instructions, today, the scopes and the question', () => {
    const input = askInput('RULES', "  What's first today?  ", {
      today: '2026-11-27',
      scopes: [{ slug: 'harbor', name: 'Harbor' }],
    });
    expect(input).toBe(
      "RULES\n\nToday is 2026-11-27. Scopes: Harbor (harbor).\n\nThe question, typed into Home:\n<question>\nWhat's first today?\n</question>",
    );
  });
});

describe('parseAnswer', () => {
  it('keeps the blocks Home can draw, and drops the rest', () => {
    expect(
      parseAnswer({
        blocks: [
          { type: 'p', text: 'Three things,   in this order.' },
          { type: 'li', text: 'One' },
          { type: 'commitment', id: CMT, title: 'Send Rowan the Q1 plan', why: 'A day late.' },
          { type: 'finding', id: FND, title: 'Lumen Search ships', source: 'Signal Weekly' },
          { type: 'p', text: 'Can wait: the rest.', quiet: true },
          { type: 'script', text: 'alert(1)' },
          { type: 'commitment', id: 'not-an-id', title: 'x' },
          { type: 'commitment', id: FND, title: 'a finding id is not a commitment' },
          { type: 'p', text: '   ' },
          'nonsense',
          null,
        ],
      }),
    ).toEqual([
      { type: 'p', text: 'Three things, in this order.', quiet: false },
      { type: 'li', text: 'One' },
      { type: 'commitment', id: CMT, title: 'Send Rowan the Q1 plan', why: 'A day late.' },
      { type: 'finding', id: FND, title: 'Lumen Search ships', source: 'Signal Weekly' },
      { type: 'p', text: 'Can wait: the rest.', quiet: true },
    ]);
    expect(parseAnswer('not an answer')).toEqual([]);
    expect(parseAnswer([{ type: 'p', text: 'A bare list works too.' }])).toHaveLength(1);
  });

  it('keeps one hand-off, last, only to a known mode whose prompt names it', () => {
    const blocks = parseAnswer({
      blocks: [
        { type: 'handoff', mode: 'Communicate', prompt: 'Communicate: draft the Q1 plan for Rowan at 10,000 ft.' },
        { type: 'p', text: "That's a Communicate job." },
        { type: 'handoff', mode: 'Shape', prompt: 'Shape: a second one is dropped.' },
      ],
    });
    expect(blocks.map((b) => b.type)).toEqual(['p', 'handoff']);
    expect(parseAnswer({ blocks: [{ type: 'handoff', mode: 'Tune', prompt: 'Tune: run it.' }] })).toEqual([]);
    expect(parseAnswer({ blocks: [{ type: 'handoff', mode: 'Shape', prompt: 'Workshop: wrong mode' }] })).toEqual([]);
    expect(parseAnswer({ blocks: [{ type: 'handoff', mode: 'Shape', prompt: 'Shape:' }] })).toEqual([]);
    const long = parseAnswer({ blocks: [{ type: 'handoff', mode: 'Shape', prompt: `Shape: ${'x '.repeat(4000)}` }] })[0];
    expect(long?.type === 'handoff' && long.prompt.length <= 5000).toBe(true);
    expect(HANDOFF_MODES).not.toContain('Tune');
  });
});

describe('around the answer', () => {
  it('suggests what to ask, and the queue chip opens Claude', () => {
    expect(suggestions('Harbor', 2)).toEqual([
      { label: "What's first today?", question: "What's first today, and what can wait?" },
      { label: 'Brief me on Harbor at 10K', question: 'Brief me on Harbor at 10K' },
      { label: "What's new outside?", question: "What's new outside this week?" },
      { label: 'Clear the queue (2)', question: '', claude: true },
    ]);
    expect(suggestions(null, 0).map((s) => s.label)).toEqual(["What's first today?", "What's new outside?"]);
  });

  it('says what it read and that it changed nothing, and words each failure', () => {
    expect(toolsLine(['pulse_today', 'commitments_list'])).toBe('Read pulse_today, commitments_list · changed nothing');
    expect(askFailure('not_granted').off).toBe(true);
    expect(askFailure('rate_limited')).toEqual({ text: 'Too many questions just now. Try again in a minute.', off: false });
    expect(askFailure('something_new').off).toBe(false);
  });
});
