(function () {
  let currentUser = null;
  let socket = null;
  let activeReceiver = null;
  let usersListCache = [];
  let selectedImageFile = null;
  let unread = {};
  let mediaRecorder = null;
  let audioChunks = [];
  let isRecording = false;
  let recordTimer = null;
  let typingTimer = null;

  const listEl = document.getElementById('users-list');
  const messagesEl = document.getElementById('messages-container');
  const inputEl = document.getElementById('message-input');
  const micBtn = document.getElementById('mic-btn');
  const connEl = document.getElementById('conn-status');

  function defaultAvatar(user) {
    if (user && user.profilePic) return user.profilePic;
    return user && user.gender === 'مرد' ? '/boy.svg' : '/girl.svg';
  }

  function setConn(ok) {
    connEl.textContent = ok ? 'متصل' : 'قطع ارتباط...';
    connEl.classList.toggle('bad', !ok);
  }

  function updateHeaderStatus() {
    const statusSpan = document.getElementById('chat-header-status');
    const user = usersListCache.find((u) => u.username === activeReceiver);
    if (!user) {
      statusSpan.textContent = '';
      return;
    }
    if (user.status === 'online') {
      statusSpan.textContent = 'آنلاین';
      statusSpan.style.color = '#2ecc71';
    } else if (user.lastSeen) {
      statusSpan.textContent = 'آخرین بازدید: ' + formatTime(user.lastSeen);
      statusSpan.style.color = '#ccc';
    } else {
      statusSpan.textContent = 'آفلاین';
      statusSpan.style.color = '#ccc';
    }
  }

  function renderUsersList() {
    const q = document.getElementById('user-search').value.trim().toLowerCase();
    listEl.textContent = '';
    usersListCache
      .filter((u) => u.username !== currentUser)
      .filter((u) => !q || u.username.toLowerCase().includes(q))
      .forEach((u) => {
        const row = document.createElement('div');
        row.className = 'user-item' + (activeReceiver === u.username ? ' active' : '');
        const img = document.createElement('img');
        img.className = 'user-avatar';
        img.src = defaultAvatar(u);
        img.alt = '';
        const meta = document.createElement('div');
        meta.className = 'user-meta';
        const top = document.createElement('div');
        top.className = 'user-top';
        const name = document.createElement('span');
        name.textContent = u.username;
        top.appendChild(name);
        const count = unread[u.username] || 0;
        if (count) {
          const badge = document.createElement('span');
          badge.className = 'unread';
          badge.textContent = String(count);
          top.appendChild(badge);
        }
        meta.appendChild(top);
        const dot = document.createElement('span');
        dot.className = 'user-status-dot ' + (u.status === 'online' ? 'dot-online' : 'dot-offline');
        row.appendChild(img);
        row.appendChild(meta);
        row.appendChild(dot);
        row.onclick = () => selectUser(u.username);
        listEl.appendChild(row);
      });
  }

  function inferType(msg) {
    if (msg.type) return msg.type;
    const value = msg.message || '';
    if (/\.(png|jpe?g|webp|gif)$/i.test(value) || value.startsWith('data:image')) return 'image';
    if (/\.(wav|webm|ogg|mp3|m4a|aac|mp4)$/i.test(value) || value.startsWith('data:audio')) return 'audio';
    return 'text';
  }

  function openFullImage(src) {
    document.getElementById('full-image').src = src;
    document.getElementById('image-modal').style.display = 'flex';
  }

  function displayMessage(data) {
    const type = inferType(data);
    const wrap = document.createElement('div');
    wrap.className = 'message ' + (data.sender === currentUser ? 'sent' : 'received');

    if (type === 'image' && data.message) {
      const img = document.createElement('img');
      img.src = data.message;
      img.alt = '';
      img.onclick = () => openFullImage(data.message);
      wrap.appendChild(img);
      if (data.caption) {
        const cap = document.createElement('div');
        cap.textContent = data.caption;
        wrap.appendChild(cap);
      }
    } else if (type === 'audio' && data.message) {
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.preload = 'metadata';
      audio.setAttribute('playsinline', '');
      audio.setAttribute('webkit-playsinline', '');
      const source = document.createElement('source');
      source.src = data.message;
      if (/\.wav$/i.test(data.message)) source.type = 'audio/wav';
      else if (/\.mp3$/i.test(data.message)) source.type = 'audio/mpeg';
      else if (/\.m4a$/i.test(data.message) || /\.mp4$/i.test(data.message)) source.type = 'audio/mp4';
      else if (/\.ogg$/i.test(data.message)) source.type = 'audio/ogg';
      else if (/\.webm$/i.test(data.message)) source.type = 'audio/webm';
      audio.appendChild(source);
      audio.src = data.message;
      wrap.appendChild(audio);
    } else {
      wrap.appendChild(document.createTextNode(data.message || ''));
    }

    const time = document.createElement('div');
    time.className = 'msg-time';
    time.textContent = formatTime(data.timestamp);
    wrap.appendChild(time);
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function loadMessages() {
    if (!activeReceiver) return;
    const msgs = await api('/api/messages/' + encodeURIComponent(activeReceiver));
    messagesEl.textContent = '';
    msgs.forEach(displayMessage);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function selectUser(username) {
    activeReceiver = username;
    unread[username] = 0;
    document.getElementById('chat-header-title').textContent = username;
    document.getElementById('app-container').classList.add('chat-open');
    renderUsersList();
    updateHeaderStatus();
    await loadMessages();
  }

  async function loadUsers() {
    usersListCache = await api('/api/users');
    renderUsersList();
    if (activeReceiver) updateHeaderStatus();
  }

  function clearImagePreview() {
    selectedImageFile = null;
    document.getElementById('image-input').value = '';
    document.getElementById('preview-bar').classList.remove('show');
    document.getElementById('preview-thumb').src = '';
    inputEl.placeholder = 'پیام خود را بنویسید...';
  }

  async function uploadFile(file, filename) {
    const body = new FormData();
    if (filename) body.append('file', file, filename);
    else body.append('file', file);
    const data = await api('/api/upload', { method: 'POST', body });
    return data;
  }

  function emitMessage(payload) {
    socket.emit('send_private_message', payload);
  }

  async function sendMessage() {
    if (!activeReceiver) {
      alert('لطفا ابتدا یک مخاطب انتخاب کنید');
      return;
    }
    const text = inputEl.value.trim();
    try {
      if (selectedImageFile) {
        const uploaded = await uploadFile(selectedImageFile);
        emitMessage({
          receiver: activeReceiver,
          message: uploaded.url,
          type: 'image',
          caption: text,
        });
        clearImagePreview();
        inputEl.value = '';
        return;
      }
      if (!text) return;
      emitMessage({ receiver: activeReceiver, message: text, type: 'text' });
      inputEl.value = '';
    } catch (err) {
      alert(err.message);
    }
  }

  async function toggleRecordVoice() {
    if (!activeReceiver) {
      alert('لطفاً ابتدا یک مخاطب انتخاب کنید');
      return;
    }
    if (isRecording) {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('مرورگر شما ضبط صدا را پشتیبانی نمی‌کند.');
      return;
    }
    const mimeType = pickRecorderMime();
    if (mimeType === null) {
      alert('ضبط صدا روی این مرورگر در دسترس نیست. از Chrome یا Safari به‌روز استفاده کنید.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const options = mimeType ? { mimeType } : undefined;
      mediaRecorder = options ? new MediaRecorder(stream, options) : new MediaRecorder(stream);
      audioChunks = [];
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) audioChunks.push(event.data);
      };
      mediaRecorder.onerror = () => {
        alert('خطا در ضبط صدا.');
        stream.getTracks().forEach((t) => t.stop());
      };
      mediaRecorder.onstop = async () => {
        isRecording = false;
        micBtn.classList.remove('recording');
        micBtn.title = 'ضبط صدا';
        if (recordTimer) clearInterval(recordTimer);
        stream.getTracks().forEach((t) => t.stop());
        const rawType = mediaRecorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(audioChunks, { type: rawType.split(';')[0] });
        if (!blob.size) {
          alert('صدایی ضبط نشد.');
          return;
        }
        try {
          let outBlob;
          try {
            outBlob = await blobToWavBlob(blob);
          } catch (_e) {
            outBlob = blob;
          }
          const ext = (outBlob.type || '').includes('wav') ? 'wav' : (ALLOWED_FALLBACK_EXT(outBlob.type) || 'webm');
          const uploaded = await uploadFile(outBlob, 'voice.' + ext);
          emitMessage({
            receiver: activeReceiver,
            message: uploaded.url,
            type: 'audio',
          });
        } catch (err) {
          alert(err.message || 'ارسال صدا ناموفق بود.');
        }
      };
      mediaRecorder.start();
      isRecording = true;
      micBtn.classList.add('recording');
      let seconds = 0;
      micBtn.title = 'در حال ضبط...';
      recordTimer = setInterval(() => {
        seconds += 1;
        micBtn.title = 'ضبط ' + seconds + ' ثانیه';
        if (seconds >= 60 && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
      }, 1000);
    } catch (_err) {
      alert('دسترسی به میکروفون داده نشد یا مرورگر پشتیبانی نمی‌کند.');
    }
  }

  function ALLOWED_FALLBACK_EXT(type) {
    if (!type) return 'webm';
    if (type.includes('wav')) return 'wav';
    if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
    if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) return 'm4a';
    if (type.includes('ogg')) return 'ogg';
    return 'webm';
  }

  async function boot() {
    let me;
    try {
      me = await api('/api/me');
    } catch (_e) {
      window.location.href = '/login.html';
      return;
    }
    currentUser = me.user.username;
    document.getElementById('me-name').textContent = currentUser;
    document.body.classList.add(me.user.gender === 'مرد' ? 'theme-male' : 'theme-female');

    socket = io({ withCredentials: true });
    socket.on('connect', () => setConn(true));
    socket.on('disconnect', () => setConn(false));
    socket.on('connect_error', () => setConn(false));
    socket.on('user_status_changed', (data) => {
      const userObj = usersListCache.find((u) => u.username === data.username);
      if (userObj) {
        userObj.status = data.status;
        if (data.lastSeen) userObj.lastSeen = data.lastSeen;
      }
      renderUsersList();
      if (activeReceiver === data.username) updateHeaderStatus();
    });
    socket.on('receive_private_message', (data) => {
      if (data.sender === activeReceiver && data.receiver === currentUser) {
        displayMessage(data);
      } else if (data.receiver === currentUser && data.sender !== currentUser) {
        unread[data.sender] = (unread[data.sender] || 0) + 1;
        renderUsersList();
      }
    });
    socket.on('message_sent', (data) => {
      if (data.sender === currentUser && (data.receiver === activeReceiver || data.sender === activeReceiver)) {
        displayMessage(data);
      }
    });
    socket.on('typing', (data) => {
      if (data.sender !== activeReceiver) return;
      const statusSpan = document.getElementById('chat-header-status');
      statusSpan.textContent = 'در حال نوشتن...';
      statusSpan.style.color = '#f8bbd0';
      clearTimeout(typingTimer);
      typingTimer = setTimeout(updateHeaderStatus, 1500);
    });
    socket.on('message_error', (data) => alert(data.error || 'خطا در ارسال'));

    await loadUsers();
    setInterval(loadUsers, 20000);
  }

  document.getElementById('send-btn').onclick = sendMessage;
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    } else if (activeReceiver && socket) {
      socket.emit('typing', { receiver: activeReceiver });
    }
  });
  document.getElementById('mic-btn').onclick = toggleRecordVoice;
  document.getElementById('back-btn').onclick = () => {
    document.getElementById('app-container').classList.remove('chat-open');
  };
  document.getElementById('profile-btn').onclick = () => {
    window.location.href = '/profile.html';
  };
  document.getElementById('logout-btn').onclick = async () => {
    try { await api('/api/logout', { method: 'POST' }); } catch (_e) {}
    window.location.href = '/login.html';
  };
  document.getElementById('user-search').oninput = renderUsersList;
  document.getElementById('clear-preview').onclick = clearImagePreview;
  document.getElementById('image-modal').onclick = function () {
    this.style.display = 'none';
  };
  document.getElementById('image-input').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    selectedImageFile = file;
    const url = URL.createObjectURL(file);
    document.getElementById('preview-thumb').src = url;
    document.getElementById('preview-bar').classList.add('show');
    inputEl.placeholder = 'کپشن عکس (اختیاری)...';
  };

  boot();
})();
