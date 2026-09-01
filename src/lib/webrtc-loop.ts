/** In-browser WebRTC loop. Media never leaves the device; server only sees signaling metadata. */

export type LoopSession = {
  local: MediaStream;
  remote: MediaStream;
  pcLocal: RTCPeerConnection;
  pcRemote: RTCPeerConnection;
  stopPoll?: () => void;
  voiceFallback?: boolean;
};

const fallbackIce: RTCConfiguration = { iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] };

function videoConstraints(opts: { lowData: boolean; deviceId?: string; facing?: "user" | "environment" }): MediaTrackConstraints {
  return {
    facingMode: opts.facing ?? "user",
    width: opts.lowData ? { ideal: 480 } : { ideal: 1280 },
    height: opts.lowData ? { ideal: 360 } : { ideal: 720 },
    frameRate: opts.lowData ? { ideal: 15, max: 24 } : { ideal: 30, max: 30 },
    deviceId: opts.deviceId ? { exact: opts.deviceId } : undefined,
  };
}

export function mediaErrorKind(err: unknown): "camera" | "microphone" | "screen" | "notfound" | "other" {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: string }).name) : "";
  const msg = err && typeof err === "object" && "message" in err ? String((err as { message: string }).message) : "";
  if (/display|screen/i.test(msg)) return "screen";
  if (name === "NotFoundError") return "notfound";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    if (/video|camera/i.test(msg)) return "camera";
    if (/audio|microphone/i.test(msg)) return "microphone";
    return "camera";
  }
  return "other";
}

export async function acquireCallMedia(opts: {
  video: boolean;
  lowData: boolean;
  deviceId?: string;
  audioDeviceId?: string;
}): Promise<{ stream: MediaStream; voiceFallback: boolean }> {
  const audio: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    deviceId: opts.audioDeviceId ? { exact: opts.audioDeviceId } : undefined,
  };
  if (!opts.video) {
    return { stream: await navigator.mediaDevices.getUserMedia({ audio, video: false }), voiceFallback: false };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio,
      video: videoConstraints({ lowData: opts.lowData, deviceId: opts.deviceId }),
    });
    return { stream, voiceFallback: false };
  } catch (err) {
    const kind = mediaErrorKind(err);
    if (kind === "camera" || kind === "notfound") {
      const stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
      return { stream, voiceFallback: true };
    }
    throw err;
  }
}

async function iceConfig(override?: RTCIceServer[]): Promise<RTCConfiguration> {
  if (override?.length) return { iceServers: override };
  try {
    const res = await fetch("/api/calls/ice", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { iceServers?: RTCIceServer[] };
      if (Array.isArray(data.iceServers) && data.iceServers.length) {
        return { iceServers: data.iceServers };
      }
    }
  } catch {
    /* STUN fallback */
  }
  return fallbackIce;
}

export async function startMediaLoop(opts: {
  video: boolean;
  lowData: boolean;
  deviceId?: string;
  audioDeviceId?: string;
  iceServers?: RTCIceServer[];
}): Promise<LoopSession> {
  const acquired = await acquireCallMedia(opts);
  const local = acquired.stream;

  const ice = await iceConfig(opts.iceServers);
  const pcLocal = new RTCPeerConnection(ice);
  const pcRemote = new RTCPeerConnection(ice);
  const remote = new MediaStream();

  local.getTracks().forEach((t) => pcLocal.addTrack(t, local));
  pcRemote.ontrack = (ev) => {
    ev.streams[0]?.getTracks().forEach((t) => remote.addTrack(t));
  };
  pcLocal.onicecandidate = (e) => {
    if (e.candidate) void pcRemote.addIceCandidate(e.candidate);
  };
  pcRemote.onicecandidate = (e) => {
    if (e.candidate) void pcLocal.addIceCandidate(e.candidate);
  };

  const offer = await pcLocal.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: opts.video });
  await pcLocal.setLocalDescription(offer);
  await pcRemote.setRemoteDescription(offer);
  const answer = await pcRemote.createAnswer();
  await pcRemote.setLocalDescription(answer);
  await pcLocal.setRemoteDescription(answer);

  await applyBitrate(pcLocal, opts.lowData || acquired.voiceFallback);
  return { local, remote, pcLocal, pcRemote, voiceFallback: acquired.voiceFallback };
}

