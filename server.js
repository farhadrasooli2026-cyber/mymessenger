const fs = require('fs');
const http = require('http');
const path = require('path');

const express = require('express');
const helmet = require('helmet');
const { Server } = require('socket.io');

const { PORT, USERNAME_RE, publicDir, uploadDir } = require('./src/config');
const { db, dbRun, dbGet, initDb } = require('./src/db');
const { sanitizeText, isSafeUploadUrl } = require('./src/helpers');
const { sessionMiddleware, wrapSession } = require('./src/http/session');
const pageRoutes = require('./src/routes/pages');
const { createAuthRouter } = require('./src/routes/auth');
const userRoutes = require('./src/routes/users');
const messageRoutes = require('./src/routes/messages');
const uploadRoutes = require('./src/routes/upload');

const userSockets = new Map();
fs.mkdirSync(uploadDir, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: false },
  maxHttpBufferSize: 1e6,
});

app.disable('x-powered-by');
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);
app.use(sessionMiddleware);
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

app.use(pageRoutes);
app.use(
  '/uploads',
  express.static(uploadDir, {
    fallthrough: false,
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Cache-Control', 'private, max-age=86400');
    },
  })
);
app.use(express.static(publicDir, { index: false }));
app.use(createAuthRouter(userSockets));
app.use(userRoutes);
app.use(messageRoutes);
app.use(uploadRoutes);

function addUserSocket(username, socketId) {
  if (!userSockets.has(username)) userSockets.set(username, new Set());
  userSockets.get(username).add(socketId);
}

function removeUserSocket(username, socketId) {
  const set = userSockets.get(username);
  if (!set) return true;
  set.delete(socketId);
  if (set.size === 0) {
    userSockets.delete(username);
    return true;
  }
  return false;
}

function emitToUser(username, event, payload) {
  const set = userSockets.get(username);
  if (!set) return;
  for (const id of set) io.to(id).emit(event, payload);
}

io.use(wrapSession(sessionMiddleware));
io.use((socket, next) => {
  const user = socket.request.session && socket.request.session.user;
  if (!user || !user.username) {
    return next(new Error('unauthorized'));
  }
  socket.username = user.username;
  next();
});

io.on('connection', (socket) => {
  const username = socket.username;
  addUserSocket(username, socket.id);
  db.run('UPDATE users SET status = ? WHERE username = ?', ['online', username], () => {
    io.emit('user_status_changed', { username, status: 'online' });
  });

  socket.on('send_private_message', async (data) => {
    try {
      const receiver = sanitizeText(data && data.receiver, 32);
      const type = data && data.type === 'image' ? 'image' : data && data.type === 'audio' ? 'audio' : 'text';
      const caption = sanitizeText(data && data.caption, 500);
      let message = sanitizeText(data && data.message, 4000);

      if (!USERNAME_RE.test(receiver) || receiver === username) return;
      const exists = await dbGet('SELECT username FROM users WHERE username = ?', [receiver]);
      if (!exists) return;

      if (type === 'text') {
        if (!message) return;
      } else {
        if (!isSafeUploadUrl(message)) return;
        const filePath = path.join(uploadDir, path.basename(message));
        if (!fs.existsSync(filePath)) return;
      }

      const result = await dbRun(
        'INSERT INTO messages (sender, receiver, message, type, caption) VALUES (?, ?, ?, ?, ?)',
        [username, receiver, message, type, caption || null]
      );
      const payload = {
        id: result.lastID,
        sender: username,
        receiver,
        message,
        type,
        caption: caption || '',
        timestamp: new Date().toISOString(),
      };
      emitToUser(receiver, 'receive_private_message', payload);
      emitToUser(username, 'message_sent', payload);
    } catch (_err) {
      socket.emit('message_error', { error: 'ارسال پیام ناموفق بود.' });
    }
  });

  socket.on('typing', (data) => {
    const receiver = sanitizeText(data && data.receiver, 32);
    if (!USERNAME_RE.test(receiver)) return;
    emitToUser(receiver, 'typing', { sender: username });
  });

  socket.on('disconnect', () => {
    const wentOffline = removeUserSocket(username, socket.id);
    if (wentOffline) {
      const now = new Date().toISOString();
      db.run('UPDATE users SET status = ?, lastSeen = ? WHERE username = ?', ['offline', now, username], () => {
        io.emit('user_status_changed', { username, status: 'offline', lastSeen: now });
      });
    }
  });
});

initDb()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`MyMessenger running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Database init failed:', err);
    process.exit(1);
  });
