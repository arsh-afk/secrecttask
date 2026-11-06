// client.js – shared logic for player UI (index.html)
// Utility to read/write a cookie
function getCookie(name) {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}
function setCookie(name, value, days = 365) {
  const expires = new Date(Date.now() + days*864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/`;
}

// Ensure we have a stable userId
let userId = getCookie('userId');
if (!userId) {
  userId = `user-${crypto.randomUUID()}`;
  setCookie('userId', userId);
}

// Connect to the server via Socket.io
const socket = io({ auth: { userId } });

let startTime = null; // will be set when server sends state

socket.on('connect', () => console.log('🔗 connected'));
socket.on('state', (state) => {
  // Populate score
  document.getElementById('score').textContent = state.score ?? 0;
  // Record startTime if not already set (first load)
  if (state.startTime) startTime = state.startTime;
});
socket.on('stateUpdate', ({ userId: uid, state }) => {
  if (uid === userId) {
    document.getElementById('score').textContent = state.score ?? 0;
  }
  // Refresh lobby list if needed (handled separately)
});
socket.on('message', ({ from, text }) => {
  const p = document.createElement('p');
  p.textContent = `${from}: ${text}`;
  document.getElementById('status').appendChild(p);
});

function earnPoint() {
  const cur = parseInt(document.getElementById('score').textContent) || 0;
  const newScore = cur + 1;
  socket.emit('update', { score: newScore });
}

function completeGame() {
  if (!startTime) startTime = Date.now(); // fallback safety
  const completionTime = Date.now() - startTime;
  socket.emit('update', { completionTime });
  document.getElementById('status').textContent = `✅ Completed in ${completionTime} ms`;
}

// ---------- Lobby utilities (fuzzy search) ----------
function refreshLobby() {
  // fetch all sessions (excluding admin) via a simple HTTP call
  fetch('/sessions')
    .then(r => r.json())
    .then(data => renderPlayers(data))
    .catch(err => console.error('Lobby fetch error', err));
}
function renderPlayers(players) {
  const container = document.getElementById('players');
  container.innerHTML = '';
  players.forEach(p => {
    const div = document.createElement('div');
    div.className = 'player';
    div.textContent = `${p.userId} – score: ${p.score}`;
    if (p.userId === userId) div.classList.add('highlight');
    container.appendChild(div);
  });
}
function filterPlayers() {
  const term = document.getElementById('search').value.trim().toLowerCase();
  const cards = document.querySelectorAll('#players .player');
  cards.forEach(c => {
    const txt = c.textContent.toLowerCase();
    c.style.display = txt.includes(term) ? '' : 'none';
  });
}
// Initial load
refreshLobby();

