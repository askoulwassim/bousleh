import type { OpInput, OpName, OpOutput } from '@bousleh/contracts';
import { type HandlerContext, OpError } from './handler.js';

/**
 * Run another op inside this one (same transaction) and return its output, or rethrow its error
 * so this op fails with the same code and message.
 */
export async function call<N extends OpName>(h: HandlerContext, name: N, input: OpInput<N>): Promise<OpOutput<N>> {
  const outcome = await h.runOp(name, input, h.ctx);
  if (outcome.status === 'ok') return outcome.output as OpOutput<N>;
  if (outcome.code === 'not_found' || outcome.code === 'conflict' || outcome.code === 'invalid_input') {
    throw new OpError(outcome.code, outcome.message, outcome.issues);
  }
  throw new Error(`${name} failed (${outcome.code}): ${outcome.message}`);
}
