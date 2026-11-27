import type { DesktopPermission, PermissionState } from './platform.js';

/*
 * What Home remembers about its app permissions, and what to do with it. The Claude desktop app
 * drops an Allow when a newer published version of Home loads (it reads "prompt" again), and may
 * answer "unavailable" for a moment while it learns the version. Pure, so it can be tested.
 */

export const DECLARED: DesktopPermission[] = ['full-access', 'menu-bar', 'shortcuts'];

export type States = Partial<Record<DesktopPermission, PermissionState>>;

/** Read the remembered grants document: only names Home declares, never anything else. */
export function readGranted(data: unknown): DesktopPermission[] {
  const names = typeof data === 'object' && data !== null ? (data as { names?: unknown }).names : undefined;
  if (!Array.isArray(names)) return [];
  return DECLARED.filter((n) => names.includes(n));
}

/** The remembered grants after reading the states: add what is granted now, drop what was turned off. */
export function nextGranted(states: States, remembered: DesktopPermission[]): DesktopPermission[] {
  return DECLARED.filter((n) => states[n] === 'granted' || (remembered.includes(n) && states[n] !== 'denied'));
}

/** What to ask again at startup, in one dialog: what you allowed before and the app now asks about again. */
export function toReask(states: States, remembered: DesktopPermission[]): DesktopPermission[] {
  return DECLARED.filter((n) => remembered.includes(n) && states[n] === 'prompt');
}

/** Show the footer's Permissions button: something is still to ask or turned off, or full access isn't on. */
export function needsSetup(states: States): boolean {
  return DECLARED.some((n) => states[n] === 'prompt' || states[n] === 'denied') || states['full-access'] !== 'granted';
}

/** Read the states again after these delays while full access reads "unavailable" (the app may still be learning the version). */
export const RECHECK_MS = [1500, 4000, 10000, 30000];
