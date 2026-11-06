// server.js – Node.js + Express + Socket.io backend for the Warden game
import express from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import cookieParser from "cookie-parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cookieParser());
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: "*" } // Adjust in production
});

const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));

// ---------- Simple JSON persistence ----------
// In addition to generic session data we now also store `startTime`
// (timestamp of first connection) and `completionTime` (ms elapsed).
// This enables ranking of the fastest completion.

const SESSIONS_FILE = path.join(__dirname, "data", "sessions.json");
let sessions = {};
function loadSessions() {
  try { sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf-8")); }
  catch { sessions = {}; }
}
function saveSessions() {
  fs.mkdirSync(path.dirname(SESSIONS_FILE), { recursive: true });
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}
loadSessions();

// ---------- Socket authentication ----------
// ---------- Socket authentication ----------
io.use((socket, next) => {
  const { userId } = socket.handshake.auth;
  if (!userId) return next(new Error("missing userId"));
  socket.data.userId = userId;
  // Load persisted state; if none, initialise with startTime now.
  const persisted = sessions[userId];
  if (persisted) {
    socket.data.state = persisted;
  } else {
    socket.data.state = { score: 0, role: "player", startTime: Date.now() };
    sessions[userId] = socket.data.state;
    saveSessions();
  }
  next();
});


io.on("connection", (socket) => {
  const { userId, state } = socket.data;
  console.log(`🟢 ${userId} connected as ${state.role}`);

  // Join correct room
  if (state.role === "admin") socket.join("admin");
  else socket.join("game");

  // Send current state to the client
  socket.emit("state", state);

  // ----- Game actions -----
  socket.on("update", (payload) => {
    Object.assign(state, payload);
    sessions[userId] = state;
    saveSessions();
    socket.to(state.role === "admin" ? "admin" : "game")
          .emit("stateUpdate", { userId, state });
  });

  // ----- Admin commands -----
  socket.on("kick", (targetUserId) => {
    const target = Array.from(io.sockets.sockets.values())
                      .find(s => s.data.userId === targetUserId);
    if (target) target.disconnect(true);
  });

  socket.on("broadcast", (msg) => {
    io.to("game").emit("message", { from: "admin", text: msg });
  });

  socket.on("disconnect", () => {
    console.log(`🔴 ${userId} disconnected`);
    // state stays persisted
  });
});

// ---------- Sessions endpoint (for lobby fuzzy search)
app.get("/sessions", (req, res) => {
  const list = Object.entries(sessions)
    .filter(([, s]) => s.role !== "admin")
    .map(([id, s]) => ({ userId: id, score: s.score ?? 0 }))
    .sort((a, b) => b.score - a.score); // highest score first
  res.json(list);
});


// ---------- Rankings endpoint ----------
app.get("/rankings", (req, res) => {
  // Return players sorted by fastest completion time (ms)
  const rankings = Object.entries(sessions)
    .filter(([, s]) => s.role !== "admin" && typeof s.completionTime === "number")
    .map(([id, s]) => ({ userId: id, completionTime: s.completionTime, score: s.score }))
    .sort((a, b) => a.completionTime - b.completionTime);
  res.json(rankings);
});

const PORT = process.env.PORT ?? 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server listening on http://localhost:${PORT}`);
});

