# Basketball Overlay — Bayan ng Lopez, Quezon

A live basketball scoreboard overlay for OBS Studio, loaded as a **Browser Source**, plus a
separate control panel page the operator uses to run the game.

## What this project is

- `overlay.html` — the graphic OBS renders. Transparent background, display only, no controls.
- `control.html` — the operator panel (scores, clock, fouls, etc.). Opened in a normal browser,
  an OBS custom dock, or a phone/tablet on the same network.
- `server.js` — small Node server that serves both pages and relays state over WebSocket.
  The server holds the single source of truth for game state.
- `brand.css` — the colour and font variables, shared by both pages.
- `logo-cutout.js` — shared by both pages; strips the white background from team logos and
  scales large images down once in the browser.
- `pictu/` — station identity logos (PICTU, Live Lopez, the Lopez seal). They take turns at
  the top left of the overlay, crossfading every 8 seconds, in file-name order. Served as
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

Sampled directly from the seal. They are defined once in `brand.css`; reference the
variables everywhere — no raw hex values elsewhere in the CSS.

```css
:root {
  /* Primary */
  --lopez-red:        #CE1126; /* main panel colour (chosen by the operator, not from the seal) */
  --lopez-red-deep:   #7A0A19; /* score boxes, lower strip */
  --lopez-yellow:     #FFF600; /* seal ring — main accent */
  --lopez-navy:       #080D6B; /* seal lettering — control panel */
  --lopez-navy-deep:  #010441; /* seal backing, text on yellow */

  /* Secondary */
  --lopez-sky:        #0E91F8; /* sky / river */
  --lopez-sky-light:  #39A8FF;
  --lopez-field:      #B7DE00; /* rice-field green */
  --lopez-field-deep: #1B7900; /* treeline green */
  --lopez-earth:      #2F1A0A; /* field grid lines / mountains */

  /* Neutrals */
  --white:            #FFFFFF;
  --black:            #000000;
}
```

### How to use them

- **Scorebug body:** `--lopez-red`, with `--lopez-red-deep` for score boxes and the lower strip.
- **Seal backing:** `--lopez-navy-deep`, so the seal's yellow ring stands off the red.
- **Control panel:** stays navy, so its red STOP and RESET buttons remain distinct.
- **Accents, borders, active states, score highlight:** `--lopez-yellow`.
- **Text on red:** white for scores and names, yellow for labels (PERIOD, FOULS).
- **Text on yellow:** `--lopez-navy-deep` only. Never white on yellow — it is unreadable.
- **BONUS:** a yellow chip with navy text. Do not use the greens or blues as text on red.
- **Final 10 seconds:** the clock block turns white with red digits (red on red would vanish).
- **Secondary info** (timeouts, possession arrow, lower thirds): `--lopez-sky`.
- **Positive / go states** on the control panel (clock running): `--lopez-field-deep`.
- Greens and earth brown are supporting colours only — never use them for large panels.
- Team colours are per-game data, not brand colours. Show them as a small stripe or chip
  beside the team name; the scorebug frame always stays red and yellow. A red team colour will not show against the
  frame — pick a different shade for that team.
- Do not introduce colours outside this palette without asking. Shot-clock/final-seconds
  warning reds are the allowed exceptions (`--warn-red`, `--shot-warn`).

## Design direction

- Broadcast-style scorebug, anchored bottom-centre or top-left. Bold, flat, high contrast —
  it must read on a phone screen at 720p.
- Each team's logo sits at its own outer end of the scorebug, directly on a navy end cap.
  The logo files are square images on white; `logo-cutout.js` removes the white that touches
  the image edge in the browser (white inside a seal is kept). Never edit the files in
  `logo/` to do this. No other effects on logos. A team with no logo has no end cap.
- Typography: a condensed bold sans for names and labels, and **tabular (monospaced) numerals**
  for the score and clocks so digits never shift width as they change.
- Minimum text size on the 1080p canvas: 28px. Scores 64px+.
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
- `visible` — show/hide for the scorebug
- `identityVisible` — show/hide for the top-left identity logos (independent of `visible`)

Rules follow FIBA defaults unless told otherwise: 10-minute quarters, 5-minute overtime,
team bonus on the 5th foul per quarter, 24/14 shot clock.

## Control panel requirements

- Big tap targets — it will be used on a phone or tablet at courtside.
- +1 / +2 / +3 and −1 per team; foul and timeout +/−; start/stop clock; reset shot clock
  to 24 and 14; next period; possession toggle; show/hide overlay.
- Every destructive action (reset game, new period) needs a confirm.
- Keyboard shortcuts for the clock (Space = start/stop) and shot clock resets.
- Teams are chosen from a dropdown built from `logo/`, not typed in. The stripe colour is
  still editable per team.

## Working rules

- Verify visual changes by loading `overlay.html` at 1920×1080 over a non-white background —
  transparency bugs are invisible on white.
- Never put control UI in `overlay.html` or display-only code paths in `control.html`.
- Display language is English/Filipino as supplied by the operator; keep the seal's own
  text untouched.
