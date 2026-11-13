import { commitmentsClose, commitmentsList, commitmentsSnooze, peopleGet, peopleList } from '@bousleh/contracts';
import { localDay } from './days.js';
import { defineHandler, OpError } from './handler.js';
import { listCommitments } from './store/commitments.js';
import { listPeople, personProfile } from './store/people.js';

/* Handlers for commitments.list, commitments.close, commitments.snooze, people.get and people.list. */

export const commitmentsListHandler = defineHandler(commitmentsList, (input, h) => ({
  commitments: listCommitments(h.store, { ...input, as_of: input.as_of ?? localDay(h.ctx.now()) }),
}));

export const commitmentsCloseHandler = defineHandler(commitmentsClose, (input, h) => {
  const object = h.store.getObject(input.id);
  if (!object) throw new OpError('not_found', `no commitment with id ${input.id}`);
  if (object.kind !== 'commitment') throw new OpError('invalid_input', `${input.id} is a ${object.kind}, not a commitment`);
  if (object.version.status !== 'open') {
    throw new OpError('conflict', `this commitment is already ${object.version.status}`);
  }

  let body: string | undefined;
  if (input.note !== undefined) {
    const day = h.ctx.now().toISOString().slice(0, 10);
    const line = `**${input.status === 'done' ? 'Done' : 'Dropped'} on ${day}:** ${input.note}`;
    const previous = object.version.body.trimEnd();
    body = previous === '' ? line : `${previous}\n\n${line}`;
  }
  const written = h.store.supersede(input.id, { status: input.status, body });
  return { ...written, status: input.status };
});

export const commitmentsSnoozeHandler = defineHandler(commitmentsSnooze, (input, h) => {
  const object = h.store.getObject(input.id);
  if (!object) throw new OpError('not_found', `no commitment with id ${input.id}`);
  if (object.kind !== 'commitment') throw new OpError('invalid_input', `${input.id} is a ${object.kind}, not a commitment`);
  if (object.version.status !== 'open') {
    throw new OpError('conflict', `this commitment is already ${object.version.status}; only an open one can be snoozed`);
  }
  const today = localDay(h.ctx.now());
  const current = typeof object.version.attrs.surface_on === 'string' ? object.version.attrs.surface_on : null;
  if (input.until !== null && input.until < today) {
    throw new OpError(
      'invalid_input',
      `until ${input.until} is before today (${today}): pick today or later, or until: null to wake it now`,
    );
  }
  if (input.until === null && current === null) throw new OpError('conflict', 'this commitment is not snoozed');
  if (input.until !== null && input.until === current) throw new OpError('conflict', `this commitment is already snoozed until ${current}`);

  let body: string | undefined;
  if (input.note !== undefined) {
    const line =
      input.until === null ? `**Woken on ${today}:** ${input.note}` : `**Snoozed on ${today} until ${input.until}:** ${input.note}`;
    const previous = object.version.body.trimEnd();
    body = previous === '' ? line : `${previous}\n\n${line}`;
  }
  const written = h.store.supersede(input.id, { attrs: { surface_on: input.until }, body });
  return { ...written, surface_on: input.until };
});

export const peopleGetHandler = defineHandler(peopleGet, (input, h) => personProfile(h.store, input.id, input.recent));

export const peopleListHandler = defineHandler(peopleList, (input, h) =>
  listPeople(h.store, {
    roles: input.role === undefined ? undefined : Array.isArray(input.role) ? input.role : [input.role],
    scopes: input.scopes,
    org: input.org,
    limit: input.limit,
    now: h.ctx.now(),
  }),
);
