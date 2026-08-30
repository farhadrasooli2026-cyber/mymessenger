const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// تنظیمات Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// اتصال به دیتابیس SQLite
const db = new sqlite3.Database('./database.db', (err) => {
  if (err) {
    console.error('خطا در اتصال به دیتابیس:', err.message);
  } else {
    console.log('با موفقیت به دیتابیس SQLite متصل شد.');
  }
});

// ساخت جدول کاربران و پیام‌ها در صورت عدم وجود
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      email TEXT,
      phone TEXT,
      password TEXT,
      gender TEXT
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

// ۱. ثبت‌نام کاربر
app.post('/api/register', (req, res) => {
  const { username, email, phone, password, gender } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'نام کاربری و رمز عبور الزامی است.' });
  }

  const stmt = db.prepare('INSERT INTO users (username, email, phone, password, gender) VALUES (?, ?, ?, ?, ?)');
  stmt.run(username, email, phone, password, gender, function (err) {
    if (err) {
      return res.status(400).json({ error: 'این نام کاربری قبلاً ثبت شده است.' });
    }
    res.json({ success: true, message: 'ثبت‌نام با موفقیت انجام شد.' });
  });
  stmt.finalize();
});

// ۲. ورود کاربر
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get('SELECT * FROM users WHERE username = ? AND password = ?', [username, password], (err, row) => {
    if (err || !row) {
      return res.status(401).json({ error: 'نام کاربری یا رمز عبور اشتباه است.' });
    }
    res.json({ success: true, user: { username: row.username, gender: row.gender } });
  });
});

// ۳. دریافت لیست کاربران
app.get('/api/users', (req, res) => {
  db.all('SELECT username, gender FROM users', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'خطا در دریافت لیست کاربران.' });
    }
    res.json(rows);
  });
});

// ۴. دریافت چت‌های خصوصی بین دو کاربر
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

// مدیریت Socket.IO برای چت آنلاین
const userSockets = {};

io.on('connection', (socket) => {
  socket.on('register_user', (username) => {
    userSockets[username] = socket.id;
  });

  socket.on('send_private_message', (data) => {
    const { sender, receiver, message } = data;

    // ذخیره پیام در دیتابیس
    const stmt = db.prepare('INSERT INTO messages (sender, receiver, message) VALUES (?, ?, ?)');
    stmt.run(sender, receiver, message, function (err) {
      if (!err) {
        // ارسال به دریافت‌کننده (اگر آنلاین باشد)
        const receiverSocketId = userSockets[receiver];
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('receive_private_message', data);
        }
        // تایید ارسال برای فرستنده
        socket.emit('message_sent', data);
      }
    });
    stmt.finalize();
  });

  socket.on('disconnect', () => {
    for (const username in userSockets) {
      if (userSockets[username] === socket.id) {
        delete userSockets[username];
        break;
      }
    }
  });
});

// تنظیم دقیق پورت هم برای سیستم خودت هم برای سرور Render
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`سرور روی پورت ${PORT} با موفقیت در حال اجراست.`);
});