---
name: drop
description: Save a dictated note verbatim into the Google Drive folder "Bousleh Inbox" as a .md file, for Bousleh to file later. Use on the phone (or anywhere the Bousleh tools aren't available) when you say "drop this", "Bousleh note", "inbox this" or "capture this".
---

# Drop

The phone end of Bousleh's inbox. The user dictates a thought; you save it, word for word, as one new file in Google Drive, and stop there. On the Mac, Capture brings it in (through the same Google Drive connection) and decides what it means. You don't.

## When the Bousleh tools are there, use Capture instead

If the Bousleh MCP tools are available in this session (`inbox_drop`, `deposits_write` and so on), you're on the Mac: use the Capture skill instead. Drop is for the phone, the web, and anywhere else Bousleh can't be reached.

## Steps

1. **Take the note.** Everything the user said after the trigger phrase ("drop this:", "Bousleh note:"). If they gave no text yet, ask once: "What's the note?"
2. **Keep their words.** Save what they said, not a summary. Fix only obvious dictation errors (a misheard name you're sure of, a missing full stop). Don't add headings, bullets or interpretation.
3. **Find the folder.** With the Google Drive connector, search for the folder titled exactly `Bousleh Inbox` (`title = 'Bousleh Inbox' and mimeType = 'application/vnd.google-apps.folder'`). If there's more than one, use the one at the top of My Drive. If there's none, create it at the top of My Drive (folders are made by setting the content type to `application/vnd.google-apps.folder`), then carry on.
4. **Create one new file** in that folder. Never append to an existing file.
   - Title: `capture-YYYY-MM-DD-HHMM-<two or three word slug>.md`, in the user's local time. Use the current-time tool when you have one; without it, leave out `HHMM` (`capture-YYYY-MM-DD-<slug>.md`).
   - Content type `text/markdown`, with **conversion to a Google Doc turned off** (`disableConversionToGoogleType: true`), so the file stays plain text.
   - Content:

     ```
     ---
     captured_at: <ISO date-time with offset, or just the date if you don't know the time>
     via: phone
     ---

     <the note, as they said it>
     ```

5. **Confirm in one short line** the user can hear: "Saved to Bousleh Inbox." Add nothing else unless the save failed.

## Several notes at once

If the user says several separate things ("drop three things: ..."), make one file per thing.

## Never

- File, classify, link or answer the note. That's Capture's job on the Mac.
- Write to any folder other than "Bousleh Inbox", or edit, move or delete files there.
- Mix accounts: a personal note goes to the personal Drive, a work note to the work account's Drive. Use whichever Google Drive this Claude account is connected to.
