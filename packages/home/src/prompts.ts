import { feet } from './format.js';

/*
 * Every launcher hands Claude one ready prompt, built from the data in view. Each names its mode
 * so the right Bousleh skill picks it up. Plain words, no em dashes.
 */

const quote = (title: string) => `"${title}"`;

export const prompts = {
  shapeStrategy: (scope: string, title: string, status: string) =>
    `Shape: let's work on the ${scope} strategy, ${quote(title)}. It is ${status}. Push back with the evidence.`,
  shapeFirstStrategy: (scope: string) => `Shape: let's write the first strategy for ${scope}.`,
  shapeBet: (title: string, scope: string) => `Shape: pressure-test the bet ${quote(title)} on ${scope}. Is it still worth the clock?`,
  shapeFinding: (title: string, scope: string, url: string) =>
    `Shape: does this Horizon finding change anything for ${scope}? ${quote(title)} ${url}`.trim(),
  shapeGap: (scope: string, altitude: number) =>
    `Shape: nothing is filed for ${scope} at ${feet(altitude)} ft. What should be there, if anything?`,
  horizonScan: () => "Horizon: what's new outside this week? Walk me through the digest and flag what's worth acting on.",
  horizonReading: () => "Horizon: what's on my reading list?",
  horizonWatch: (scope: string) => `Horizon: let's set up a watch list for ${scope}.`,
  communicateBrief: (name: string) => `Communicate: brief ${name} on where things stand, at 10,000 ft.`,
  communicateUpdate: () => 'Communicate: write a short update for leadership on where things stand, at 10,000 ft.',
  workshop: (title: string) => `Workshop: let's workshop ${quote(title)}. Given all this, what could we do?`,
  workshopOpen: () => 'Workshop: given all this, what could we do?',
  pulse: () => 'Pulse: where am I?',
  pulseNeeds: (n: number) => `Pulse: what do I owe? Help me close or date the ${n === 1 ? 'one thing' : `${n} things`} that need me.`,
  pulseClose: (title: string) => `Pulse: help me close ${quote(title)}, or give it a date.`,
  pulseFocus: (title: string) => `Pulse: ${quote(title)} is first today. Help me get it done, give it a new date, or snooze it.`,
  pulseFollowUp: (title: string, who: string) =>
    `Pulse: time to follow up on ${quote(title)}${who ? ` with ${who}` : ''}. Help me nudge, close it, or snooze it again.`,
  coach: (name: string) => `Coach: how is ${name} doing? Prep the next nudge.`,
  counselMeeting: (title: string, when: string) => `Counsel: prep me for ${quote(title)}${when ? ` (${when})` : ''}.`,
  counselTalk: () => 'Counsel: I have a hard conversation coming up. Help me prep.',
  capture: () => 'Capture this: ',
  captureQueue: (n: number) => `Capture: let's clear the queue. Walk me through the ${n} open ${n === 1 ? 'item' : 'items'} one at a time.`,
  captureInbox: () => 'Capture: process my Bousleh inbox.',
  brief: (scope: string, altitude: number) => `Brief me on ${scope} at ${feet(altitude)} ft: what's there and what's moving?`,
  briefBand: (altitude: number) => `Brief me at ${feet(altitude)} ft across every scope.`,
  drop: () => 'Drop this: ',
  ask: () => 'Bousleh: ',
  publishHome: () => 'Publish Home from docs/home.md.',
} as const;

/** Questions Home answers itself, in Ask. Each launcher that asks one keeps a mode prompt to copy where Ask can't answer. */
export const questions = {
  first: () => "What's first today, and what can wait?",
  where: () => 'Where am I?',
  brief: (scope: string, altitude: number) => `Brief me on ${scope} at ${SHORT[altitude] ?? feet(altitude)}`,
  band: (altitude: number) => `Brief me at ${SHORT[altitude] ?? feet(altitude)} across every scope`,
  meeting: (title: string) => `Brief me for ${quote(title)}`,
  outside: () => "What's new outside this week?",
  reading: () => "What's on my reading list?",
} as const;

const SHORT: Record<number, string> = { 50000: '50K', 10000: '10K', 1000: '1K', 100: '100 ft' };
