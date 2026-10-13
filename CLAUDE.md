# Basketball Overlay — Bayan ng Lopez, Quezon

A live basketball scoreboard overlay for OBS Studio, loaded as a **Browser Source**, plus a
separate control panel page the operator uses to run the game.

## What this project is

- `overlay.html` — the graphic OBS renders. Transparent background, display only, no controls.
- `mini.html` — a separate compact scoreboard (clock, period, shot clock, BONUS tabs, logo,
  full town name with five team-foul bars under it, and score per team), its own browser source. Bottom left by default; `?pos=tl`,
  `tr`, `bl` or `br` picks the corner. Same rules as `overlay.html`.
- `control.html` — the operator panel (scores, clock, fouls, etc.). Opened in a normal browser,
  an OBS custom dock, or a phone/tablet on the same network.
- `server.js` — small Node server that serves both pages and relays state over WebSocket.
  The server holds the single source of truth for game state.
- `brand.css` — the colour and font variables, shared by both pages.
- `logo-cutout.js` — shared by both pages; strips the white background from team logos and
  scales large images down once in the browser.
- `pictu/` — station identity logos (PICTU, Live Lopez, the Lopez seal). They take turns at
  the top left of both `overlay.html` and `mini.html` (code in `identity.js`), crossfading
  every 8 seconds in file-name order. The current logo is picked from the wall clock, so both
  pages stay in step when both are on air. Served as
  `/identity/<file>`. Some are 6000×6000 originals; never display them unscaled — always go
  through `logoCutout(src, size)`. Images with their own transparency are not cut out.
- `state.json` — the current game, written by the server so a restart keeps the score.
  Generated at runtime; do not edit by hand.
- `logo/` — one image per team (`.png`, `.jpg`, `.webp`, `.svg`). The file name is the team:
  `san_antonio.png` appears as "SAN ANTONIO" in the control panel's team dropdown. Logos are
  served as `/logos/<file>`, and only files found in this folder are served.
- `cropped-Lopez-Quezon-FINAL-1.png` — the Lopez seal, served as `/logo.png` for the control
  panel header. Use as-is; never recolor, crop, stretch, or redraw any seal or logo.

Keep it dependency-light: plain HTML, CSS, and vanilla JS. No framework, no build step.
The only npm dependency should be `ws`.

## Commands

```bash
npm install
npm start
```

- Overlay (paste into OBS Browser Source): `http://localhost:3000/overlay.html`
- Control panel: `http://localhost:3000/control.html`

## OBS Browser Source constraints

These are hard rules — the overlay is composited over live video.

- Canvas is **1920×1080**. Lay out in fixed pixels against that size; do not make it responsive.
- `html, body { background: transparent; margin: 0; overflow: hidden; }` — never set a page
  background colour.
- No scrollbars, no cursor, no hover states, no click handlers in `overlay.html`.
- Keep all graphics inside the title-safe area: at least 48px from every edge.
- OBS uses Chromium (CEF). Modern CSS is fine, but test in OBS itself, not only in Chrome.
- Animate only `transform` and `opacity`. No layout-thrashing animations, no heavy blur
  filters or large box-shadows that animate — they drop frames on the stream.
- The overlay must recover on its own: on WebSocket disconnect, retry every 2s and re-request
  full state on reconnect. OBS reloads sources without warning.
- The font is Bahnschrift, which ships with Windows 10/11, so the OBS machine must be Windows.
  If another font is added, bundle it locally in `fonts/`. Never load fonts or scripts from a
  CDN — venue internet is unreliable.
- The server only serves the files listed in `FILES` in `server.js`; add new assets there.
- Append `?bg=1` to the overlay URL for a test backdrop when checking it outside OBS.
- The game clock ticks on the **server**. The overlay only renders the time it is sent, so a
  source reload never loses or drifts the clock.

## Brand colours

All colours are defined once in `brand.css`; reference the variables everywhere — no raw hex
values elsewhere in the CSS. There are two palettes.

### Scoreboards (`overlay.html`, `mini.html`) — "Serbisyo Basta Ubana" logo

Sampled from the SBU logo the operator supplied. The pages use the `--board-*` role names,
not the raw colours, so a future re-skin only touches `brand.css`.

```css
--sbu-navy:     #040263;
--sbu-red:      #ED0000;
--sbu-gold:     #F0A00A;
--sbu-red-deep: #B00000;  /* the same red, darker: a shade, not a fifth colour */

--board-panel:      var(--sbu-red);       /* the body: team name panels */
--board-panel-deep: var(--sbu-red-deep);  /* score boxes */
--board-deep:       var(--sbu-navy);      /* the one dark anchor: clock, lower strip, ends, title */
--board-accent:     var(--sbu-gold);      /* thin trim only */
```

**Red is the main colour.** The operator tried white panels and a white/red/blue/gold
patchwork and rejected both as a messy colour mix. Keep it disciplined:

- **Red** is the body. Depth comes from a darker red, never from another hue.
- **Navy** is the single dark anchor: clock, lower strip, logo end caps, title strip.
- **White** is for lettering only — names, scores, clocks, title — never a panel background.
- **Gold** is trim, used sparingly: the top line, small labels (FOULS, period), the BONUS
  chip, timeout marks, and the mini shot-clock circle. No large gold blocks.
