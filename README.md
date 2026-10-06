# LGU Scoreboard

A live basketball scoreboard overlay for **Bayan ng Lopez, Quezon**. It runs as a browser
source in OBS Studio or vMix, and is operated from a control panel on the same PC or on a
phone at courtside.

The scorebug uses the colours of the municipal seal: yellow and navy, with sky blue and
field green as accents.

## What it shows

- Team names, team colours and scores
- Game clock (tenths of a second in the last minute, red under 10 seconds)
- Period (Q1–Q4, OT, 2OT…)
- Shot clock (24 / 14), which can be switched off
- Team fouls, with a BONUS marker
- Timeouts remaining
- Possession arrow

## Requirements

- Windows 10 or 11 (the overlay uses the Bahnschrift font, which ships with Windows)
- [Node.js](https://nodejs.org) 18 or newer
- OBS Studio or vMix

## Setup

```bash
npm install
```

```bash
npm start
```

The server prints the addresses to use:

| Page | Address |
|---|---|
| Overlay | `http://localhost:3000/overlay.html` |
| Control panel | `http://localhost:3000/control.html` |
| Control panel from a phone | `http://<this PC's IP>:3000/control.html` |

To use a different port, set the `PORT` environment variable before starting.

### OBS Studio

1. Under **Sources**, click **+** and choose **Browser**.
2. Set the URL to `http://localhost:3000/overlay.html`, width `1920`, height `1080`.

### vMix

1. Click **Add Input → Web Browser**.
2. Set the URL to `http://localhost:3000/overlay.html`, width `1920`, height `1080`.
3. Put the input on an overlay channel, with the transition set to Cut or Fade.

If the browser input stays blank on a PC with two graphics cards, set `vMix64.exe` and its
browser helper processes to the same card under **Windows Settings → System → Display →
Graphics**, then restart vMix.

### Another computer or a phone

The server listens on the whole local network. Replace `localhost` with the server PC's IP
address, and allow Node.js through Windows Firewall on private networks if prompted.

There is no password: anyone on the same network who knows the address can open the control
panel.

## Teams and logos

Every image in the `logo/` folder is a team. The file name becomes the team name, so
`san_antonio.png` shows as **SAN ANTONIO**. To add a team, drop its logo into `logo/` and
reload the control panel.

Pick each side's team under **Setup**. The team's name and logo change together on the
scorebug, and each logo appears at its own team's end.

## Top-left identity logos

Every image in the `pictu/` folder is shown at the top left of the overlay, one at a time,
switching every 8 seconds. Add or remove images there and reload the overlay. The
**Top-left logos** button on the control panel shows or hides them separately from the
scorebug.

## Using the control panel

| Control | What it does |
|---|---|
| START / STOP | Runs or pauses the game clock |
| −1m, −1s, +1s, +1m | Corrects the game clock |
| SHOT 24 / SHOT 14 | Resets the shot clock |
| Shot clock: ON / OFF | Shows or removes the shot clock |
| +1, +2, +3, −1 (fix) | Changes a team's score |
| Fouls + / − | Team fouls |
| Timeouts Use / + | Timeouts remaining |
| Possession | Toggles the possession arrow for that team |
| NEXT PERIOD | Moves to the next quarter or overtime and resets the clock |
| ◀ Period label | Corrects the period label only |
| Overlay: ON AIR / HIDDEN | Shows or hides the whole scorebug |
| Top-left logos: ON / OFF | Shows or hides the rotating identity logos |
| Setup | Team dropdowns, stripe colours, minutes per quarter, RESET GAME |

Keyboard shortcuts: **Space** starts or stops the clock, **R** resets the shot clock to 24,
**F** resets it to 14.

## Game rules built in

FIBA defaults:

- 10-minute quarters (adjustable in Setup) and 5-minute overtime
- BONUS appears for a team once its opponent has 5 team fouls
- Fouls reset each quarter and carry from the 4th quarter into overtime
- Timeouts: 2 in the first half, 3 in the second half, 1 per overtime
- When the shot clock reaches 0 the game clock stops

## How it works

- `server.js` serves the pages and holds the game state. The clock ticks on the server, so
  reloading the browser source never loses or drifts the time.
- `overlay.html` and `control.html` connect over WebSocket and reconnect automatically.
- The game is saved to `state.json`, so restarting the server keeps the score. The clock
  comes back paused.
- `brand.css` holds the colour palette.
- Append `?bg=1` to the overlay address to preview it over a test backdrop in a normal
  browser.

The server window also logs each page that connects and any script errors a page reports,
which helps when a browser source is not showing.

## Project files

| File | Purpose |
|---|---|
| `server.js` | Web server, WebSocket relay, game clock |
| `overlay.html` | The scorebug shown on stream |
| `control.html` | The operator's control panel |
| `brand.css` | Colour and font variables |
| `logo/` | One logo per team; file name = team name |
| `pictu/` | Identity logos that rotate at the top left |
| `logo-cutout.js` | Removes white logo backgrounds and scales large images down |
| `cropped-Lopez-Quezon-FINAL-1.png` | Lopez seal, shown in the control panel header |
| `CLAUDE.md` | Design rules and conventions for working on this project |
