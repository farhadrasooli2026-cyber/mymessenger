const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

let users = [];
let messageHistory = [];
let onlineUsers = {};

// API ثبت‌نام (پشتیبانی از ایمیل و نام‌کاربری)
app.post('/api/register', (req, res) => {
    const { username, email, password, gender } = req.body;
    
    if (!password || (!username && !email)) {
        return res.status(400).json({ success: false, message: 'لطفا اطلاعات را کامل وارد کنید.' });
    }

    const userExists = users.some(u => u.username === username || (email && u.email === email));
    if (userExists) {
        return res.status(400).json({ success: false, message: 'این حساب یا ایمیل قبلاً ثبت شده است.' });
    }

    const newUser = {
        id: 'user_' + Date.now(),
        username: username || email.split('@')[0],
        email: email || '',
        password: password,
        gender: gender || 'male'
    };

    users.push(newUser);
    res.json({ success: true, message: 'ثبت نام انجام شد', user: { id: newUser.id, username: newUser.username, gender: newUser.gender } });
});

// API ورود (پشتیبانی همزمان با ایمیل یا نام‌کاربری)
app.post('/api/login', (req, res) => {
    const { identifier, password } = req.body;

    const user = users.find(u => (u.username === identifier || u.email === identifier) && u.password === password);

    if (!user) {
        return res.status(400).json({ success: false, message: 'نام کاربری/ایمیل یا رمز عبور اشتباه است.' });
    }

    res.json({ success: true, user: { id: user.id, username: user.username, gender: user.gender } });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'), (err) => {
        if (err) res.sendFile(path.join(__dirname, 'login.html'));
    });
});

io.on('connection', (socket) => {
    socket.on('user_connected', (userData) => {
        if (userData && userData.id) {
            onlineUsers[socket.id] = {
                socketId: socket.id,
                id: userData.id,
                username: userData.username,
                gender: userData.gender
            };
            io.emit('update_online_users', Object.values(onlineUsers));
        }
    });

    socket.emit('load_history', messageHistory);

    socket.on('send_message', (data) => {
        const msg = {
            id: Date.now(),
            sender_id: data.senderId,
            sender_name: data.senderName,
            text: data.text
        };
        messageHistory.push(msg);
        io.emit('receive_message', msg);
    });

    socket.on('disconnect', () => {
        delete onlineUsers[socket.id];
        io.emit('update_online_users', Object.values(onlineUsers));
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});