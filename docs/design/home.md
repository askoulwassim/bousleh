# Bousleh Home: design spec (Oct 25, 2026)

Source: the Claude Design canvas "Bousleh Home" (artboards Home, Home-Phone, Logo, Tokens, Components). The direction picked is **C · Strata** with **B's Horizon front page**.

## Direction
- Home is a cross-section with altitude as rows (50,000 company, 10,000 cross-team, 1,000 my surfaces, 100 one thing) and the scopes as columns (Harbor, Atlas, Hiring, Platform, Bousleh; on a work instance, the company's scopes). Each cell holds the objects at that scope and altitude. Empty cells are drawn dashed: the gaps are the message.
- The desktop view fills the window at any width (no maximum width; side padding grows with the window). Scope columns share the width but never shrink below 168 px (140 px from 720 to 1099 px): when they can't all fit, the grid scrolls sideways and the altitude labels stay pinned on the left. Below 720 px the phone view takes over.
- Each mode launches from the band it works at: 50K Shape; 10K Horizon, Communicate; 1K Workshop, Pulse, Coach; 100 Counsel, Capture.
- The header shows the hero count of what needs you, plus readouts (owed me, meetings, inbox, touch due) and two actions (one primary, one secondary; from v0.2 the secondary is Capture).
- Below the grid sits the Horizon front page: a masthead (issue number, scan date), a lead story with the week's findings by day, side stories, the beat (findings per watched entry), list changes, and scopes with no watch list.
- Phone (last snapshot): hero, readouts, a StrataMini heat grid, the needs-you card, the next meeting, the bet, the Horizon front page, and a tab bar with Drop as the primary action.

## Glyph grammar
- Layer is shape: anchor ■, evidence ●, work ◆, person ○, moment ▲.
- State is colour: idle (line-2 fill, muted stroke), yours (accent), needs (gold), moving (teal), closed (ash with a strike), ghost (dashed, for forecast items).

## Tokens (CSS `--bsl-*`, TS `tokens.*`)
| Token | Value | Role |
| --- | --- | --- |
| bg | #0B0809 | page ground |
| bg-2 | #110D0F | rail, table heads |
| well | #120E10 | strata grid |
| panel | #171215 | cards, cells |
| panel-2 | #211A1E | hover, active |
| line | #2C2227 | 1px everywhere |
| line-2 | #3D2F36 | controls, idle glyphs |
| ghost | #5A4650 | forecast marks, never text |
| fg | #F2EAED | text |
| muted | #AE9EA5 | secondary text |
| dim | #8C7B83 | eyebrows (4.6:1 on panel) |
| zero | #74626A | zero counts, 24px+ only |
| accent-fill | #A3264C | primary button (ink 6.9:1) |
| accent | #C93A63 | go, done, yours; marks and arcs |
| accent-hi | #E8668C | accent text and icons |
| accent-hover | #B8305A | filled hover |
| accent-deep | #5A1A30 | hover borders, heat |
| ink | #FFF0F4 | text on accent fill |
| needs | #E3B65C | needs you, the only interrupt |
| moving | #62C4BC | in progress, info, new |
| closed | #7E8696 | dropped, killed, skipped |
| tint-* | 8% fill, 45% border | any state colour |
| glow | radial-gradient(900px 620px at 100% 0%, rgba(110,20,48,.42), transparent 70%) | ground only |

Type: display Bricolage Grotesque 800 (masthead 56/.9 -.05em; hero 44/1 -.035em; count 40/.9; lead 34/1.02 -.03em; altitude and readout 24/1; story 21/1.1). UI Figtree (title 600 15/1.3, body 500 14/1.45, caption 13). Mono JetBrains Mono 500 (eyebrow 11 +.1em uppercase, micro 10 +.06em, numbers tabular).

Space (`space-{px}`): 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56. Strata gap 10, cards pad 18 to 22, sections 28 apart, page pads 48 × 32.

Radius: sm 6, cell 10, card 12, phone card 14, chip 999, app icon 40 on 180. Sizes: control 44, control-sm 34, launcher 40, chip 24 (28 hit area), rail 76, tab bar 84, mobile primary 50. Focus 2px accent outline, offset 2. Strata columns 132 | 5 × 1fr | 200, max width 1364. Motion: fast 150ms, base 250ms, ring 600ms ease, pulse 1.4s while a run is going; hover only under (hover:hover); reduced motion respected.

## Logo: Ba Ring
- 100 viewBox, a Ring construction: disc r49 panel fill, 1.5 line-2 stroke; track r38 at 7, line colour; accent arc from 12 o'clock clockwise 82%, round caps; fg end dot r6.5 with a 3 panel stroke ("you are here").
- Inside, a geometric ب: path `M31,42 L31,46 Q31,54 39,54 L61,54 Q69,54 69,46 L69,32`, fg at 9 over a panel stroke at 15. Its dot is a north-pointing needle diamond in accent-hi: `50,61 55.5,68 50,75 44.5,68`.
- Favicon cut (16 to 48): heavier strokes, no disc stroke, no end dot.
- Lockup: lowercase "bousleh" in Bricolage 800, بوصلة in Noto Kufi Arabic 500 below in muted.
- App icon: the ground with the glow, plus a burgundy variant. Alternate kept for reference: the Needle Ring.

## Components and the op or prompt each calls
| Component | Reads / calls |
| --- | --- |
| AppShell, Rail, RailButton, SweepIndicator, InstanceSwitch, AskButton | assets.list, Hub link, free prompt |
| ScreenHeader, Readout | pulse.today, commitments.list, inbox.list, queue.list |
| StrataGrid, ScopeHeader | context.strata (scopes, doc counts) |
| AltitudeLabel (density dots, here caret) | click: a context.brief prompt at that altitude |
| StrataCell (filled, void, needs, bet), ItemRow, Glyph | context.strata; click: a brief prompt for that cell |
| StageRail (strategy 4 steps, metric 5) | read only |
| BetCard, ClockRing, SlotBar | pulse.today open_bets; click: Shape prompt |
| Launcher (mode, prompt, altitude, disabled) | one ready prompt |
| Button (primary, secondary; md, sm), Chip (neutral, accent, needs, moving, closed, dashed) | n/a |
| Masthead, StoryLead, Story, DayBars | watch.digest; Open is the url; Save and Skip call vault.supersede (to_read, dismissed); For Shape is a prompt |
| BeatRow, ListChange, ReadingQueue | watchlists.get, queue.list |
| TabBar, DropButton, SnapshotStamp, StrataMini (phone) | Drop skill; no engine writes on the phone |

## Open points
- Story titles and summaries come from the scan. Findings carry no image, so the lead visual is findings filed per day (filed_at).
- Long object titles truncate. An optional short label field would help the grid.

## As built (Oct 25, packages/home)
The boards in `docs/design/home/*.dc.html` are the visual spec; `packages/home` builds them into one page. Where the build differs from the boards, it is because the data isn't there yet:
- **Readouts:** owed me, meetings, inbox, touch due, and **next due** (the soonest dated commitment you owe), which the boards don't show. With nothing read, every readout shows a dash, and the hero says "No data yet" rather than "Clear".
- **Rail:** Home, Docs (the registered assets, from `assets.list`), the freshness stamp and Ask. No InstanceSwitch (each instance is its own published page).
- **BetCard:** the ClockRing reads its days from the bet's kill criteria ("30 days", "6 weeks") and counts from when the idea became a bet (`since` in `context.strata`); no ring when the kill criteria name no time. No SlotBar: POC and promotion counts live in a POC tool, not in Bousleh. Below the clock, the bet's cell is grouped by kind (experiments, problems, metrics…).
- **Horizon:** the masthead reads "Wk 43 · <scan day>" (ISO week) instead of an issue number; the beat counts this week's findings whose url host or text matches each entry. With no findings it shows the same layout with bracketed placeholders and a dashed chip, never invented stories.
- **Titles** wrap to two lines in a cell, then truncate.
- **Lockup:** in the page footer, بوصلة beside "bousleh".
- **First (Nov 13):** between the header and the strata, a strip of up to three cards from `pulse.today`'s `focus`: a number, the first reason as the eyebrow (gold for something owed, teal for a meeting), the title, the other reasons, and altitude · scope. Each card copies a prompt: Pulse for a commitment ("…is first today"), Pulse for a follow-up owed to you, Counsel for a meeting. On the right, the snoozed count with the next day one comes back, and "+N more" (a Pulse prompt). On the phone the same list sits above StrataMini and replaces the needs-you card. Snoozed commitments are off the grid and out of "Next due" until their day; one back from a snooze reads "Follow up · back from snooze" (owed to you) or "You owe · back from snooze". With nothing ranked, the strip still shows and says "Nothing pressing today", so an empty list never looks like a broken one. Snapshots taken before this have no focus, and the strip is simply left out.

## v0.2: Home as a Claude app (Nov 27)
Source: the "v0.2 · Home as an app" page of the canvas (boards App-Window, App-Ask, App-Capture, App-Shell, App-Sessions, App-Components and the clickable prototype). Same tokens and type; nothing new is coloured outside them. What `packages/home` builds, by component:

- **The rule.** Home acts itself for one op on a press, a read-only answer or a fixed run on this Mac; it opens Claude for a Claude output, a connector or the web, or a write on Claude's judgment. It is a rule, not a setting (`launch.ts`), and the board's "prototype controls" and Open-in-Claude sheet are not built.
- **Where tag** (`.where`): a 18 px pill in mono 9 px, on every launcher that leaves Home and on the ones that answer here. Here (moving), In Claude (accent-hi, with an out arrow), On this Mac (needs), Copy (dim, the fallback). Copy replaces In Claude when the view can't open Claude (not installed, no full access, phone, web); Copy replaces Here when Ask can't answer.
- **Header:** the hero, the readouts (owed me, meetings, inbox live, touch due, next due), the primary action with its tag, and Capture (a mic button) in place of the secondary action.
- **ActionRow** on each commitment card in First and in Ask answers: Done, Date, Snooze, Close (34 px, radius 8). States: idle; confirm (the asked button in needs with "Mark done?" or "Close it?", the others dim, "Press again to confirm" under it; 4 s or Escape resets it); picker open (its button outlined in accent, the others dim); busy ("Marking done…", "Undoing…"); done (a teal check and the result, Undo on the right for 5 s); error (a gold warning, the reason, Retry). A card acted on stays in place with its result until its Undo closes, even if a read has already dropped it.
- **DayPicker** inside the card: an eyebrow ("Due on" or "Snooze till"), chips for the quick days (Date: Today, then the coming Monday, Wednesday and Friday as "Mon 30 Nov"; Snooze: Tomorrow, Monday, In a week, In two weeks), and "Any day" with a date field (min today, or tomorrow for a snooze) and Set.
- **Meetings row:** under First, one card with a line per meeting today: time, title, "Prep filed", "On your calendar" or "Notes filed"; Brief me (Here, Ask) and Prep with Counsel (In Claude). A meeting already held has no buttons.
- **Rail:** Home, Ask, Tune now, Health, Docs, then the freshness stamp. Ask, Tune and Health open the side panel: 440 px on the right, the page pads to make room (from 1100 px; narrower it lies over the page, and on the phone it fills the screen above the tab bar).
- **Ask panel:** the AskBar (the mark, the field "Ask about anything you've filed. Answers here, changes nothing.", a mic where dictation is offered, Ask), suggestion chips, then the answer: the question as a bubble on the right; while reading, "Reading <tool>…" in teal with three skeleton bars and Stop; then paragraphs, bullets, commitment items (title, why, ActionRow), finding items (title, source, Save and Skip), and at most one hand-off (a PROMPT box in mono with Copy and Open in Claude). The footer: "Read <tools> · changed nothing", Read it to me (tts) and Continue in Claude. Where Ask can't answer, a line says so and Ask copies the question.
- **Tune now panel:** the title, the On this Mac tag, the status in mono ("Running · 1:53", "Finished", "Stopped", "Failed (exit 1)"), Stop; the log (time, then the line; ok lines teal, attention gold, a cursor while running); the line on what Tune does; Run Tune now or Run again. Not offered: a gold box with the reason and the one button that helps (Install as app, Allow full access, Permissions, Copy the command).
- **Health panel:** rows with a check or a warning (Bousleh server, Your data, Backups, Repo), "Checked 15:38", then Check setup and Rerun setup (On this Mac), Publish Home (In Claude, the Code tab) and Refresh, and the setup log.
- **Capture panel:** a 520 px card over a dimmed page, top third. Header: the mark, "Capture", the state (Listening, Typing, Sending, Sent), close. Listening: the mic ring (stop), "Say it the way you'd tell a colleague", the live transcript (settled words, then the guess in muted, a cursor). Typing: the field (accent border on focus), "⌘↩ sends to the inbox", Dictate where offered, File it now (In Claude), Send to inbox. No dictation: the eyebrow "Dictation isn't offered in this window: type it". Sent: a teal check ring, "In the inbox", "The next sweep files it.", the first line of what was sent, "Closes in 5 s", Undo and File it now.
- **First launch** (installed window only): a 560 px card on the page ground with the mark, "Let Bousleh work on this Mac", the optional line, a row per permission (title, what it does, Allow or a teal "Allowed"; "Turned off · Change" when declined; "Not available here"), and Open Home.
- **Footer:** Install as app (primary, small) where the desktop app offers it; in the installed window, "Installed app · full access on/off · Home v0.2.0" and Permissions while one is still to ask or was declined.
- **Shell:** the Dock icon is `assets/app-icon.svg` drawn on a 256 px canvas, with the needs-you count as its badge. The menu bar item is the Ba Ring simplified (ring, ب and needle, black on transparent, a template icon), titled with the needs-you count; its menu lists what needs you, then Open Home, Capture…, Pulse: where am I?, and Run Tune now. Notifications, on the board, are not in v0.2.
