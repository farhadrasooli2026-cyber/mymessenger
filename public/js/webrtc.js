(function (global) {
  const ICE = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  };

  function initWebRTC(opts) {
    const els = opts.els;
    let socket = null;
    let pc = null;
    let localStream = null;
    let callId = null;
    let role = null;
    let videoCall = false;
    let pendingIce = [];
    let ringTimer = null;
    let ringCtx = null;

    function setStatus(text) {
      els.status.textContent = text || '';
    }

    function showOutgoing(peer, video) {
      els.modal.classList.add('show');
      els.incoming.classList.remove('show');
      els.remoteName.textContent = peer;
      els.modal.classList.toggle('audio-only', !video);
      els.camBtn.style.display = video ? '' : 'none';
      setStatus('در حال برقراری تماس...');
    }

    function showIncoming(from, video) {
      els.incoming.classList.add('show');
      els.inName.textContent = from;
      els.inType.textContent = video ? 'تماس تصویری' : 'تماس صوتی';
    }

    function stopRing() {
      if (ringTimer) clearInterval(ringTimer);
      ringTimer = null;
      if (ringCtx) {
        try { ringCtx.close(); } catch (_e) {}
        ringCtx = null;
      }
    }

    function startRing() {
      stopRing();
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      ringCtx = new AudioCtx();
      const beep = () => {
        if (!ringCtx) return;
        const osc = ringCtx.createOscillator();
        const gain = ringCtx.createGain();
        osc.frequency.value = 740;
        gain.gain.value = 0.05;
        osc.connect(gain);
        gain.connect(ringCtx.destination);
        osc.start();
        osc.stop(ringCtx.currentTime + 0.18);
      };
      beep();
      ringTimer = setInterval(beep, 1400);
    }

    async function ensureMedia(video) {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: video ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } : false,
      });
      els.local.srcObject = localStream;
      els.local.muted = true;
      els.local.playsInline = true;
      try { await els.local.play(); } catch (_e) {}
    }

    function bindPc() {
      pc = new RTCPeerConnection(ICE);
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
      pc.onicecandidate = (event) => {
        if (event.candidate && callId) {
          socket.emit('call:signal', { callId, candidate: event.candidate.toJSON() });
        }
      };
      pc.ontrack = (event) => {
        const stream = event.streams[0] || new MediaStream([event.track]);
        els.remote.srcObject = stream;
        els.remote.playsInline = true;
        els.remote.play().catch(() => {});
      };
      pc.onconnectionstatechange = () => {
        if (!pc) return;
        if (pc.connectionState === 'connected') setStatus(videoCall ? 'تماس تصویری' : 'تماس صوتی');
        if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
          setStatus('ارتباط ناپایدار است...');
        }
      };
    }

    function sdpPayload(desc) {
      return { type: desc.type, sdp: desc.sdp };
    }

    async function flushIce() {
      if (!pc || !pc.remoteDescription) return;
      const queued = pendingIce.splice(0);
      for (const c of queued) {
        try { await pc.addIceCandidate(c); } catch (_e) {}
      }
    }

    async function createOffer() {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('call:signal', { callId, sdp: sdpPayload(pc.localDescription) });
    }

    function cleanupStreams() {
      if (localStream) localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
      if (pc) {
        try { pc.close(); } catch (_e) {}
      }
      pc = null;
      pendingIce = [];
      els.local.srcObject = null;
      els.remote.srcObject = null;
    }

    function hideUi() {
      stopRing();
      els.modal.classList.remove('show');
      els.incoming.classList.remove('show');
      els.muteBtn.classList.remove('off');
      els.camBtn.classList.remove('off');
    }

    function hangup(emit) {
      const id = callId;
      cleanupStreams();
      hideUi();
      callId = null;
      role = null;
      if (emit && id && socket) socket.emit('call:end', { callId: id });
      if (opts.onIdle) opts.onIdle();
    }

    async function startCall(peer, video) {
      if (!peer) return alert('ابتدا یک مخاطب را انتخاب کنید.');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return alert('مرورگر شما تماس را پشتیبانی نمی‌کند. از HTTPS و مرورگر به‌روز استفاده کنید.');
      }
      if (callId) return;
      videoCall = !!video;
      role = 'caller';
      showOutgoing(peer, videoCall);
      try {
        await ensureMedia(videoCall);
        bindPc();
        socket.emit('call:invite', { to: peer, video: videoCall });
      } catch (_err) {
        hangup(false);
        alert('دسترسی به میکروفون/دوربین داده نشد.');
      }
    }

    async function acceptCall() {
      stopRing();
      els.incoming.classList.remove('show');
      if (!callId) return;
      showOutgoing(els.inName.textContent, videoCall);
      try {
        await ensureMedia(videoCall);
        bindPc();
        socket.emit('call:accept', { callId });
        setStatus('در حال اتصال...');
      } catch (_err) {
        socket.emit('call:reject', { callId });
        hangup(false);
        alert('دسترسی به میکروفون/دوربین داده نشد.');
      }
    }

    function rejectCall() {
      stopRing();
      if (callId) socket.emit('call:reject', { callId });
      hangup(false);
    }

    function attach(sock) {
      socket = sock;
      socket.on('call:ringing', (data) => {
        callId = data.callId;
        videoCall = !!data.video;
        setStatus('در حال زنگ خوردن...');
      });
      socket.on('call:incoming', (data) => {
        if (callId) {
          socket.emit('call:reject', { callId: data.callId });
          return;
        }
        callId = data.callId;
        role = 'callee';
        videoCall = !!data.video;
        showIncoming(data.from, videoCall);
        startRing();
      });
      socket.on('call:accepted', async (data) => {
        if (!callId || data.callId !== callId) return;
        setStatus('در حال اتصال...');
        if (role === 'caller' && pc) {
          try { await createOffer(); } catch (_e) { hangup(true); }
        }
      });
      socket.on('call:signal', async (data) => {
        if (!pc || data.callId !== callId) return;
        try {
          if (data.sdp) {
            const desc = data.sdp;
            if (desc.type === 'offer') {
              await pc.setRemoteDescription(desc);
              await flushIce();
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              socket.emit('call:signal', { callId, sdp: sdpPayload(pc.localDescription) });
            } else if (desc.type === 'answer') {
              await pc.setRemoteDescription(desc);
              await flushIce();
            }
          } else if (data.candidate) {
            if (pc.remoteDescription) {
              try { await pc.addIceCandidate(data.candidate); } catch (_e) {}
            } else {
              pendingIce.push(data.candidate);
            }
          }
        } catch (_err) {}
      });
      socket.on('call:end', () => {
        hangup(false);
      });
      socket.on('call:busy', () => {
        alert('طرف مقابل در تماس دیگری است.');
        hangup(false);
      });
      socket.on('call:unavailable', (data) => {
        alert(data && data.reason === 'offline' ? 'کاربر آفلاین است.' : 'امکان تماس وجود ندارد.');
        hangup(false);
      });
    }

    els.hangup.onclick = () => hangup(true);
    els.reject.onclick = rejectCall;
    els.accept.onclick = acceptCall;
    els.muteBtn.onclick = () => {
      if (!localStream) return;
      const audio = localStream.getAudioTracks()[0];
      if (!audio) return;
      audio.enabled = !audio.enabled;
      els.muteBtn.classList.toggle('off', !audio.enabled);
    };
    els.camBtn.onclick = () => {
      if (!localStream) return;
      const cam = localStream.getVideoTracks()[0];
      if (!cam) return;
      cam.enabled = !cam.enabled;
      els.camBtn.classList.toggle('off', !cam.enabled);
    };

    return {
      attach,
      startCall,
      hangup,
    };
  }

  global.initWebRTC = initWebRTC;
})(window);
