// server.js – Node.js + Express + Socket.io backend for Operation Stealth
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from public/
app.use(express.static(path.join(__dirname, 'public')));

// ──────────────────────────────────────────────
// CENTRAL GAME STATE (persisted to JSON file)
// ──────────────────────────────────────────────
const STATE_FILE = path.join(__dirname, 'data', 'state.json');

let gameState = {
  challenges: [],
  roster: [],
  assignments: {},   // playerName -> { id, challenge, status }
  isDistributed: false,
  deductionsLog: [],
  completionTimes: {}, // playerName -> timestamp
  distributedAt: null
};

function loadState() {
  try {
    gameState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    // First run – use defaults
  }
}

function saveState() {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(gameState, null, 2));
}

loadState();

// Track online sockets: socketId -> { userId, playerName }
const clients = new Map();

// ──────────────────────────────────────────────
// SOCKET.IO
// ──────────────────────────────────────────────
io.on('connection', (socket) => {
  const userId = socket.handshake.auth.userId || socket.id;
  const storedName = socket.handshake.auth.playerName || null;

  clients.set(socket.id, { userId, playerName: storedName });
  console.log(`🟢 ${userId} connected (${storedName || 'no name yet'})`);

  // Send full state immediately
  socket.emit('gameState', gameState);
  broadcastOnline();

  // ── Player actions ──────────────────────────

  socket.on('playerJoin', (name) => {
    if (!name || typeof name !== 'string') return;
    name = name.trim();
    const client = clients.get(socket.id);
    if (client) client.playerName = name;

    if (!gameState.roster.includes(name)) {
      gameState.roster.push(name);
    }
    saveState();
    io.emit('gameState', gameState);
    broadcastOnline();
  });

  socket.on('playerLeave', () => {
    const client = clients.get(socket.id);
    if (client) client.playerName = null;
    broadcastOnline();
  });

  socket.on('markComplete', (playerName) => {
    if (!playerName || !gameState.assignments[playerName]) return;
    gameState.assignments[playerName].status = 'completed';
    if (!gameState.completionTimes[playerName]) {
      gameState.completionTimes[playerName] = Date.now();
    }
    saveState();
    io.emit('gameState', gameState);
  });

  // ── Guess / deduction ──────────────────────

  socket.on('submitGuess', (data) => {
    if (!data || !data.target || !data.guessText) return;
    const targetAssignment = gameState.assignments[data.target];
    if (!targetAssignment) {
      socket.emit('guessResult', { error: true });
      return;
    }

    const matchScore = fuzzyScore(data.guessText, targetAssignment.challenge);
    const isMatch = matchScore >= 0.45;

    const logEntry = {
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      guesser: data.guesser || 'Anonymous',
      target: data.target,
      guessText: data.guessText,
      success: isMatch,
      score: Math.round(matchScore * 100)
    };
    gameState.deductionsLog.unshift(logEntry);
    saveState();

    socket.emit('guessResult', {
      isMatch,
      score: Math.round(matchScore * 100),
      actualTask: isMatch ? targetAssignment.challenge : null,
      target: data.target
    });
    io.emit('gameState', gameState);
  });

  // ── Admin actions ──────────────────────────

  socket.on('parseChallenges', (raw) => {
    if (typeof raw !== 'string') return;
    gameState.challenges = raw.split('\n').map(l => l.trim()).filter(Boolean);
    saveState();
    io.emit('gameState', gameState);
  });

  socket.on('saveRoster', (raw) => {
    if (typeof raw !== 'string') return;
    gameState.roster = raw.split('\n').map(n => n.trim()).filter(Boolean);
    saveState();
    io.emit('gameState', gameState);
  });

  socket.on('distribute', () => {
    if (!gameState.challenges.length || !gameState.roster.length) return;

    const shuffled = [...gameState.challenges].sort(() => Math.random() - 0.5);
    gameState.assignments = {};
    gameState.completionTimes = {};
    gameState.distributedAt = Date.now();

    gameState.roster.forEach((player, idx) => {
      gameState.assignments[player] = {
        id: `#${(idx + 1).toString().padStart(2, '0')}`,
        challenge: shuffled[idx % shuffled.length],
        status: 'pending'
      };
    });

    gameState.isDistributed = true;
    saveState();
    io.emit('gameState', gameState);
  });

  socket.on('updateStatus', ({ player, status }) => {
    if (!player || !gameState.assignments[player]) return;
    gameState.assignments[player].status = status;
    saveState();
    io.emit('gameState', gameState);
  });

  socket.on('resetGame', () => {
    gameState.assignments = {};
    gameState.isDistributed = false;
    gameState.deductionsLog = [];
    gameState.completionTimes = {};
    gameState.distributedAt = null;
    saveState();
    io.emit('gameState', gameState);
  });

  socket.on('adminBroadcast', (msg) => {
    io.emit('adminMessage', msg);
  });

  socket.on('disconnect', () => {
    console.log(`🔴 ${userId} disconnected`);
    clients.delete(socket.id);
    broadcastOnline();
  });
});

function broadcastOnline() {
  const names = new Set();
  for (const [, c] of clients) {
    if (c.playerName) names.add(c.playerName);
  }
  io.emit('onlinePlayers', { count: names.size, names: [...names] });
}

// ──────────────────────────────────────────────
// REST: Rankings (Time + Deduction Penalty)
// ──────────────────────────────────────────────
app.get('/api/rankings', (_req, res) => {
  if (!gameState.distributedAt) return res.json([]);

  const PENALTY_PER_DETECTION_MS = 60 * 1000; // +60s penalty per person who deduced your task

  const rankings = Object.entries(gameState.completionTimes)
    .map(([player, time]) => {
      const rawMs = time - gameState.distributedAt;

      // Unique operatives who deduced this player's task
      const detectedBy = new Set(
        gameState.deductionsLog
          .filter(log => log.target === player && log.success)
          .map(log => log.guesser)
      );

      const timesCompromised = detectedBy.size;
      const penaltyMs = timesCompromised * PENALTY_PER_DETECTION_MS;
      const adjustedMs = rawMs + penaltyMs;

      return {
        player,
        rawMs,
        timesCompromised,
        penaltyMs,
        adjustedMs,
        detectedBy: [...detectedBy],
        assignment: gameState.assignments[player]
      };
    })
    .sort((a, b) => a.adjustedMs - b.adjustedMs);

  res.json(rankings);
});

// ──────────────────────────────────────────────
// Fuzzy matching (same algo as the original client)
// ──────────────────────────────────────────────
function fuzzyScore(guess, target) {
  const clean = s => s.toLowerCase().replace(/[^\w\s]/g, '').trim();
  const g = clean(guess), t = clean(target);
  if (!g || !t) return 0;
  if (g === t) return 1;

  const gTok = g.split(/\s+/);
  let hits = 0;
  gTok.forEach(tok => { if (tok.length > 2 && t.includes(tok)) hits++; });
  const tokScore = hits / Math.max(gTok.length, 1);

  const d = levenshtein(g, t);
  const levScore = 1 - d / Math.max(g.length, t.length);

  return tokScore * 0.7 + levScore * 0.3;
}

function levenshtein(a, b) {
  const m = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) m[i][0] = i;
  for (let j = 0; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const c = a[i - 1] === b[j - 1] ? 0 : 1;
      m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + c);
    }
  return m[a.length][b.length];
}

// ──────────────────────────────────────────────
// START
// ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});
