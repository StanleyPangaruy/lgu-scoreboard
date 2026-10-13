const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
// STATE_FILE can be overridden to run a throwaway test copy beside the live server.
const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, 'state.json');
const LOGO_DIR = path.join(__dirname, 'logo');
// Station identity logos, shown in rotation at the top left of the overlay.
const IDENTITY_DIR = path.join(__dirname, 'pictu');
const TICK_MS = 100;
const OT_LENGTH_SEC = 300;
const BONUS_FOULS = 5;

// Only these files are ever served.
const FILES = {
  '/': ['control.html', 'text/html; charset=utf-8'],
  '/control.html': ['control.html', 'text/html; charset=utf-8'],
  '/overlay.html': ['overlay.html', 'text/html; charset=utf-8'],
  '/mini.html': ['mini.html', 'text/html; charset=utf-8'],
  '/brand.css': ['brand.css', 'text/css; charset=utf-8'],
  '/logo-cutout.js': ['logo-cutout.js', 'text/javascript; charset=utf-8'],
  '/identity.js': ['identity.js', 'text/javascript; charset=utf-8'],
  '/logo.png': ['cropped-Lopez-Quezon-FINAL-1.png', 'image/png'],
};

const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

// Every image in logo/ is a team. "san_antonio.png" becomes "SAN ANTONIO".
function scanTeams() {
  let files = [];
  try {
    files = fs.readdirSync(LOGO_DIR);
  } catch {
    return [];
  }
  const list = files
    .filter((file) => IMAGE_TYPES[path.extname(file).toLowerCase()])
    .map((file) => {
      const id = path.basename(file, path.extname(file));
      const name = id.replace(/[_-]+/g, ' ').trim().toUpperCase();
      return { id, name, abbr: defaultAbbr(name) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  // Teams that would share an abbreviation (LUCBAN, LUCENA) use first letter + consonants.
  for (const t of list) {
    if (list.filter((o) => o.abbr === t.abbr).length > 1) {
      const letters = t.name.replace(/[^A-Z]/g, '');
      t.abbr = (letters[0] + letters.slice(1).replace(/[AEIOU]/g, '')).slice(0, 3);
    }
  }
  return list.map((t) => ({ ...t, logo: files.find((f) => path.basename(f, path.extname(f)) === t.id) }));
}

// GUMACA -> GUM, SAN ANTONIO -> SAN, SAN FRANCISCO -> SFR (first letter + start of last word).
function defaultAbbr(name) {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length < 2) return name.slice(0, 3);
  return (words[0][0] + words[words.length - 1].slice(0, 2)).toUpperCase();
}

let teams = scanTeams();

function scanIdentity() {
  try {
    return fs.readdirSync(IDENTITY_DIR)
      .filter((file) => IMAGE_TYPES[path.extname(file).toLowerCase()])
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

let identity = scanIdentity();

const MAX_TIMEOUTS = 20;

function newTeam(name, abbr, color, logo = null, timeouts = 2) {
  return { name, abbr, color, logo, score: 0, fouls: 0, timeouts };
}

function newGame(prev) {
  // How many timeouts each team starts with. The operator sets this; the server never
  // changes a team's timeouts by itself (no automatic refill at half-time or overtime).
  const timeoutsTotal = prev ? prev.timeoutsTotal : 2;
  const keep = (side, name, abbr, color) =>
    prev
      ? newTeam(prev[side].name, prev[side].abbr, prev[side].color, prev[side].logo, timeoutsTotal)
      : newTeam(name, abbr, color, null, timeoutsTotal);
  const periodLengthSec = prev ? prev.periodLengthSec : 600;
  return {
    visible: prev ? prev.visible : true,
    home: keep('home', 'HOME', 'HOM', '#0E91F8'),
    away: keep('away', 'AWAY', 'AWY', '#E5202B'),
    period: 1,
    periodLengthSec,
    gameClockMs: periodLengthSec * 1000,
    clockRunning: false,
    shotClockMs: 24000,
    shotClockVisible: prev ? prev.shotClockVisible : true,
    identityVisible: prev ? prev.identityVisible : true,
    miniVisible: prev ? prev.miniVisible : true,
    title: prev ? prev.title : 'Quezon Intertown Basketball Tournament 2026',
    // Scoring run, e.g. "12-2 run in the last 3:10". Worked out by findRun() from scoreLog;
    // it pops up on the mini scoreboard by itself (runVisible) each time the running team
    // scores, once the run has reached runThreshold points. runAuto switches that off.
    run: { team: null, points: 0, against: 0, startAt: 0 },
    runVisible: false,
    runAuto: prev ? prev.runAuto : true,
    runThreshold: prev ? prev.runThreshold : 7,
    timeoutsTotal,
    timeoutsVisible: prev ? prev.timeoutsVisible : true,
    playedMs: 0,   // total game-clock time played so far
    scoreLog: [],  // recent baskets: { team, pts, at } where `at` is playedMs when it was scored
    possession: null,
    bonusFouls: BONUS_FOULS,
  };
}

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return { ...newGame(), ...saved, clockRunning: false, runVisible: false, bonusFouls: BONUS_FOULS };
  } catch {
    return newGame();
  }
}

let state = loadState();
let lastTick = Date.now();

function save() {
  fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), () => {});
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const periodLengthMs = (period) => (period > 4 ? OT_LENGTH_SEC : state.periodLengthSec) * 1000;

function stopClock() {
  state.clockRunning = false;
}

function startClock() {
  if (state.gameClockMs <= 0) return;
  if (state.shotClockVisible && state.shotClockMs <= 0) state.shotClockMs = 24000;
  state.clockRunning = true;
  lastTick = Date.now();
}

// A run is the points one team has scored since the other team last scored. A basket by the
// other team starts a new run for them; a score correction (-1) comes off the current run.
const SCORE_LOG_MAX = 60;

// The current run is the most recent stretch of baskets, ending now, in which one team has
// outscored the other by the widest margin, as on NBA broadcasts ("12-2 run"). The stretch
// starts with a basket by the running team, and the other team may have scored a little
// inside it, but no more than a third of the running team's points: 12-2 and 12-4 are runs,
// 9-4 is not. Its clock time is measured from the basket just before the run began.
function findRun() {
  const log = state.scoreLog;
  const none = { team: null, points: 0, against: 0, startAt: 0 };
  let best = none;
  const pts = { home: 0, away: 0 };
  for (let i = log.length - 1; i >= 0; i--) {
    pts[log[i].team] += log[i].pts;
    const team = log[i].team;
    const other = team === 'home' ? 'away' : 'home';
    if (pts[other] * 3 > pts[team]) continue;
    const margin = pts[team] - pts[other];
    // On a tie the shorter, more recent stretch wins, so only a wider margin replaces it.
    if (margin > best.points - best.against) {
      best = { team, points: pts[team], against: pts[other], startAt: i > 0 ? log[i - 1].at : 0 };
    }
  }
  return best;
}

function trackRun(team, change) {
  if (change === 0) return;
  const log = state.scoreLog;
  if (change > 0) {
    log.push({ team, pts: change, at: state.playedMs });
    if (log.length > SCORE_LOG_MAX) log.shift();
  } else {
    // A correction comes off that team's most recent basket.
    let owed = -change;
    for (let i = log.length - 1; i >= 0 && owed > 0; i--) {
      if (log[i].team !== team) continue;
      const take = Math.min(owed, log[i].pts);
      log[i].pts -= take;
      owed -= take;
      if (log[i].pts === 0) log.splice(i, 1);
    }
  }
  state.run = findRun();
  announceRun(team, change);
}

const RUN_SHOW_MS = 15000;
let runTimer = null;

// The run graphic appears by itself: each time the running team scores while the run is
// worth runThreshold points or more, it shows for RUN_SHOW_MS and then goes away again.
// "Worth" is the margin, so with the default of 7 a 7-0 mini-run counts and so do 9-2, 12-2
// and 15-4, but 8-2 (only six points better) does not.
function announceRun(team, change) {
  clearTimeout(runTimer);
  const run = state.run;
  const earned = state.runAuto && state.runThreshold > 0 && !!run.team &&
    run.points - run.against >= state.runThreshold;
  if (!earned) {
    state.runVisible = false;
    return;
  }
  if (change > 0 && team === run.team) state.runVisible = true;
  if (!state.runVisible) return;
  runTimer = setTimeout(() => {
    state.runVisible = false;
    save();
    broadcast();
  }, RUN_SHOW_MS);
}

// A save file from before run tracking has no basket log, so start its run afresh.
state.run = findRun();

const actions = {
  score({ team, delta }) {
    const before = state[team].score;
    state[team].score = clamp(before + delta, 0, 999);
    trackRun(team, state[team].score - before);
  },
  runAuto({ value }) {
    state.runAuto = !!value;
    if (!state.runAuto) {
      clearTimeout(runTimer);
      state.runVisible = false;
    }
  },
  runThreshold({ points }) {
    state.runThreshold = clamp(Math.round(points), 0, 99);
  },
  fouls({ team, delta }) {
    state[team].fouls = clamp(state[team].fouls + delta, 0, 99);
  },
  timeouts({ team, delta }) {
    state[team].timeouts = clamp(state[team].timeouts + delta, 0, MAX_TIMEOUTS);
  },
  // Sets the starting number and gives both teams that many.
  timeoutsTotal({ count }) {
    state.timeoutsTotal = clamp(Math.round(count), 0, MAX_TIMEOUTS);
    state.home.timeouts = state.away.timeouts = state.timeoutsTotal;
  },
  timeoutsVisible({ value }) {
    state.timeoutsVisible = !!value;
  },
  clock({ run }) {
    const want = run === 'toggle' ? !state.clockRunning : !!run;
    if (want) startClock();
    else stopClock();
  },
  adjustClock({ deltaMs }) {
    state.gameClockMs = clamp(state.gameClockMs + deltaMs, 0, 99 * 60000);
  },
  setClock({ ms }) {
    state.gameClockMs = clamp(ms, 0, 99 * 60000);
  },
  shot({ seconds }) {
    state.shotClockMs = clamp(seconds, 0, 24) * 1000;
  },
  shotVisible({ value }) {
    state.shotClockVisible = !!value;
  },
  possession({ value }) {
    state.possession = value === 'home' || value === 'away' ? value : null;
  },
  visible({ value }) {
    state.visible = !!value;
  },
  identityVisible({ value }) {
    state.identityVisible = !!value;
  },
  title({ text }) {
    if (typeof text === 'string') state.title = text.trim().slice(0, 80);
  },
  miniVisible({ value }) {
    state.miniVisible = !!value;
  },
  nextPeriod() {
    stopClock();
    state.period = clamp(state.period + 1, 1, 9);
    state.gameClockMs = periodLengthMs(state.period);
    state.shotClockMs = 24000;
    // Team fouls reset each quarter; overtime continues the 4th quarter's count.
    if (state.period <= 4) state.home.fouls = state.away.fouls = 0;
  },
  // Label correction only: does not touch clock, fouls or timeouts.
  prevPeriod() {
    state.period = clamp(state.period - 1, 1, 9);
  },
  pickTeam({ team, id }) {
    const pick = teams.find((t) => t.id === id);
    if (!pick) return;
    Object.assign(state[team], { name: pick.name, abbr: pick.abbr, logo: pick.logo });
  },
  team({ team, name, abbr, color }) {
    const t = state[team];
    if (typeof name === 'string') t.name = name.trim().slice(0, 24) || t.name;
    if (typeof abbr === 'string') t.abbr = abbr.trim().toUpperCase().slice(0, 4) || t.abbr;
    if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) t.color = color;
  },
  periodLength({ seconds }) {
    state.periodLengthSec = clamp(Math.round(seconds), 60, 20 * 60);
    if (!state.clockRunning && state.period <= 4) state.gameClockMs = state.periodLengthSec * 1000;
  },
  resetGame() {
    state = newGame(state);
  },
};

