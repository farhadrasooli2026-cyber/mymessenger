
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ثبت‌نام کاربر
app.post('/api/register', async (req, res) => {
    const { username, email, phone, password, gender } = req.body;

    if (!username || !email || !phone || !password) {
        return res.status(400).json({ success: false, message: 'لطفاً تمامی فیلدها را پر کنید.' });
    }

    try {
        const existingUser = db.prepare(
            'SELECT id FROM users WHERE username = ? OR email = ? OR phone = ?'
        ).get(username, email, phone);

        if (existingUser) {
            return res.status(400).json({ 
                success: false, 
                message: 'این نام کاربری، ایمیل یا شماره تلفن قبلاً ثبت شده است.' 
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const insertUser = db.prepare(
            'INSERT INTO users (username, email, phone, password, gender) VALUES (?, ?, ?, ?, ?)'
        );
        const result = insertUser.run(username, email, phone, hashedPassword, gender || 'female');

        return res.json({ 
            success: true, 
            message: 'ثبت‌نام با موفقیت انجام شد!',
            userId: result.lastInsertRowid 
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: 'خطای سرور در ذخیره‌سازی اطلاعات' });
    }
});

// ورود کاربر
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'لطفاً نام کاربری و رمز عبور را وارد کنید.' });
    }

    try {
        const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username, username);

        if (!user) {
            return res.status(400).json({ success: false, message: 'کاربری با این مشخصات یافت نشد.' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(400).json({ success: false, message: 'رمز عبور اشتباه است.' });
        }

        return res.json({
            success: true,
            message: 'ورود با موفقیت انجام شد!',
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                gender: user.gender
            }
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: 'خطای سرور در فرآیند ورود' });
    }
});

// مدیریت سوکت‌ها (ارسال و دریافت پیام‌های زنده)
io.on('connection', (socket) => {
    console.log('یک کاربر متصل شد');

    // ارسال پیام‌های قبلی دیتابیس به محض ورود کاربر
    const historyMessages = db.prepare('SELECT * FROM messages ORDER BY id ASC LIMIT 50').all();
    socket.emit('load_history', historyMessages);

    // دریافت پیام جدید از کاربر
    socket.on('send_message', (data) => {
        const { senderId, senderName, text } = data;

        if (text && text.trim() !== '') {
            // ۱. ذخیره پیام در دیتابیس
            const stmt = db.prepare('INSERT INTO messages (sender_id, sender_name, text) VALUES (?, ?, ?)');
            const info = stmt.run(senderId, senderName, text);

            const newMessage = {
                id: info.lastInsertRowid,
                sender_id: senderId,
                sender_name: senderName,
                text: text
            };

            // ۲. ارسال پیام جدید به تمام کاربران متصل
            io.emit('receive_message', newMessage);
        }
    });

    socket.on('disconnect', () => {
        console.log('کاربر قطع اتصال شد');
    });
});

server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});