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
} as const;
