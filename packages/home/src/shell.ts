import { app, refreshReach } from './app.js';
import { openCapture } from './capture.js';
import { firstLaunchHtml } from './panels.js';
import type { Desktop, DesktopPermission, PermissionState, TrayMenuItem } from './platform.js';
import { questions } from './prompts.js';
import { APP_JSON, readAppJson } from './runs.js';
import { ask, openSide, startRun } from './side.js';

/*
 * Home as an installed app (the desktop capability): the install button, the first-launch screen,
 * its own Dock icon and the needs-you badge, the menu bar item, and the Capture shortcut. Every call
 * that needs a permission is made only once its state reads granted, or from a click.
 */

const DECLARED: DesktopPermission[] = ['full-access', 'menu-bar', 'shortcuts'];
const FIRST_PATH = 'app/first-launch';
export const SHORTCUT = 'Alt+Shift+B';

let states: Partial<Record<DesktopPermission, PermissionState>> = {};
let continued = true;
let showFirst = false;

const firstEl = () => document.getElementById('first') as HTMLElement;

/** In the installed app's window: the desktop modules beyond install exist. */
export const inApp = (d: Desktop | null): d is Desktop => !!d?.fs && !!d.permissions;

export async function initShell(d: Desktop | null): Promise<void> {
  if (!d) return;
  app.ui.install = (await d.install.state().catch(() => 'unavailable')) === 'available';
  if (!inApp(d)) {
    app.schedule();
    return;
  }
  app.facts.installed = true;
  app.facts.platform = (await d.os?.platform().catch(() => '')) ?? '';
  void setDockIcon(d);
  continued = await readContinued();
  await refreshPermissions();
}

/** Read the permissions, then light up what each one allows. Never asks. */
export async function refreshPermissions(): Promise<void> {
  const d = app.caps.desktop;
  if (!inApp(d) || !d.permissions) return;
  const all = await d.permissions.state().catch(() => ({}) as Record<string, PermissionState>);
  states = {};
  for (const name of DECLARED) states[name] = all[name] ?? 'unavailable';
  app.facts.fullAccess = states['full-access'] ?? 'unavailable';
  if (app.facts.fullAccess === 'granted') await readRepo(d);
  if (states['menu-bar'] === 'granted') traySig = '';
  if (states.shortcuts === 'granted') await registerShortcut(d);
  showFirst = !continued && DECLARED.some((n) => states[n] === 'prompt');
  app.ui.app = {
    fullAccess: app.facts.fullAccess === 'granted',
    needsSetup: DECLARED.some((n) => states[n] === 'prompt' || states[n] === 'denied'),
  };
  refreshReach();
}

/** ~/.bousleh/app.json, written by scripts/setup-mac.sh: where the repo is. */
async function readRepo(d: Desktop): Promise<void> {
  try {
    app.facts.repo = readAppJson((await d.fs?.readFile(APP_JSON, 'utf8')) ?? '');
  } catch {
    app.facts.repo = null;
  }
}

async function readContinued(): Promise<boolean> {
  const db = app.caps.db;
  if (!db) return false;
  try {
    const snap = await db.doc(FIRST_PATH).get();
    return snap.exists && snap.data()?.continued === true;
  } catch {
    return false;
  }
}

/** Allow on the first-launch screen (or Allow full access in a panel): asks now, from the click. */
export async function allow(name: DesktopPermission): Promise<void> {
  const d = app.caps.desktop;
  if (!d?.permissions) return;
  try {
    await d.permissions.request([name]);
  } catch {
    app.toast("Couldn't ask just now. Try again from the window.");
  }
  await refreshPermissions();
}

export async function manage(): Promise<void> {
  try {
    await app.caps.desktop?.permissions?.manage();
  } catch {
    app.toast('Open the app’s Permissions from its menu.');
  }
  await refreshPermissions();
}

/** Open Home on the first-launch screen: remember it, so it isn't shown again. */
export async function continueFirst(): Promise<void> {
  continued = true;
  showFirst = false;
  app.schedule();
  try {
    await app.caps.db?.doc(FIRST_PATH).set({ continued: true, at: new Date().toISOString() });
  } catch {
    // Not remembered: it shows again next time, which is harmless.
  }
}

/** The footer's Permissions button: the first-launch screen again while one is still to ask, else the app's own dialog. */
export function permissionsButton(): void {
  if (DECLARED.some((n) => states[n] === 'prompt')) {
    showFirst = true;
    app.schedule();
  } else void manage();
}

export async function install(): Promise<void> {
  const d = app.caps.desktop;
  if (!d) return;
  const answer = await d.install.request().catch(() => 'failed' as const);
  if (answer === 'installed') app.ui.install = false;
  else if (answer === 'failed') app.toast('Could not install. Try Install as app from the artifact menu.');
  app.schedule();
}

