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
let messageHistory = []; // چت عمومی
let privateMessages = {}; // چت‌های خصوصی
let onlineUsers = {}; // socketId -> user info

app.post('/api/register', (req, res) => {
    const { username, email, password, gender } = req.body;
    if (!password || (!username && !email)) {
        return res.status(400).json({ success: false, message: 'اطلاعات ناقص است.' });
    }
    const userExists = users.some(u => u.username === username || (email && u.email === email));
    if (userExists) {
        return res.status(400).json({ success: false, message: 'این حساب قبلاً ثبت شده است.' });
    }

    const newUser = {
        id: 'user_' + Date.now(),
        username: username || email.split('@')[0],
        email: email || '',
        password: password,
        gender: gender || 'male'
    };

    users.push(newUser);
    res.json({ success: true, user: { id: newUser.id, username: newUser.username, gender: newUser.gender } });
});

app.post('/api/login', (req, res) => {
    const { identifier, password } = req.body;
    const user = users.find(u => (u.username === identifier || u.email === identifier) && u.password === password);
    if (!user) {
        return res.status(400).json({ success: false, message: 'اطلاعات ورود اشتباه است.' });
    }
    res.json({ success: true, user: { id: user.id, username: user.username, gender: user.gender } });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'), (err) => {
        if (err) res.sendFile(path.join(__dirname, 'login.html'));
    });
});

// کلید یکتا برای چت خصوصی بین دو کاربر
function getRoomId(id1, id2) {
    return [id1, id2].sort().join('_');
}

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

    // لود تاریخچه چت عمومی
    socket.on('get_public_history', () => {
        socket.emit('load_history', { type: 'public', messages: messageHistory });
    });

    // لود تاریخچه چت خصوصی
    socket.on('get_private_history', ({ targetUserId, myId }) => {
        const roomId = getRoomId(myId, targetUserId);
        const history = privateMessages[roomId] || [];
        socket.emit('load_history', { type: 'private', targetUserId, messages: history });
    });

    // ارسال پیام (هم عمومی هم خصوصی)
    socket.on('send_message', (data) => {
        const msg = {
            id: Date.now(),
            sender_id: data.senderId,
            sender_name: data.senderName,
            text: data.text,
            target_id: data.targetId || 'public'
        };

        if (!data.targetId || data.targetId === 'public') {
            // چت عمومی
            messageHistory.push(msg);
            io.emit('receive_message', msg);
        } else {
            // چت خصوصی
            const roomId = getRoomId(data.senderId, data.targetId);
            if (!privateMessages[roomId]) privateMessages[roomId] = [];
            privateMessages[roomId].push(msg);

            // پیدا کردن socketId گیرنده و فرستنده برای تحویل پیام
            Object.values(onlineUsers).forEach(u => {
                if (u.id === data.targetId || u.id === data.senderId) {
                    io.to(u.socketId).emit('receive_message', msg);
                }
            });
        }
    });

    socket.on('disconnect', () => {
        delete onlineUsers[socket.id];
        io.emit('update_online_users', Object.values(onlineUsers));
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));