export async function applyBitrate(pc: RTCPeerConnection, lowData: boolean, quality: "auto" | "saver" | "high" | "low" | "medium" = "auto"): Promise<void> {
  const videoMax =
    quality === "saver" || quality === "low" || lowData ? 160_000 : quality === "high" ? 1_500_000 : quality === "medium" ? 700_000 : 900_000;
  const audioMax = quality === "saver" || lowData ? 20_000 : 48_000;
  for (const sender of pc.getSenders()) {
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    params.encodings.forEach((enc) => {
      enc.maxBitrate = sender.track?.kind === "audio" ? audioMax : videoMax;
      enc.priority = sender.track?.kind === "audio" ? "high" : "medium";
    });
    try {
      await sender.setParameters(params);
    } catch {
      /* some browsers reject encodings before negotiation settles */
    }
  }
}

export async function switchCamera(session: LoopSession, facing: "user" | "environment"): Promise<void> {
  const old = session.local.getVideoTracks()[0];
  let next: MediaStream;
  try {
    next = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { exact: facing } },
      audio: false,
    });
  } catch {
    next = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing },
      audio: false,
    });
  }
  const track = next.getVideoTracks()[0];
  if (!track) return;
  const sender = session.pcLocal.getSenders().find((s) => s.track?.kind === "video");
  if (sender) await sender.replaceTrack(track);
  else session.pcLocal.addTrack(track, session.local);
  if (old) {
    session.local.removeTrack(old);
    old.stop();
  }
  session.local.addTrack(track);
}

export async function attachCamera(
  session: LoopSession,
  opts: { lowData: boolean; deviceId?: string; facing?: "user" | "environment" },
): Promise<void> {
  const next = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: videoConstraints(opts),
  });
  const track = next.getVideoTracks()[0];
  if (!track) return;
  const sender = session.pcLocal.getSenders().find((s) => s.track?.kind === "video");
  if (sender) await sender.replaceTrack(track);
  else session.pcLocal.addTrack(track, session.local);
  session.local.getVideoTracks().forEach((t) => {
    if (t !== track) {
      session.local.removeTrack(t);
      t.stop();
    }
  });
  if (!session.local.getVideoTracks().includes(track)) session.local.addTrack(track);
}

export function stopLoop(session: LoopSession | null): void {
  if (!session) return;
  session.local.getTracks().forEach((t) => t.stop());
  session.remote.getTracks().forEach((t) => t.stop());
  session.pcLocal.close();
  if (session.pcRemote !== session.pcLocal) session.pcRemote.close();
  session.stopPoll?.();
}

export async function shareScreen(session: LoopSession): Promise<() => void> {
  const display = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 15, max: 24 } },
    audio: true,
  });
  const track = display.getVideoTracks()[0];
  if (!track) return () => undefined;
  const sender = session.pcLocal.getSenders().find((s) => s.track?.kind === "video");
  const previous = sender?.track ?? session.local.getVideoTracks()[0] ?? null;
  if (sender) await sender.replaceTrack(track);
  else session.pcLocal.addTrack(track, session.local);
  if (previous) {
    session.local.removeTrack(previous);
  }
  session.local.addTrack(track);
  const sysAudio = display.getAudioTracks()[0];
  const audioSender = session.pcLocal.getSenders().find((s) => s.track?.kind === "audio");
  const prevAudio = audioSender?.track ?? null;
  if (sysAudio && audioSender) {
    await audioSender.replaceTrack(sysAudio);
  }
  const stop = () => {
    track.stop();
    display.getTracks().forEach((t) => t.stop());
    if (previous) {
      void sender?.replaceTrack(previous);
      session.local.addTrack(previous);
    }
    session.local.removeTrack(track);
    if (prevAudio && audioSender) void audioSender.replaceTrack(prevAudio);
  };
  track.addEventListener("ended", stop);
  return stop;
}

export async function listAudioOutputs(): Promise<{ deviceId: string; label: string }[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === "audiooutput")
    .map((d) => ({ deviceId: d.deviceId, label: d.label || "خروجی صدا" }));
}

export async function listAudioInputs(): Promise<{ deviceId: string; label: string }[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === "audioinput")
    .map((d) => ({ deviceId: d.deviceId, label: d.label || "میکروفون" }));
}

