import { type LinkKind, metricsUpsert, type ObjectView, type OpInput, type OpOutput } from '@bousleh/contracts';
import { defineHandler, type HandlerContext, OpError } from '@bousleh/vault';
import type { z } from 'zod';
import { call } from './call.js';

/* metrics.upsert: create a metric through deposits.write, or change one through vault.supersede. */

type Input = z.output<typeof metricsUpsert.input>;
type Output = OpOutput<'metrics.upsert'>;

export const metricsUpsertHandler = defineHandler(metricsUpsert, (input, h) =>
  input.id === undefined ? create(input, h) : update(input.id, input, h),
);

async function create(input: Input, h: HandlerContext): Promise<Output> {
  if (input.title === undefined || input.altitude === undefined) {
    throw new OpError('invalid_input', 'a new metric needs a title and an altitude (to update a metric, pass its id)');
  }
  const attrs: Record<string, unknown> = {};
  if (input.cadence != null) attrs.cadence = input.cadence;
  if (input.unit != null) attrs.unit = input.unit;
  const links: { kind: LinkKind; to: string }[] = [];
  if (input.owner !== undefined) links.push({ kind: 'owned_by', to: input.owner });
  if (input.serves !== undefined) links.push({ kind: 'serves', to: input.serves });

  const deposit: OpInput<'deposits.write'> = {
    kind: 'metric',
    title: input.title,
    altitude: input.altitude,
    scopes: input.scopes ?? [],
    attrs,
    body: input.body ?? '',
    links,
  };
  if (input.status !== undefined) deposit.status = input.status;
  const written = await call(h, 'deposits.write', deposit);
  return { ...written, created: true, new_version: true };
}

async function update(id: string, input: Input, h: HandlerContext): Promise<Output> {
  const current = await call(h, 'vault.get', { id });
  if (current.kind !== 'metric') throw new OpError('invalid_input', `${id} is a ${current.kind}, not a metric`);

  if (input.scopes !== undefined && !sameSet(input.scopes, current.scopes)) {
    throw new OpError(
      'invalid_input',
      `metrics.upsert can't move a metric between scopes yet; this metric is in ${current.scopes.join(', ')}. Leave scopes out to keep them.`,
    );
  }
  // Check both links before writing anything, so a refused owner leaves no new version behind.
  const owner = pendingLink(current, 'owned_by', input.owner, 'owner');
  const serves = pendingLink(current, 'serves', input.serves, 'strategy it serves');

  const patch: OpInput<'vault.supersede'> = { id };
  const version = current.version;
  if (input.title !== undefined && input.title !== version.title) patch.title = input.title;
  if (input.altitude !== undefined && input.altitude !== version.altitude) patch.altitude = input.altitude;
  if (input.status !== undefined && input.status !== version.status) patch.status = input.status;
  if (input.body !== undefined && input.body !== version.body) patch.body = input.body;
  const attrs: Record<string, unknown> = {};
  for (const key of ['cadence', 'unit'] as const) {
    const asked = input[key];
    if (asked === undefined) continue;
    if (asked === null ? version.attrs[key] !== undefined : asked !== version.attrs[key]) attrs[key] = asked;
  }
  if (Object.keys(attrs).length > 0) patch.attrs = attrs;

  let written: { version: { id: string; n: number }; path: string } = { version: { id: version.id, n: version.n }, path: current.path };
  const changes = Object.keys(patch).length > 1;
  if (changes) written = await call(h, 'vault.supersede', patch);

  // There is no vault.link op yet, so links to an existing object go through the store's own method,
  // which applies the same link rules as deposits.write.
  if (owner) h.store.addLink(id, 'owned_by', owner);
  if (serves) h.store.addLink(id, 'serves', serves);

  return {
    id,
    kind: current.kind,
    layer: current.layer,
    version: written.version,
    path: written.path,
    created: false,
    new_version: changes,
  };
}

/** The target to link, or undefined when the link is already there or wasn't asked for. Refuses to add a second one. */
function pendingLink(current: ObjectView, kind: LinkKind, to: string | undefined, what: string): string | undefined {
  if (to === undefined) return undefined;
  const existing = current.links.out.filter((link) => link.kind === kind);
  if (existing.some((link) => link.to === to)) return undefined;
  const other = existing[0];
  if (other) {
    throw new OpError(
      'conflict',
      `this metric's ${what} is already ${other.to_title} (${other.to}); replacing it needs a link retraction, which isn't available yet`,
    );
  }
  return to;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((item) => right.has(item));
}
