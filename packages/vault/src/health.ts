import { BOUSLEH_VERSION, vaultHealth } from '@bousleh/contracts';
import { defineHandler } from './handler.js';
import { dataStatus } from './home.js';

export const vaultHealthHandler = defineHandler(vaultHealth, (_input, h) => ({
  ok: true,
  version: BOUSLEH_VERSION,
  home: h.home,
  data: dataStatus(h.home),
  ops: h.ops.length,
  now: h.ctx.now().toISOString(),
}));
