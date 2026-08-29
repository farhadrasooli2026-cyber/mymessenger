const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// پشتیبانی از فایل‌های استاتیک هم در پوشه اصلی و هم پوشه public
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

// روت اصلی برای هدایت به login.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'), (err) => {
        if (err) {
            res.sendFile(path.join(__dirname, 'login.html'));
        }
    });
});

let messageHistory = [];
let onlineUsers = {};

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
    console.log(`Server is running on port ${PORT}`);
});