// ---------------------------------------------------------------- Dock

async function setDockIcon(d: Desktop): Promise<void> {
  const src = document.querySelector<HTMLMetaElement>('meta[name="bousleh-app-icon"]')?.content;
  if (!src || !d.app) return;
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    canvas.getContext('2d')?.drawImage(img, 0, 0, 256, 256);
    void d.app?.dock.setIcon(canvas.toDataURL('image/png')).catch(() => {});
  };
  img.src = src;
}

let badge: string | null = null;

// ---------------------------------------------------------------- menu bar

/** The menu bar mark: the Ba Ring simplified, black on transparent (a template icon), 36 px for 18 pt. */
function trayIcon(): string {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 36;
  const g = canvas.getContext('2d');
  if (!g) return '';
  g.scale(36 / 100, 36 / 100);
  g.strokeStyle = '#000';
  g.fillStyle = '#000';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // The ring: 82% of a circle from 12 o'clock, clockwise.
  g.lineWidth = 9;
  g.beginPath();
  g.arc(50, 50, 40, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * 0.82);
  g.stroke();
  // The ب.
  g.lineWidth = 11;
  g.beginPath();
  g.moveTo(31, 40);
  g.lineTo(31, 46);
  g.quadraticCurveTo(31, 56, 41, 56);
  g.lineTo(59, 56);
  g.quadraticCurveTo(69, 56, 69, 46);
  g.lineTo(69, 32);
  g.stroke();
  // Its dot, the needle.
  g.beginPath();
  g.moveTo(50, 63);
  g.lineTo(56, 70);
  g.lineTo(50, 77);
  g.lineTo(44, 70);
  g.closePath();
  g.fill();
  return canvas.toDataURL('image/png');
}

let trayMark = '';
let traySig = '';

function needsItems(): { title: string; eyebrow: string }[] {
  return (app.view.focus?.items ?? []).filter((f) => f.kind === 'commitment' && f.tone === 'needs').slice(0, 5);
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function showWindow(): void {
  void app.caps.desktop?.window?.show().catch(() => {});
}

async function updateTray(d: Desktop): Promise<void> {
  const needs = app.ui.mode === 'live' ? app.view.hero.needs : 0;
  const items = needsItems();
  const run = app.ui.reach.run;
  const sig = JSON.stringify([needs, items, run]);
  if (sig === traySig) return;
  traySig = sig;
  trayMark ||= trayIcon();
  const menu: TrayMenuItem[] = [
    { label: needs ? `${needs} need${needs === 1 ? 's' : ''} you` : 'Nothing needs you', enabled: false },
    ...items.map((f) => ({ label: clip(`${f.title} · ${f.eyebrow}`, 60), click: showWindow })),
    { type: 'separator' },
    { label: 'Open Home', click: showWindow },
    {
      label: 'Capture…',
      click: () => {
        showWindow();
        openCapture(false);
      },
    },
    {
      label: 'Pulse: where am I?',
      click: () => {
        showWindow();
        openSide('ask');
        void ask(questions.where());
      },
    },
    { type: 'separator' },
    {
      label: 'Run Tune now',
      enabled: run,
      click: () => {
        showWindow();
        openSide('tune');
        startRun('tune');
      },
    },
  ];
  await d.tray
    ?.set({
      ...(trayMark ? { icon: trayMark, iconIsTemplate: true } : {}),
      title: needs ? String(needs) : '',
      toolTip: 'Bousleh Home',
      menu,
    })
    .catch(() => {
      traySig = 'failed';
    });
}

// ---------------------------------------------------------------- shortcut

let registered = false;

async function registerShortcut(d: Desktop): Promise<void> {
  if (registered || !d.globalShortcut) return;
  registered = true;
  const ok = await d.globalShortcut
    .register(SHORTCUT, () => {
      showWindow();
      openCapture(false);
    })
    .catch(() => false);
  if (!ok) registered = false;
}

// ---------------------------------------------------------------- paint

/** On every paint: the first-launch screen, the Dock badge and the menu bar item. */
export function paintShell(): void {
  const el = firstEl();
  el.hidden = !showFirst;
  if (showFirst) {
    const html = firstLaunchHtml(states);
    if (el.dataset.html !== html) {
      el.dataset.html = html;
      el.innerHTML = html;
    }
  }
  const d = app.caps.desktop;
  if (!inApp(d)) return;
  if (app.ui.mode === 'live') {
    const text = app.view.hero.needs > 0 ? String(app.view.hero.needs) : '';
    if (text !== badge) {
      badge = text;
      void d.app?.dock.setBadge(text).catch(() => {});
    }
  }
  if (states['menu-bar'] === 'granted') void updateTray(d);
}

export function firstShown(): boolean {
  return showFirst;
}
