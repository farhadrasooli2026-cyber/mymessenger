const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// اتصال به دیتابیس SQLite
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) console.error('Database connection error:', err);
    else console.log('Connected to SQLite database.');
});

// ساخت جدول‌ها
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        email TEXT,
        phone TEXT,
        password TEXT,
        gender TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender TEXT,
        receiver TEXT,
        message TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// ثبت نام
app.post('/api/register', (req, res) => {
    const { username, email, phone, password, gender } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'نام کاربری و رمز عبور الزامی است.' });
    }

    const stmt = db.prepare(`INSERT INTO users (username, email, phone, password, gender) VALUES (?, ?, ?, ?, ?)`);
    stmt.run(username, email, phone, password, gender, function (err) {
        if (err) {
            return res.status(400).json({ error: 'این نام کاربری قبلاً ثبت شده است.' });
        }
        res.json({ success: true, user: { username, gender } });
    });
});

// ورود
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, password], (err, row) => {
        if (err || !row) {
            return res.status(400).json({ error: 'نام کاربری یا رمز عبور اشتباه است.' });
        }
        res.json({ success: true, user: { username: row.username, gender: row.gender } });
    });
});

// دریافت لیست کاربران
app.get('/api/users', (req, res) => {
    db.all(`SELECT username, gender FROM users`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// دریافت پیام‌های چت خصوصی
app.get('/api/messages/:user1/:user2', (req, res) => {
    const { user1, user2 } = req.params;
    db.all(
        `SELECT sender, receiver, message, timestamp FROM messages 
         WHERE (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?) 
         ORDER BY id ASC`,
        [user1, user2, user2, user1],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

// مدیریت Socket.IO
const onlineUsers = new Map();

io.on('connection', (socket) => {
    socket.on('register_user', (username) => {
        onlineUsers.set(username, socket.id);
        io.emit('user_status_change', { username, online: true });
    });

    socket.on('send_private_message', (data) => {
        const { sender, receiver, message } = data;
        
        // ذخیره در دیتابیس
        const stmt = db.prepare(`INSERT INTO messages (sender, receiver, message) VALUES (?, ?, ?)`);
        stmt.run(sender, receiver, message);

        // ارسال به دریافت‌کننده
        const receiverSocketId = onlineUsers.get(receiver);
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('receive_private_message', { sender, receiver, message });
        }
        
        // تایید به فرستنده
        socket.emit('message_sent', { sender, receiver, message });
    });

    socket.on('disconnect', () => {
        for (let [username, id] of onlineUsers.entries()) {
            if (id === socket.id) {
                onlineUsers.delete(username);
                io.emit('user_status_change', { username, online: false });
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