export async function sampleCallQuality(pc: RTCPeerConnection): Promise<{
  rttMs: number;
  loss: number;
  jitterMs: number;
  framesDecoded: number;
  bitrateKbps: number;
  frozen: boolean;
} | null> {
  try {
    const stats = await pc.getStats();
    let rttMs = 0;
    let loss = 0;
    let jitterMs = 0;
    let framesDecoded = 0;
    let bitrateKbps = 0;
    stats.forEach((r) => {
      const row = r as RTCStats & {
        currentRoundTripTime?: number;
        jitter?: number;
        packetsReceived?: number;
        packetsLost?: number;
        kind?: string;
        state?: string;
        framesDecoded?: number;
        bytesReceived?: number;
        framesPerSecond?: number;
      };
      if (row.type === "candidate-pair" && row.state === "succeeded" && typeof row.currentRoundTripTime === "number") {
        rttMs = Math.round(row.currentRoundTripTime * 1000);
      }
      if (row.type === "inbound-rtp" && row.kind === "audio") {
        if (typeof row.jitter === "number") jitterMs = Math.round(row.jitter * 1000);
        const packets = Number(row.packetsReceived ?? 0);
        const lost = Number(row.packetsLost ?? 0);
        if (packets + lost > 0) loss = Math.min(100, Math.round((lost / (packets + lost)) * 100));
      }
      if (row.type === "inbound-rtp" && row.kind === "video") {
        framesDecoded = Number(row.framesDecoded ?? 0);
        const fps = Number(row.framesPerSecond ?? 0);
        bitrateKbps = fps ? Math.round(fps * 40) : bitrateKbps;
        const packets = Number(row.packetsReceived ?? 0);
        const lost = Number(row.packetsLost ?? 0);
        if (packets + lost > 0) loss = Math.max(loss, Math.min(100, Math.round((lost / (packets + lost)) * 100)));
      }
    });
    return { rttMs, loss, jitterMs, framesDecoded, bitrateKbps, frozen: framesDecoded === 0 && loss >= 8 };
  } catch {
    return null;
  }
}

export function watchVideoFreeze(video: HTMLVideoElement, onFreeze: () => void, onRecover: () => void): () => void {
  let last = 0;
  let stalled = 0;
  let frozen = false;
  const t = window.setInterval(() => {
    const cur = video.currentTime;
    const playing = video.readyState >= 2 && !video.paused;
    if (playing && cur === last) stalled += 1;
    else stalled = 0;
    last = cur;
    if (stalled >= 3 && !frozen) {
      frozen = true;
      onFreeze();
    } else if (stalled === 0 && frozen) {
      frozen = false;
      onRecover();
    }
  }, 1000);
  return () => window.clearInterval(t);
}

export function debugDeviceLabel(): string {
  if (typeof navigator === "undefined") return "server";
  const ua = navigator.userAgent;
  const brw = /firefox/i.test(ua)
    ? "firefox"
    : /edg/i.test(ua)
      ? "edge"
      : /safari/i.test(ua) && !/chrome/i.test(ua)
        ? "safari"
        : /chrome|crios/i.test(ua)
          ? "chrome"
          : "web";
  const plat = /mobile|android|iphone|ipad/i.test(ua) ? "mobile" : "desktop";
  return `${plat}:${brw}`;
}

export function cameraSettingsHint(): string {
  return "دوربین از تنظیمات مرورگر برای این سایت مجاز نیست. Settings → Privacy → Camera را باز کن و نیکسو را Allow کن، بعد «تلاش دوباره تصویر» را بزن.";
}

export async function listCameras(): Promise<{ deviceId: string; label: string }[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === "videoinput").map((d) => ({ deviceId: d.deviceId, label: d.label || "دوربین" }));
}

export async function startCameraPreview(facing: "user" | "environment" = "user"): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } },
  });
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

export function getMediaErrorMessage(err: unknown): string {
  const kind = mediaErrorKind(err);
  if (kind === "camera") return cameraSettingsHint();
  if (kind === "microphone") {
    return "دسترسی میکروفون داده نشد. از تنظیمات مرورگر نیکسو را برای Microphone مجاز کن.";
  }
  if (kind === "screen") return "اشتراک صفحه بدون انتخاب پنجره شروع نمی‌شود.";
  if (kind === "notfound") return "دوربین یا میکروفون روی این دستگاه پیدا نشد.";
  return "شروع تماس انجام نشد.";
}