const TEAM_ACTIONS = new Set(['score', 'fouls', 'timeouts', 'team', 'pickTeam']);
const NUMERIC_FIELDS = ['delta', 'deltaMs', 'ms', 'seconds', 'points', 'count'];

function handle(msg) {
  const fn = Object.hasOwn(actions, msg.action) ? actions[msg.action] : null;
  if (!fn) return;
  if (TEAM_ACTIONS.has(msg.action) && msg.team !== 'home' && msg.team !== 'away') return;
  for (const f of NUMERIC_FIELDS) {
    if (f in msg && !Number.isFinite(msg[f])) return;
  }
  fn(msg);
  save();
  broadcast();
}

// Only files found by scanning the folder are served, so no path tricks reach the disk.
function serveImage(urlPath, prefix, dir, allowed, res) {
  let file;
  try {
    file = decodeURIComponent(urlPath.slice(prefix.length));
  } catch {
    file = '';
  }
  if (!allowed.includes(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  fs.readFile(path.join(dir, file), (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  if (urlPath.startsWith('/logos/')) {
    return serveImage(urlPath, '/logos/', LOGO_DIR, teams.map((t) => t.logo), res);
  }
  if (urlPath.startsWith('/identity/')) {
    return serveImage(urlPath, '/identity/', IDENTITY_DIR, identity, res);
  }
  const entry = FILES[urlPath];
  if (!entry) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  fs.readFile(path.join(__dirname, entry[0]), (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      return res.end('Could not read file');
    }
    res.writeHead(200, { 'Content-Type': entry[1], 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

function broadcast() {
  const payload = JSON.stringify({ type: 'state', state });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(payload);
  }
}

wss.on('connection', (ws, req) => {
  console.log(`[connect] ${req.headers['user-agent']}`);
  // Re-read logo/ so logos added while the server runs show up on the next page load.
  teams = scanTeams();
  identity = scanIdentity();
  ws.send(JSON.stringify({ type: 'teams', teams }));
  ws.send(JSON.stringify({ type: 'identity', files: identity }));
  ws.send(JSON.stringify({ type: 'state', state }));
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      // Pages report their viewport and any script errors here for troubleshooting.
      if (msg && msg.type === 'log') return console.log(`[page] ${String(msg.text).slice(0, 500)}`);
      if (msg && typeof msg === 'object') handle(msg);
    } catch {
      // ignore malformed messages
    }
  });
});

// The clock lives here so an OBS source reload never loses or drifts it.
setInterval(() => {
  if (!state.clockRunning) return;
  const now = Date.now();
  const dt = now - lastTick;
  lastTick = now;
  state.playedMs += Math.min(dt, state.gameClockMs);
  state.gameClockMs = Math.max(0, state.gameClockMs - dt);
  if (state.shotClockVisible) state.shotClockMs = Math.max(0, state.shotClockMs - dt);
  if (state.gameClockMs === 0 || (state.shotClockVisible && state.shotClockMs === 0)) {
    stopClock();
    save();
  }
  broadcast();
}, TICK_MS);

server.listen(PORT, () => {
  console.log('\nLopez basketball overlay is running.\n');
  console.log(`  OBS Browser Source : http://localhost:${PORT}/overlay.html  (1920x1080)`);
  console.log(`  Mini scoreboard    : http://localhost:${PORT}/mini.html  (1920x1080)`);
  console.log(`  Control panel      : http://localhost:${PORT}/control.html`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`  Phone / tablet     : http://${net.address}:${PORT}/control.html`);
      }
    }
  }
  console.log('\nPress Ctrl+C to stop.\n');
});
