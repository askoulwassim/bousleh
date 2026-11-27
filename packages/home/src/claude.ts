import { app } from './app.js';
import { chatUrl, clipPrompt, codeUrl, openCommand } from './launch.js';

/*
 * Handing work to Claude. With the installed app and full access, a button opens Claude straight
 * away: a new chat (or, for Health's Finish setup only, the Code tab on the repo) with the prompt typed in and
 * never sent. Anywhere else the prompt is copied, or shown in a box to copy, and a toast says so.
 */

const sheetEl = () => document.getElementById('sheet') as HTMLElement;

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The copy box: a prompt to select and copy, when the clipboard is refused, or one to finish first (editable). */
export function openSheet(title: string, text: string, editable: boolean): void {
  const sheet = sheetEl();
  (sheet.querySelector('.sheet-t') as HTMLElement).textContent = title;
  (sheet.querySelector('.sheet-n') as HTMLElement).textContent = editable
    ? 'Finish it here, copy it, then paste it into Claude.'
    : 'The clipboard was not available. Select the text and copy it.';
  const area = sheet.querySelector('textarea') as HTMLTextAreaElement;
  area.value = text;
  area.readOnly = !editable;
  sheet.hidden = false;
  area.focus();
  if (editable) area.setSelectionRange(text.length, text.length);
  else area.select();
}

export function closeSheet(): boolean {
  const sheet = sheetEl();
  if (sheet.hidden) return false;
  sheet.hidden = true;
  return true;
}

export async function sheetCopy(): Promise<void> {
  const sheet = sheetEl();
  const area = sheet.querySelector('textarea') as HTMLTextAreaElement;
  if (await copyText(area.value)) {
    closeSheet();
    app.toast('Copied. Paste it into a new chat in Claude.');
  } else {
    area.select();
    (sheet.querySelector('.sheet-n') as HTMLElement).textContent = 'The clipboard was not available. Select the text and copy it.';
  }
}

/** The fallback: copy the prompt, say so, and why it didn't open. */
export async function copyPrompt(text: string, why = ''): Promise<void> {
  if (await copyText(text)) app.toast(`Copied${why ? ` (${why})` : ''}. Paste it into a new chat in Claude.`);
  else openSheet('Copy this prompt', text, false);
}

/** Why a Claude-bound button copies here instead of opening Claude. */
function copyReason(): string {
  if (!app.facts.installed) return '';
  if (app.facts.fullAccess !== 'granted') return 'full access is off';
  return '';
}

/**
 * Open Claude with the prompt typed in, or copy it. `code` opens the Code tab on the repo (Publish
 * Home only). The command is fixed: `open "<url>"` (or `start` on Windows), where the url is built
 * and checked by launch.ts; data only ever fills its encoded q (and folder) parameters.
 */
export async function openClaude(prompt: string, opts: { code?: boolean } = {}): Promise<void> {
  const text = clipPrompt(prompt);
  const cp = app.caps.desktop?.childProcess;
  if (app.ui.reach.open && cp) {
    const repo = app.facts.repo;
    const url = opts.code ? (repo ? codeUrl(text, repo) : null) : chatUrl(text);
    const command = url ? openCommand(url, app.facts.platform) : null;
    if (command) {
      try {
        await cp.exec(command, { timeout: 15_000 });
        app.toast(
          opts.code
            ? 'Opened the Code tab with it typed in. Read it, then press Enter.'
            : 'Opened in Claude, typed in. Read it, then press Enter.',
        );
        return;
      } catch {
        await copyPrompt(text, "Claude didn't open");
        return;
      }
    }
    if (opts.code && !repo) {
      await copyPrompt(text, 'run scripts/setup-mac.sh once so Home knows the repo');
      return;
    }
  }
  await copyPrompt(text, copyReason());
}
