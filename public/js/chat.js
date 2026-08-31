(function () {
  let currentUser = null;
  let meProfile = null;
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
  let webrtc = null;
  let currentTab = 'chats';

  const listEl = document.getElementById('users-list');
  const contactsEl = document.getElementById('contacts-list');
  const callsEl = document.getElementById('calls-list');
  const messagesEl = document.getElementById('messages-container');
  const inputEl = document.getElementById('message-input');
  const micBtn = document.getElementById('mic-btn');
  const connEl = document.getElementById('conn-status');
  const audioCallBtn = document.getElementById('audio-call-btn');
  const videoCallBtn = document.getElementById('video-call-btn');

  function defaultAvatar(user) {
    if (user && user.profilePic) return user.profilePic;
    return user && user.gender === 'مرد' ? '/boy.svg' : '/girl.svg';
  }

  function setConn(ok) {
    connEl.textContent = ok ? 'متصل' : 'قطع ارتباط...';
    connEl.classList.toggle('bad', !ok);
  }

  function setCallButtons() {
    const on = !!activeReceiver;
    audioCallBtn.disabled = !on;
    videoCallBtn.disabled = !on;
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

  function searchQuery() {
    return document.getElementById('user-search').value.trim().toLowerCase();
  }

  function fillUserRow(u, extraSub) {
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
    if (extraSub) {
      const sub = document.createElement('div');
      sub.className = 'user-sub';
      sub.textContent = extraSub;
      meta.appendChild(sub);
    }
    const dot = document.createElement('span');
    dot.className = 'user-status-dot ' + (u.status === 'online' ? 'dot-online' : 'dot-offline');
    row.appendChild(img);
    row.appendChild(meta);
    row.appendChild(dot);
    row.onclick = () => selectUser(u.username);
    return row;
  }

  function renderUsersList() {
    const q = searchQuery();
    listEl.textContent = '';
    usersListCache
      .filter((u) => u.username !== currentUser)
      .filter((u) => !q || u.username.toLowerCase().includes(q))
      .forEach((u) => listEl.appendChild(fillUserRow(u)));
  }

  function renderContacts() {
    const q = searchQuery();
    contactsEl.textContent = '';
    const rows = usersListCache
      .filter((u) => u.username !== currentUser)
      .filter((u) => !q || u.username.toLowerCase().includes(q) || (u.bio || '').toLowerCase().includes(q));
    if (!rows.length) {
      const hint = document.createElement('div');
      hint.className = 'empty-hint';
      hint.textContent = 'مخاطبی یافت نشد.';
      contactsEl.appendChild(hint);
      return;
    }
    rows.forEach((u) => contactsEl.appendChild(fillUserRow(u, u.bio || (u.status === 'online' ? 'آنلاین' : 'آفلاین'))));
  }

  function callStatusFa(status) {
    if (status === 'rejected') return 'رد شده';
    if (status === 'missed') return 'از دست رفته';
    if (status === 'cancelled') return 'لغو شده';
    if (status === 'ringing') return 'در حال زنگ';
    if (status === 'active') return 'در حال تماس';
    return 'انجام شده';
  }

  async function loadCalls() {
    try {
      const rows = await api('/api/calls');
      const q = searchQuery();
      callsEl.textContent = '';
      const filtered = (rows || []).filter((c) => {
        const other = c.caller === currentUser ? c.callee : c.caller;
        return !q || String(other).toLowerCase().includes(q);
      });
      if (!filtered.length) {
        const hint = document.createElement('div');
        hint.className = 'empty-hint';
        hint.textContent = 'هنوز تماسی ثبت نشده است.';
        callsEl.appendChild(hint);
        return;
      }
      filtered.forEach((c) => {
        const other = c.caller === currentUser ? c.callee : c.caller;
        const user = usersListCache.find((u) => u.username === other) || { username: other };
        const row = document.createElement('div');
        row.className = 'call-item';
        const img = document.createElement('img');
        img.className = 'user-avatar';
        img.src = defaultAvatar(user);
        const meta = document.createElement('div');
        meta.className = 'user-meta';
        const top = document.createElement('div');
        top.className = 'user-top';
        const name = document.createElement('span');
        name.textContent = (c.video ? '📹 ' : '📞 ') + other;
        top.appendChild(name);
        meta.appendChild(top);
        const sub = document.createElement('div');
        sub.className = 'user-sub';
        sub.textContent = callStatusFa(c.status) + (c.startedAt ? ' · ' + formatTime(c.startedAt) : '');
        meta.appendChild(sub);
        row.appendChild(img);
        row.appendChild(meta);
        row.onclick = () => selectUser(other);
        callsEl.appendChild(row);
      });
    } catch (_e) {
      callsEl.textContent = '';
    }
  }

  function renderSettings() {
    document.getElementById('settings-name').textContent = currentUser || '';
    document.getElementById('settings-bio').textContent = (meProfile && meProfile.bio) || '';
    document.getElementById('settings-avatar').src = defaultAvatar(meProfile || { username: currentUser });
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
      audio.setAttribute('controlslist', 'nodownload');
      audio.src = data.message;
      audio.onerror = () => {
        audio.removeAttribute('src');
        const retry = document.createElement('a');
        retry.href = data.message;
        retry.textContent = 'پخش صدا';
        retry.style.color = 'inherit';
        wrap.insertBefore(retry, audio);
      };
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
    setCallButtons();
    renderUsersList();
    renderContacts();
    updateHeaderStatus();
    await loadMessages();
  }

  async function loadUsers() {
    usersListCache = await api('/api/users');
    renderUsersList();
    renderContacts();
    if (activeReceiver) updateHeaderStatus();
    if (currentTab === 'calls') loadCalls();
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
    const name = filename || file.name || 'file.bin';
    body.append('file', file, name);
    return api('/api/upload', { method: 'POST', body });
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
        const prepared = await prepareImageFile(selectedImageFile);
        const uploaded = await uploadFile(prepared, prepared.name || 'photo.jpg');
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

  function ALLOWED_FALLBACK_EXT(type) {
    if (!type) return 'webm';
    const t = String(type).toLowerCase();
    if (t.includes('wav')) return 'wav';
    if (t.includes('mpeg') || t.includes('mp3')) return 'mp3';
    if (t.includes('mp4') || t.includes('m4a') || t.includes('aac')) return 'm4a';
    if (t.includes('ogg')) return 'ogg';
    return 'webm';
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
        const rawType = (mediaRecorder.mimeType || mimeType || 'audio/webm').split(';')[0];
        const blob = new Blob(audioChunks, { type: rawType || 'audio/webm' });
        if (!blob.size) {
          alert('صدایی ضبط نشد.');
          return;
        }
        try {
          let outBlob = blob;
          try {
            outBlob = await blobToWavBlob(blob);
          } catch (_e) {
            outBlob = blob;
          }
          if (!(outBlob && outBlob.size)) outBlob = blob;
          const isWav = (outBlob.type || '').toLowerCase().includes('wav');
          const ext = isWav ? 'wav' : ALLOWED_FALLBACK_EXT(outBlob.type || rawType);
          const file = new File([outBlob], 'voice.' + ext, {
            type: isWav ? 'audio/wav' : (outBlob.type || rawType || 'audio/webm').split(';')[0],
          });
          const uploaded = await uploadFile(file, file.name);
          emitMessage({
            receiver: activeReceiver,
            message: uploaded.url,
            type: 'audio',
          });
        } catch (err) {
          alert(err.message || 'ارسال صدا ناموفق بود.');
        }
      };
      mediaRecorder.start(250);
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

  function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
    });
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === 'tab-' + tab);
    });
    const searchWrap = document.getElementById('search-wrap');
    searchWrap.style.display = tab === 'settings' ? 'none' : 'flex';
    document.getElementById('user-search').placeholder =
      tab === 'calls' ? 'جستجوی تماس‌ها' : tab === 'contacts' ? 'جستجوی مخاطبین' : 'جستجو';
    if (tab === 'calls') loadCalls();
    if (tab === 'settings') renderSettings();
    if (tab === 'contacts') renderContacts();
    if (tab === 'chats') renderUsersList();
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
    meProfile = me.user;
    document.getElementById('me-name').textContent = currentUser;
    document.body.classList.add(me.user.gender === 'مرد' ? 'theme-male' : 'theme-female');
    renderSettings();

    socket = io({ withCredentials: true });
    webrtc = initWebRTC({
      els: {
        modal: document.getElementById('call-modal'),
        incoming: document.getElementById('incoming-modal'),
        local: document.getElementById('local-video'),
        remote: document.getElementById('remote-video'),
        status: document.getElementById('call-status'),
        remoteName: document.getElementById('call-remote-name'),
        inName: document.getElementById('incoming-name'),
        inType: document.getElementById('incoming-type'),
        hangup: document.getElementById('hangup-btn'),
        accept: document.getElementById('accept-btn'),
        reject: document.getElementById('reject-btn'),
        muteBtn: document.getElementById('mute-btn'),
        camBtn: document.getElementById('cam-btn'),
      },
    });
    webrtc.attach(socket);

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
      renderContacts();
      if (activeReceiver === data.username) updateHeaderStatus();
    });
    socket.on('receive_private_message', (data) => {
      if (data.sender === activeReceiver && data.receiver === currentUser) {
        displayMessage(data);
      } else if (data.receiver === currentUser && data.sender !== currentUser) {
        unread[data.sender] = (unread[data.sender] || 0) + 1;
        renderUsersList();
        renderContacts();
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
    socket.on('call:end', () => { if (currentTab === 'calls') loadCalls(); });
    socket.on('call:accepted', () => { if (currentTab === 'calls') loadCalls(); });

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
  document.getElementById('user-search').oninput = () => {
    if (currentTab === 'calls') loadCalls();
    else if (currentTab === 'contacts') renderContacts();
    else renderUsersList();
  };
  document.getElementById('clear-preview').onclick = clearImagePreview;
  document.getElementById('image-modal').onclick = function () {
    this.style.display = 'none';
  };
  document.getElementById('image-form').onsubmit = (e) => e.preventDefault();
  document.getElementById('image-input').onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      selectedImageFile = await prepareImageFile(file);
    } catch (_err) {
      selectedImageFile = file;
    }
    const url = URL.createObjectURL(selectedImageFile);
    document.getElementById('preview-thumb').src = url;
    document.getElementById('preview-bar').classList.add('show');
    inputEl.placeholder = 'کپشن عکس (اختیاری)...';
  };
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.onclick = () => switchTab(btn.getAttribute('data-tab'));
  });
  audioCallBtn.onclick = () => webrtc && webrtc.startCall(activeReceiver, false);
  videoCallBtn.onclick = () => webrtc && webrtc.startCall(activeReceiver, true);

  boot();
})();
