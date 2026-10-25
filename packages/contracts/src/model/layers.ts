import { z } from 'zod';

/** The five layers every object lives in (docs/design/data-schema.md, section 3). */
export const LAYERS = ['anchors', 'evidence', 'work', 'people', 'moments'] as const;
export type Layer = (typeof LAYERS)[number];
export const LayerSchema = z.enum(LAYERS);

/**
 * Altitude, stored as feet. Four values only, also enforced by a CHECK constraint:
 * 50000 company, 10000 cross-team, 1000 own surfaces, 100 one engineer or requirement.
 */
export const ALTITUDES = [50000, 10000, 1000, 100] as const;
export type Altitude = (typeof ALTITUDES)[number];
export const AltitudeSchema = z
  .union([z.literal(50000), z.literal(10000), z.literal(1000), z.literal(100)])
  .describe('Altitude in feet: 50000 company, 10000 cross-team, 1000 own surfaces, 100 one engineer or requirement.');

export const ALTITUDE_LABELS: Readonly<Record<Altitude, string>> = {
  50000: 'company',
  10000: 'cross-team',
  1000: 'own surfaces',
  100: 'one engineer or requirement',
};
