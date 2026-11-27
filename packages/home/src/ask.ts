import { clipPrompt } from './launch.js';
import type { Mode } from './types.js';

/*
 * Ask: read-only questions answered in Home with the sample capability. Claude gets only the
 * bousleh READ tools, as page functions, and answers in a strict JSON shape that Home draws as
 * blocks. Never a write tool. Pure pieces here (tested); the call is made in side.ts.
 */

export const SERVER = 'host:bousleh';

interface ReadTool {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[] };
}

const str = (description: string) => ({ type: 'string', description });
const scopes = { type: 'array', items: { type: 'string' }, description: 'Scope slugs, lower case.' };
const altitude = { type: 'integer', enum: [50000, 10000, 1000, 100], description: 'Altitude in feet.' };

/**
 * The read tools Ask may call: each is a bousleh op that writes nothing. Their names match the MCP
 * tools (the op name with underscores). Descriptions are short; the server checks every input.
 */
export const ASK_TOOLS: readonly ReadTool[] = [
  {
    name: 'pulse_today',
    description:
      "Today's picture: focus (the few things to do first, ranked, with reasons and ids), commitments overdue, due today and undated, today's planned meetings, the inbox and queue counts, stale metrics, new findings, open bets, and who is due a touchpoint. me is the user.",
    inputSchema: { type: 'object', properties: { scopes } },
  },
  {
    name: 'commitments_list',
    description:
      'Commitments (things someone owes someone) with ids, due dates, size, who owes and who is owed. Defaults to open ones, soonest due first.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'done', 'dropped', 'any'] },
        scope: str('One scope slug.'),
        owed_by: str('A person id.'),
        owed_to: str('A person id.'),
        due_before: str('YYYY-MM-DD'),
        limit: { type: 'integer', minimum: 1, maximum: 200 },
      },
    },
  },
  {
    name: 'context_brief',
    description:
      'What is known at an altitude: anchors, initiatives, problems, ideas and bets, decisions, metrics, people, open commitments, evidence and docs, centred on a focus (plain words) or ids, narrowed to scopes.',
    inputSchema: {
      type: 'object',
      properties: {
        focus: str('The question or topic in plain words.'),
        ids: { type: 'array', items: { type: 'string' } },
        scopes,
        altitude,
      },
    },
  },
  {
    name: 'context_strata',
    description: 'Every scope at every altitude in one call: the columns (scopes), and per cell the objects there and what needs the user.',
    inputSchema: { type: 'object', properties: { per_cell: { type: 'integer', minimum: 1, maximum: 50 } } },
  },
  {
    name: 'watch_digest',
    description: "Horizon's findings by watch list: titles, urls, summaries, status (new, to_read, dismissed) and when they were filed.",
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'array', items: { type: 'string', enum: ['new', 'to_read', 'dismissed'] } },
        limit: { type: 'integer' },
      },
    },
  },
  {
    name: 'vault_search',
    description: 'Full-text search over everything filed (titles and bodies). Plain words. Returns ids, kinds, titles and a snippet.',
    inputSchema: {
      type: 'object',
      properties: {
        query: str('Plain words.'),
        kinds: { type: 'array', items: { type: 'string' }, description: 'Object kinds, e.g. ["person"] to find a person id by name.' },
        scopes,
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['query'],
    },
  },
  {
    name: 'people_get',
    description: 'One person by id: role, who they report to, open commitments both ways, recent meetings and notes.',
    inputSchema: { type: 'object', properties: { id: str('A person id (per_…).') }, required: ['id'] },
  },
];

export const ASK_TOOL_NAMES: ReadonlySet<string> = new Set(ASK_TOOLS.map((t) => t.name));

/** The modes an answer may hand off to; each opens a new chat. */
export const HANDOFF_MODES: readonly Mode[] = ['Capture', 'Pulse', 'Counsel', 'Shape', 'Workshop', 'Communicate', 'Coach', 'Horizon'];

/** One drawn piece of an answer. */
export type AskBlock =
  | { type: 'p'; text: string; quiet: boolean }
  | { type: 'li'; text: string }
  | { type: 'commitment'; id: string; title: string; why: string }
  | { type: 'finding'; id: string; title: string; source: string }
  | { type: 'handoff'; mode: Mode; prompt: string };

const ID = /^[a-z]{3}_[0-9A-HJKMNP-TV-Z]{26}$/;
const MAX_BLOCKS = 24;

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/**
 * The model's answer as blocks Home can draw. Anything unknown is dropped: an unknown type, a
 * commitment or finding without a well-formed id, a hand-off to an unknown mode or whose prompt
 * doesn't name its mode. At most one hand-off, last. Text is plain: it is escaped where drawn.
 */
