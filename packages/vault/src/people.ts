import { commitmentsClose, commitmentsList, peopleGet } from '@bousleh/contracts';
import { defineHandler, OpError } from './handler.js';
import { listCommitments } from './store/commitments.js';
import { personProfile } from './store/people.js';

/* Handlers for commitments.list, commitments.close and people.get. */

export const commitmentsListHandler = defineHandler(commitmentsList, (input, h) => ({ commitments: listCommitments(h.store, input) }));

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

export const peopleGetHandler = defineHandler(peopleGet, (input, h) => personProfile(h.store, input.id, input.recent));
