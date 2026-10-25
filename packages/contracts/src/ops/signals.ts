import { z } from 'zod';
import { IdSchema, ScopeSlugSchema } from '../model/ids.js';
import { TagSchema } from '../model/kinds.js';
import { PersonRefSchema } from './commitments.js';
import { defineOp } from './define.js';

/*
 * signals.*: owned by @bousleh/intake. Feedback patterns for v0: signals (kind `signal`) counted by
 * their tags, so "we have heard this N times from M people" is a lookup, not a recount.
 */

const isoDateTime = z.iso.datetime({ offset: true });
const dateOrDateTime = z.union([z.iso.date(), isoDateTime]);

/** How many signals in a pattern carry each sentiment; unknown: no sentiment recorded. */
export const SentimentMixSchema = z.object({
  positive: z.number().int().min(0),
  neutral: z.number().int().min(0),
  negative: z.number().int().min(0),
  mixed: z.number().int().min(0),
  unknown: z.number().int().min(0),
});

export const SignalPatternSchema = z.object({
  tag: TagSchema,
  /** Signals with this tag in the window. */
  count: z.number().int().min(1),
  /** Distinct `source` values, as written, most frequent first. */
  sources: z.array(z.string()),
  /** Distinct people the signals are linked to with `about`, most frequent first. */
  people: z.array(PersonRefSchema),
  sentiment: SentimentMixSchema,
  /** When the newest signal with this tag was filed. */
  newest_at: isoDateTime,
  /** Up to 5 of its signals, newest first. */
  examples: z
    .array(
      z.object({
        id: IdSchema,
        title: z.string(),
        source: z.string().nullable(),
        sentiment: z.string().nullable(),
        filed_at: isoDateTime,
      }),
    )
    .max(5),
});
export type SignalPattern = z.output<typeof SignalPatternSchema>;

export const signalsPatterns = defineOp({
  name: 'signals.patterns',
  description: [
    'Feedback patterns: "we have heard this N times from M people". Groups the signals (feedback) filed in a window by their tags; each pattern gives the tag, how many signals carry it, the distinct sources, the distinct people they are about (about links), the sentiment mix, when the newest was filed, and up to 5 example signals.',
    "since and until are dates (whole days on this machine's clock) or date-times; the default window is the last 30 days. scopes (slugs) narrows it, child scopes included. Only tags on at least min_count signals (default 2) are patterns; strongest first (most signals, then most people, then newest). untagged counts the signals in the window with no tag.",
    'Call it before tagging a new signal, to reuse an existing tag rather than invent a near-synonym (min_count 1 lists every tag in use), and before shaping a problem or ranking ideas, to weigh how often it comes up.',
  ].join(' '),
  input: z.object({
    scopes: z.array(ScopeSlugSchema).optional().describe('Only these scopes and their child scopes. Default: every scope.'),
    since: dateOrDateTime.optional().describe('Start of the window. Default: 30 days before until.'),
    until: dateOrDateTime.optional().describe('End of the window (a date includes that whole day). Default: now.'),
    min_count: z.number().int().min(1).default(2),
    limit: z.number().int().min(1).max(100).default(20).describe('Most patterns to return.'),
  }),
  output: z.object({
    since: isoDateTime,
    until: isoDateTime,
    /** The scopes covered, child scopes included. Empty: every scope. */
    scopes: z.array(ScopeSlugSchema),
    /** Signals filed in the window, in scope. */
    signals: z.number().int().min(0),
    /** Of those, how many have no tag. */
    untagged: z.number().int().min(0),
    patterns: z.array(SignalPatternSchema),
    /** Patterns beyond limit. */
    more: z.number().int().min(0),
  }),
  readOnly: true,
});

export const signalOps = {
  'signals.patterns': signalsPatterns,
} as const;
