const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// افزایش محدودیت سایز برای آپلود عکس و ویس با حجم بالا
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// هدایت آدرس اصلی سایت به صفحه ورود
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// اتصال به دیتابیس SQLite
const db = new sqlite3.Database('./database.db', (err) => {
    if (err) console.error('Database connection error:', err);
    else console.log('Connected to SQLite database.');
});

// ساخت جدول‌ها (با فیلدهای جدید profilePic و bio)
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        email TEXT,
        phone TEXT,
        password TEXT,
        gender TEXT,
        profilePic TEXT,
        bio TEXT
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

    // پیش‌فرض عکس و بیوگرافی در هنكام ثبت‌نام اولیه
    const defaultPic = gender === 'زن' || gender === 'دختر' ? '/girl.jpg' : '/boy.jpg';
    const defaultBio = 'سلام! من از MyMessenger استفاده می‌کنم.';

    const stmt = db.prepare(`INSERT INTO users (username, email, phone, password, gender, profilePic, bio) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    stmt.run(username, email, phone, password, gender, defaultPic, defaultBio, function (err) {
        if (err) {
            return res.status(400).json({ error: 'این نام کاربری قبلاً ثبت شده است.' });
        }
        res.json({ success: true, user: { username, gender, profilePic: defaultPic, bio: defaultBio } });
    });
});

// آپدیت پروفایل (عکس و بیوگرافی)
app.post('/api/update-profile', (req, res) => {
    const { username, profilePic, bio } = req.body;
    if (!username) {
        return res.status(400).json({ error: 'نام کاربری نامعتبر است.' });
    }

    db.run(
        `UPDATE users SET profilePic = ?, bio = ? WHERE username = ?`,
        [profilePic, bio, username],
        function (err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            db.get(`SELECT username, gender, profilePic, bio FROM users WHERE username = ?`, [username], (err, row) => {
                if (err || !row) return res.status(400).json({ error: 'کاربر یافت نشد.' });
                res.json({ success: true, user: row });
            });
        }
    );
});

// ورود
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT username, gender, profilePic, bio FROM users WHERE username = ? AND password = ?`, [username, password], (err, row) => {
        if (err || !row) {
            return res.status(400).json({ error: 'نام کاربری یا رمز عبور اشتباه است.' });
        }
        res.json({ success: true, user: row });
    });
});

// دریافت لیست کاربران (همراه با عکس و بیو)
app.get('/api/users', (req, res) => {
    db.all(`SELECT username, gender, profilePic, bio FROM users`, [], (err, rows) => {
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
