const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// تنظیمات Middleware با قابلیت دریافت فایل‌های بزرگ (عکس و وویس)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// باز شدن خودکار صفحه ورود در ریشه سایت
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// اتصال به دیتابیس SQLite
const db = new sqlite3.Database('./database.db', (err) => {
  if (err) {
    console.error('خطا در اتصال به دیتابیس:', err.message);
  } else {
    console.log('با موفقیت به دیتابیس SQLite متصل شد.');
  }
});

// ساخت جدول کاربران و پیام‌ها (اضافه شدن ستون وضعیت و آخرین بازدید)
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      email TEXT,
      phone TEXT,
      password TEXT,
      gender TEXT,
      profilePic TEXT,
      bio TEXT,
      status TEXT DEFAULT 'offline',
      lastSeen DATETIME
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender TEXT,
      receiver TEXT,
      message TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// مسیرهای API
app.post('/api/register', (req, res) => {
  const { username, email, phone, password, gender } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'نام کاربری و رمز عبور الزامی است.' });
  }

  const stmt = db.prepare('INSERT INTO users (username, email, phone, password, gender, status) VALUES (?, ?, ?, ?, ?, ?)');
  stmt.run(username, email, phone, password, gender, 'offline', function (err) {
    if (err) {
      return res.status(400).json({ error: 'این نام کاربری قبلاً ثبت شده است.' });
    }
    res.json({ 
      success: true, 
      message: 'ثبت‌نام با موفقیت انجام شد.',
      user: { username, gender } 
    });
  });
  stmt.finalize();
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT username, gender, profilePic, bio, status, lastSeen FROM users WHERE username = ? AND password = ?', [username, password], (err, row) => {
    if (err || !row) {
      return res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است.' });
    }
    res.json({ success: true, user: row });
  });
});

app.post('/api/update-profile', (req, res) => {
  const { username, profilePic, bio } = req.body;
  
  db.run(
    'UPDATE users SET profilePic = ?, bio = ? WHERE username = ?',
    [profilePic, bio, username],
    function (err) {
      if (err) {
        return res.status(500).json({ error: 'خطا در ذخیره اطلاعات پروفایل در دیتابیس.' });
      }
      db.get('SELECT username, gender, profilePic, bio, status, lastSeen FROM users WHERE username = ?', [username], (err, row) => {
        if (err || !row) {
          return res.status(404).json({ error: 'کاربر یافت نشد.' });
        }
        res.json({ success: true, user: row });
      });
    }
  );
});

app.get('/api/users', (req, res) => {
  db.all('SELECT username, gender, profilePic, bio, status, lastSeen FROM users', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'خطا در دریافت لیست کاربران.' });
    }
    res.json(rows);
  });
});

app.get('/api/messages/:user1/:user2', (req, res) => {
  const { user1, user2 } = req.params;
  db.all(
    `SELECT * FROM messages 
     WHERE (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?) 
     ORDER BY timestamp ASC`,
     [user1, user2, user2, user1],
     (err, rows) => {
       if (err) {
         return res.status(500).json({ error: 'خطا در دریافت پیام‌ها.' });
       }
       res.json(rows);
     }
  );
});

// Socket.IO برای مدیریت آنلاین/آفلاین، پیام‌ها و وویس‌ها
const userSockets = {};

io.on('connection', (socket) => {
  socket.on('register_user', (username) => {
    if (!username) return;
    userSockets[username] = socket.id;
    
    // آپدیت وضعیت کاربر به آنلاین در دیتابیس
    db.run('UPDATE users SET status = ? WHERE username = ?', ['online', username], () => {
      io.emit('user_status_changed', { username, status: 'online' });
    });
  });

  socket.on('send_private_message', (data) => {
    const { sender, receiver, message } = data;
    const stmt = db.prepare('INSERT INTO messages (sender, receiver, message) VALUES (?, ?, ?)');
    stmt.run(sender, receiver, message, function (err) {
      if (!err) {
        const receiverSocketId = userSockets[receiver];
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('receive_private_message', data);
        }
        socket.emit('message_sent', data);
      }
    });
    stmt.finalize();
  });

  socket.on('disconnect', () => {
    let disconnectedUser = null;
    for (const username in userSockets) {
      if (userSockets[username] === socket.id) {
        disconnectedUser = username;
        delete userSockets[username];
        break;
      }
    }

    if (disconnectedUser) {
      const now = new Date().toISOString();
      // آپدیت وضعیت به آفلاین و ثبت آخرین بازدید در دیتابیس
      db.run('UPDATE users SET status = ?, lastSeen = ? WHERE username = ?', ['offline', now, disconnectedUser], () => {
        io.emit('user_status_changed', { username: disconnectedUser, status: 'offline', lastSeen: now });
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
