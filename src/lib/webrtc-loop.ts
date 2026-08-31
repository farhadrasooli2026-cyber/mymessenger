/** In-browser WebRTC loop. Media never leaves the device; server only sees signaling metadata. */

export type LoopSession = {
  local: MediaStream;
  remote: MediaStream;
  pcLocal: RTCPeerConnection;
  pcRemote: RTCPeerConnection;
};

const ice = { iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] };

export async function startMediaLoop(opts: {
  video: boolean;
  lowData: boolean;
  deviceId?: string;
}): Promise<LoopSession> {
  const local = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: opts.video
      ? {
          facingMode: "user",
          width: opts.lowData ? { ideal: 480 } : { ideal: 1280 },
          height: opts.lowData ? { ideal: 360 } : { ideal: 720 },
          deviceId: opts.deviceId ? { exact: opts.deviceId } : undefined,
        }
      : false,
  });

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

export async function applyBitrate(pc: RTCPeerConnection, lowData: boolean): Promise<void> {
  const max = lowData ? 180_000 : 900_000;
  for (const sender of pc.getSenders()) {
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    params.encodings.forEach((enc) => {
      enc.maxBitrate = sender.track?.kind === "audio" ? (lowData ? 24_000 : 48_000) : max;
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

export function permissionMessage(err: unknown): string {
  const name = err && typeof err === "object" && "name" in err ? String((err as { name: string }).name) : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "دسترسی میکروفون یا دوربین داده نشد. از تنظیمات مرورگر نیکسو را مجاز کن.";
  }
  if (name === "NotFoundError") return "میکروفون یا دوربین روی این دستگاه پیدا نشد.";
  return "شروع تماس انجام نشد.";
}
