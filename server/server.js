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
    if (err) console.error(err.message);
    else console.log('Connected to SQLite database.');
});

// ساخت جدول‌ها در صورت عدم وجود
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        password TEXT,
        gender TEXT,
        last_seen TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id TEXT,
        sender_name TEXT,
        target_id TEXT,
        text TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

// ساختار نگهداری کاربران آنلاین
const onlineUsers = new Map(); // socket.id -> { id, username, gender }

// ای‌پیاهای ثبت‌نام و ورود
app.post('/api/register', (req, res) => {
    const { username, password, gender } = req.body;
    const id = Date.now().toString();
    
    db.run(`INSERT INTO users (id, username, password, gender, last_seen) VALUES (?, ?, ?, ?, ?)`,
        [id, username, password, gender, 'online'],
        function(err) {
            if (err) return res.status(400).json({ success: false, message: 'نام کاربری قبلاً انتخاب شده است.' });
            res.json({ success: true, user: { id, username, gender } });
        }
    );
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, password], (err, user) => {
        if (err || !user) return res.status(400).json({ success: false, message: 'نام کاربری یا رمز عبور اشتباه است.' });
        res.json({ success: true, user: { id: user.id, username: user.username, gender: user.gender } });
    });
});

// Socket.io
io.on('connection', (socket) => {

    socket.on('user_connected', (user) => {
        onlineUsers.set(socket.id, { socketId: socket.id, ...user });
        
        // آپدیت وضعیت کاربر در دیتابیس به آنلاین
        db.run(`UPDATE users SET last_seen = 'online' WHERE id = ?`, [user.id]);
        
        broadcastUsersList();
    });

    socket.on('get_public_history', () => {
        db.all(`SELECT * FROM messages WHERE target_id = 'public' ORDER BY id ASC LIMIT 50`, [], (err, rows) => {
            if (!err) socket.emit('load_history', { messages: rows });
        });
    });

    socket.on('get_private_history', ({ targetUserId, myId }) => {
        db.all(
            `SELECT * FROM messages WHERE (sender_id = ? AND target_id = ?) OR (sender_id = ? AND target_id = ?) ORDER BY id ASC LIMIT 50`,
            [myId, targetUserId, targetUserId, myId],
            (err, rows) => {
                if (!err) socket.emit('load_history', { messages: rows });
            }
        );
    });

    socket.on('send_message', (data) => {
        const { senderId, senderName, targetId, text } = data;
        db.run(
            `INSERT INTO messages (sender_id, sender_name, target_id, text) VALUES (?, ?, ?, ?)`,
            [senderId, senderName, targetId, text],
            function(err) {
                if (!err) {
                    const msg = { id: this.lastID, sender_id: senderId, sender_name: senderName, target_id: targetId, text };
                    io.emit('receive_message', msg);
                }
            }
        );
    });

    socket.on('disconnect', () => {
        const user = onlineUsers.get(socket.id);
        if (user) {
            const now = new Date();
            const timeString = now.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
            
            // ثبت زمان قطع اتصال در دیتابیس
            db.run(`UPDATE users SET last_seen = ? WHERE id = ?`, [timeString, user.id]);
            
            onlineUsers.delete(socket.id);
            broadcastUsersList();
        }
    });

    function broadcastUsersList() {
        // دریافت تمام کاربران دیتابیس برای نمایش آنلاین/آفلاین بودن همه
        db.all(`SELECT id, username, gender, last_seen FROM users`, [], (err, allUsers) => {
            if (err) return;
            const activeIds = new Set(Array.from(onlineUsers.values()).map(u => u.id));
            
            const usersWithStatus = allUsers.map(u => ({
                id: u.id,
                username: u.username,
                gender: u.gender,
                isOnline: activeIds.has(u.id),
                lastSeen: activeIds.has(u.id) ? 'آنلاین' : (u.last_seen || 'ناشناس')
            }));

            io.emit('update_online_users', usersWithStatus);
        });
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));