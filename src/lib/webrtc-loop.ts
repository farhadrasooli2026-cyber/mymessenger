/** In-browser WebRTC loop. Media never leaves the device; server only sees signaling metadata. */

export type LoopSession = {
  local: MediaStream;
  remote: MediaStream;
  pcLocal: RTCPeerConnection;
  pcRemote: RTCPeerConnection;
};

const fallbackIce: RTCConfiguration = { iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] };

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
  iceServers?: RTCIceServer[];
}): Promise<LoopSession> {
  const local = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: opts.video
      ? {
          facingMode: "user",
          width: opts.lowData ? { ideal: 480 } : { ideal: 1280 },
          height: opts.lowData ? { ideal: 360 } : { ideal: 720 },
          frameRate: opts.lowData ? { ideal: 15, max: 24 } : { ideal: 30, max: 30 },
          deviceId: opts.deviceId ? { exact: opts.deviceId } : undefined,
        }
      : false,
  });

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

  await applyBitrate(pcLocal, opts.lowData);
  return { local, remote, pcLocal, pcRemote };
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
  const next = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { exact: facing } },
    audio: false,
  });
  const track = next.getVideoTracks()[0];
  if (!track) return;
  const sender = session.pcLocal.getSenders().find((s) => s.track?.kind === "video");
  await sender?.replaceTrack(track);
  if (old) {
    session.local.removeTrack(old);
    old.stop();
  }
  session.local.addTrack(track);
}

export function stopLoop(session: LoopSession | null): void {
  if (!session) return;
  session.local.getTracks().forEach((t) => t.stop());
  session.remote.getTracks().forEach((t) => t.stop());
  session.pcLocal.close();
  session.pcRemote.close();
}

export async function shareScreen(session: LoopSession): Promise<() => void> {
  const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  const track = display.getVideoTracks()[0];
  if (!track) return () => undefined;
  const sender = session.pcLocal.getSenders().find((s) => s.track?.kind === "video");
  const previous = sender?.track ?? session.local.getVideoTracks()[0] ?? null;
  await sender?.replaceTrack(track);
  if (previous) {
    session.local.removeTrack(previous);
  }
  session.local.addTrack(track);
  const stop = () => {
    track.stop();
    display.getTracks().forEach((t) => t.stop());
    if (previous) {
      void sender?.replaceTrack(previous);
      session.local.addTrack(previous);
    }
    session.local.removeTrack(track);
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

export async function sampleCallQuality(pc: RTCPeerConnection): Promise<{ rttMs: number; loss: number; jitterMs: number } | null> {
  try {
    const stats = await pc.getStats();
    let rttMs = 0;
    let loss = 0;
    let jitterMs = 0;
    stats.forEach((r) => {
      const row = r as RTCStats & {
        currentRoundTripTime?: number;
        jitter?: number;
        packetsReceived?: number;
        packetsLost?: number;
        kind?: string;
        state?: string;
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
    });
    return { rttMs, loss, jitterMs };
  } catch {
    return null;
  }
}

export function getMediaErrorMessage(err: unknown): string {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: string }).name) : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "دسترسی میکروفون یا دوربین داده نشد. از تنظیمات مرورگر نیکسو را مجاز کن.";
  }
  if (name === "NotFoundError") return "میکروفون یا دوربین روی این دستگاه پیدا نشد.";
  return "شروع تماس انجام نشد.";
}