export function parseAnswer(value: unknown): AskBlock[] {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'object' && value !== null && Array.isArray((value as { blocks?: unknown }).blocks)
      ? (value as { blocks: unknown[] }).blocks
      : [];
  const out: AskBlock[] = [];
  let handoff: AskBlock | null = null;
  for (const raw of list) {
    if (out.length >= MAX_BLOCKS) break;
    if (typeof raw !== 'object' || raw === null) continue;
    const b = raw as Record<string, unknown>;
    switch (b.type) {
      case 'p': {
        const t = text(b.text, 1200);
        if (t) out.push({ type: 'p', text: t, quiet: b.quiet === true });
        break;
      }
      case 'li': {
        const t = text(b.text, 600);
        if (t) out.push({ type: 'li', text: t });
        break;
      }
      case 'commitment': {
        const id = text(b.id, 40);
        if (ID.test(id) && id.startsWith('cmt_')) out.push({ type: 'commitment', id, title: text(b.title, 200), why: text(b.why, 400) });
        break;
      }
      case 'finding': {
        const id = text(b.id, 40);
        if (ID.test(id) && id.startsWith('fnd_')) out.push({ type: 'finding', id, title: text(b.title, 200), source: text(b.source, 120) });
        break;
      }
      case 'handoff': {
        const mode = HANDOFF_MODES.find((m) => m === b.mode);
        const prompt = typeof b.prompt === 'string' ? clipPrompt(b.prompt) : '';
        if (mode && handoff === null && prompt.toLowerCase().startsWith(`${mode.toLowerCase()}:`) && prompt.length > mode.length + 2) {
          handoff = { type: 'handoff', mode, prompt };
        }
        break;
      }
    }
  }
  if (handoff) out.push(handoff);
  return out;
}

/** What the question is asked against: today, and the scopes Home knows. */
export interface AskContext {
  today: string;
  scopes: { slug: string; name: string }[];
}

/**
 * The one prompt sent: the bundled instructions (ask-prompt.md), today's date and the scopes, then
 * the question. Claude remembers nothing between calls, so it is all here.
 */
export function askInput(instructions: string, question: string, ctx: AskContext): string {
  const scopeLine = ctx.scopes.length ? ctx.scopes.map((s) => `${s.name} (${s.slug})`).join(', ') : 'not read yet';
  return [
    instructions.trim(),
    '',
    `Today is ${ctx.today}. Scopes: ${scopeLine}.`,
    '',
    'The question, typed into Home:',
    '<question>',
    question.trim().slice(0, 2000),
    '</question>',
  ].join('\n');
}

/** The suggestion chips under the Ask box. The queue chip opens Claude (Capture), the rest answer here. */
export function suggestions(firstScope: string | null, queued: number): { label: string; question: string; claude?: boolean }[] {
  const out: { label: string; question: string; claude?: boolean }[] = [
    { label: "What's first today?", question: "What's first today, and what can wait?" },
  ];
  if (firstScope) out.push({ label: `Brief me on ${firstScope} at 10K`, question: `Brief me on ${firstScope} at 10K` });
  out.push({ label: "What's new outside?", question: "What's new outside this week?" });
  if (queued > 0) out.push({ label: `Clear the queue (${queued})`, question: '', claude: true });
  return out;
}

/** The footer's "Read …" line: the tools the answer read, in the order first read. */
export function toolsLine(tools: readonly string[]): string {
  return tools.length ? `Read ${tools.join(', ')} · changed nothing` : 'Read nothing · changed nothing';
}

/** A sample failure in words for the Ask panel. `off` means hide answers in place for this view. */
export function askFailure(code: string): { text: string; off: boolean } {
  switch (code) {
    case 'not_granted':
    case 'sampling_disabled':
    case 'not_declared':
    case 'capability_disabled':
    case 'capability_removed':
    case 'tools_unavailable':
      return { text: 'Answers here are off for this page. Continue in Claude instead.', off: true };
    case 'rate_limited':
      return { text: 'Too many questions just now. Try again in a minute.', off: false };
    case 'session_expired':
      return { text: 'Sign in to Claude again, then ask.', off: false };
    case 'invalid_json':
    case 'empty_completion':
    case 'refused':
      return { text: "Couldn't get a clear answer. Ask it another way, or continue in Claude.", off: false };
    default:
      return { text: 'Something went wrong. Ask again, or continue in Claude.', off: false };
  }
}
