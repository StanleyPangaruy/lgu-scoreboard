const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const STATE_FILE = path.join(__dirname, 'state.json');
const TICK_MS = 100;
const OT_LENGTH_SEC = 300;
const BONUS_FOULS = 5;

// Only these files are ever served.
const FILES = {
  '/': ['control.html', 'text/html; charset=utf-8'],
  '/control.html': ['control.html', 'text/html; charset=utf-8'],
  '/overlay.html': ['overlay.html', 'text/html; charset=utf-8'],
  '/brand.css': ['brand.css', 'text/css; charset=utf-8'],
  '/logo.png': ['cropped-Lopez-Quezon-FINAL-1.png', 'image/png'],
};

function newTeam(name, abbr, color) {
  return { name, abbr, color, score: 0, fouls: 0, timeouts: 2 };
}

function newGame(prev) {
  const keep = (side, name, abbr, color) =>
    prev ? newTeam(prev[side].name, prev[side].abbr, prev[side].color) : newTeam(name, abbr, color);
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
    possession: null,
    bonusFouls: BONUS_FOULS,
  };
}

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return { ...newGame(), ...saved, clockRunning: false, bonusFouls: BONUS_FOULS };
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
// FIBA: 2 timeouts in the first half, 3 in the second, 1 per overtime.
const timeoutsFor = (period) => (period > 4 ? 1 : period >= 3 ? 3 : 2);

function stopClock() {
  state.clockRunning = false;
}

function startClock() {
  if (state.gameClockMs <= 0) return;
  if (state.shotClockVisible && state.shotClockMs <= 0) state.shotClockMs = 24000;
  state.clockRunning = true;
  lastTick = Date.now();
}

const actions = {
  score({ team, delta }) {
    state[team].score = clamp(state[team].score + delta, 0, 999);
  },
  fouls({ team, delta }) {
    state[team].fouls = clamp(state[team].fouls + delta, 0, 99);
  },
  timeouts({ team, delta }) {
    state[team].timeouts = clamp(state[team].timeouts + delta, 0, 3);
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
  nextPeriod() {
    stopClock();
    state.period = clamp(state.period + 1, 1, 9);
    state.gameClockMs = periodLengthMs(state.period);
    state.shotClockMs = 24000;
    // Team fouls reset each quarter; overtime continues the 4th quarter's count.
    if (state.period <= 4) state.home.fouls = state.away.fouls = 0;
    if (state.period === 3 || state.period > 4) {
      state.home.timeouts = state.away.timeouts = timeoutsFor(state.period);
    }
  },
  // Label correction only: does not touch clock, fouls or timeouts.
  prevPeriod() {
    state.period = clamp(state.period - 1, 1, 9);
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

const TEAM_ACTIONS = new Set(['score', 'fouls', 'timeouts', 'team']);
const NUMERIC_FIELDS = ['delta', 'deltaMs', 'ms', 'seconds'];

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

const server = http.createServer((req, res) => {
  const entry = FILES[req.url.split('?')[0]];
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