- Gold lettering goes on navy only; on red it is too low in contrast.
- **Mini foul bars:** white when lit, darker red when not.
- **Final 10 seconds:** the big clock block turns white with red digits — the one time a
  white block appears, so it stands out.
- Team colours are per-game data, shown as a small stripe beside the team name. A red or
  navy team colour will not show against the frame — pick a different shade for that team.
- Allowed extras: `--shot-warn`, `--white`, `--black`. Do not introduce other colours, or
  give white or gold a large surface, without asking.

### Control panel (`control.html`) — Bayan ng Lopez seal

The `--lopez-*` variables (navy, yellow, sky, field green), sampled from the seal. The panel
stays navy so its red STOP and RESET buttons remain distinct; `--lopez-field-deep` marks go
states. The scoreboards no longer use these.

## Design direction

- Broadcast-style scorebug, anchored bottom-centre or top-left. Bold, flat, high contrast —
  it must read on a phone screen at 720p.
- Each team's logo sits at its own outer end of the scorebug. The logo files are square
  images on white; `logo-cutout.js` removes the white that touches the image edge in the
  browser (white inside a seal is kept), paints out black bars along an edge, and trims the
  empty margin. Never edit the files in `logo/` to do this. No other effects on logos. A team
  with no logo has no end block.
- Typography: a condensed bold sans for names and labels, and **tabular (monospaced) numerals**
  for the score and clocks so digits never shift width as they change.
- Minimum text size on the 1080p canvas: 28px. Scores 64px+. Exception: the mini scoreboard
  is deliberately compact (about 485×156px; scores 46px, town names 32px, BONUS tabs 13px).
- Transitions are short (200–400ms). Score changes get a brief yellow flash; nothing loops
  or pulses continuously except the final-seconds clock warning and the top-left identity
  logo rotation (requested by the operator).

## Game state

One plain JSON object, owned by the server, broadcast in full on every change:

- `home` / `away`: `name`, `abbr` (3–4 letters), `score`, `fouls`, `timeouts`, `color`,
  `logo` (file name in `logo/`). Name, abbreviation and logo are set together by picking a team.
- `period` (1–4, then `OT`, `2OT`), `periodLengthSec`
- `gameClock` (seconds remaining, tenths under one minute), `clockRunning`
- `shotClock` (24 / 14 reset), `shotClockVisible`
- `possession` (`home` | `away` | `null`)
- `title` — tournament title, shown as a navy strip with yellow text on top of both the
  scorebug and the mini scoreboard; editable under Setup, empty hides the strip
- `run` (`team`, `points`, `against`, `startAt`) — the current scoring run, NBA-style
  ("12-2 run"): the most recent stretch in which one team outscored the other by the widest
  margin, with the other team allowed at most a third of the running team's points. Worked
  out by `findRun()` from `scoreLog` (recent baskets with `playedMs` timestamps). The
  operator explicitly did not want runs that always read "N-0". Duration on screen is
  `playedMs - run.startAt`, i.e. game-clock time since the basket before the run began.
  The mini scoreboard's "TEAM 12-2 RUN IN THE LAST 3:10" tab is automatic (the operator did
  not want to toggle it): `announceRun()` sets `runVisible` for 15 seconds each time the
  running team scores while the run's margin (`points - against`) is `runThreshold` (default
  7) or more, so 7-0, 9-2, 12-2 and 15-4 show but 8-2 does not. `runAuto` is the on/off
  switch for the whole feature. These definitions came from the operator: 7-0/8-0 is a
  mini-run and a run need not be unanswered (12-2, 15-4). Do not add a "Kill Shot" label for
  10-0 runs: it was added once unasked and the operator had it removed
- `timeoutsTotal` — how many timeouts each team starts with (operator-set, 0–20, default 2).
  Changing it gives both teams that many. The operator is unsure of the league's timeout
  rules, so the server never refills timeouts by itself: no half-time or overtime reset.
  `timeoutsVisible` shows or hides timeouts on both scoreboards: marks on the big one, and on
  the mini a separate "T.O." tab beside the scoreboard. The operator does not want timeouts
  inside the mini's score box
- `visible` — show/hide for the scorebug
- `miniVisible` — show/hide for the mini scoreboard
- `identityVisible` — show/hide for the top-left identity logos (independent of `visible`)

Rules follow FIBA defaults unless told otherwise: 10-minute quarters, 5-minute overtime,
team bonus on the 5th foul per quarter, 24/14 shot clock. Timeouts are the exception: they
are fully manual (see `timeoutsTotal`).

## Control panel requirements

- Big tap targets — it will be used on a phone or tablet at courtside.
- +1 / +2 / +3 and −1 per team; foul and timeout +/−; start/stop clock; reset shot clock
  to 24 and 14; next period; possession toggle; show/hide overlay.
- Every destructive action (reset game, new period) needs a confirm.
- Keyboard shortcuts for the clock (Space = start/stop) and shot clock resets.
- Teams are chosen from a dropdown built from `logo/`, not typed in. The stripe colour is
  still editable per team. Both scoreboards show the full town name (the operator asked for
  no shortened names); `abbr` is still generated in `scanTeams()` but is not displayed.

## Working rules

- Verify visual changes by loading `overlay.html` at 1920×1080 over a non-white background —
  transparency bugs are invisible on white.
- Never put control UI in `overlay.html` or display-only code paths in `control.html`.
- Display language is English/Filipino as supplied by the operator; keep the seal's own
  text untouched.
