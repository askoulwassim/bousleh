import { describe, expect, it } from 'vitest';
import { needsSetup, nextGranted, readGranted, toReask } from './grants.js';

/* The app permissions Home remembers across versions, and when it asks again. */

describe('grants', () => {
  it('reads only declared names from the remembered document', () => {
    expect(readGranted({ names: ['full-access', 'overlay', 'shortcuts', 3] })).toEqual(['full-access', 'shortcuts']);
    expect(readGranted({ v: 1, view: {} })).toEqual([]);
    expect(readGranted(null)).toEqual([]);
  });

  it('remembers what is granted, keeps it through an update, and forgets what was turned off', () => {
    expect(nextGranted({ 'full-access': 'granted', 'menu-bar': 'prompt', shortcuts: 'prompt' }, [])).toEqual(['full-access']);
    expect(nextGranted({ 'full-access': 'prompt', 'menu-bar': 'prompt', shortcuts: 'prompt' }, ['full-access', 'menu-bar'])).toEqual([
      'full-access',
      'menu-bar',
    ]);
    expect(nextGranted({ 'full-access': 'denied', 'menu-bar': 'granted' }, ['full-access'])).toEqual(['menu-bar']);
  });

  it('asks again only for what you allowed before and the app asks about again', () => {
    const states = { 'full-access': 'prompt', 'menu-bar': 'prompt', shortcuts: 'granted' } as const;
    expect(toReask(states, ['full-access', 'shortcuts'])).toEqual(['full-access']);
    expect(toReask(states, [])).toEqual([]);
    expect(toReask({ 'full-access': 'unavailable' }, ['full-access'])).toEqual([]);
  });

  it('shows the Permissions button whenever full access is not on', () => {
    expect(needsSetup({ 'full-access': 'granted', 'menu-bar': 'granted', shortcuts: 'granted' })).toBe(false);
    expect(needsSetup({ 'full-access': 'unavailable', 'menu-bar': 'granted', shortcuts: 'granted' })).toBe(true);
    expect(needsSetup({ 'full-access': 'granted', 'menu-bar': 'denied', shortcuts: 'granted' })).toBe(true);
  });
});
