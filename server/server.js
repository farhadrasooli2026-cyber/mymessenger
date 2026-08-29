const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// سرو فایل‌های استاتیک پروژه
app.use(express.static(__dirname));

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// ذخیره وضعیت آنلاین بودن و آخرین بازدید
const onlineUsers = new Map(); // username -> socketId
const lastSeenMap = new Map(); // username -> last seen status

io.on('connection', (socket) => {

  // ثبت نام کاربر متصل شده در سوکت
  socket.on('register_user', (username) => {
    if (!username) return;
    socket.username = username;
    onlineUsers.set(username, socket.id);
    lastSeenMap.set(username, 'online');

    // اطلاع‌رسانی وضعیت آنلاین به سایرین
    io.emit('user_status_change', {
      username: username,
      status: 'online'
    });
  });

  // استعلام وضعیت کاربر (آنلاین / آخرین بازدید)
  socket.on('get_user_status', (username) => {
    const status = lastSeenMap.get(username) || 'offline';
    socket.emit('user_status_response', { username, status });
  });

  // ارسال پیام خصوصی
  socket.on('send_private_message', (data) => {
    // data = { sender, receiver, message }
    const receiverSocketId = onlineUsers.get(data.receiver);
    
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('receive_private_message', data);
    }
  });

  // قطع اتصال کاربر (آفلاین شدن)
  socket.on('disconnect', () => {
    if (socket.username) {
      onlineUsers.delete(socket.username);
      const now = new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
      const lastSeenText = `آخرین بازدید امروز در ${now}`;
      lastSeenMap.set(socket.username, lastSeenText);

      io.emit('user_status_change', {
        username: socket.username,
        status: lastSeenText
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});