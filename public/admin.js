// admin.js – admin console logic
// Cookies are set by /admin-login, so we just read userId.
function getCookie(name) {
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}
const userId = getCookie('userId');

const socket = io({ auth: { userId } });

socket.on('connect', () => console.log('🔗 admin socket connected'));
socket.on('state', (state) => console.log('👤 admin state:', state));
socket.on('stateUpdate', data => {
  const log = document.getElementById('log');
  log.textContent += JSON.stringify(data) + "\n";
});
socket.on('message', ({ from, text }) => {
  const log = document.getElementById('log');
  log.textContent += `${from}: ${text}\n`;
});

function broadcast() {
  const msg = document.getElementById('msg').value;
  socket.emit('broadcast', msg);
}
function kick() {
  const uid = document.getElementById('kickId').value;
  socket.emit('kick', uid);
}

