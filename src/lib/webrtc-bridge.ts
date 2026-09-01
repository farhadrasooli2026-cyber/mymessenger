/** Authenticated WebRTC between two NIXO clients. SDP/ICE go through /api/calls/:id/signal. */

import { applyBitrate, type LoopSession } from "@/lib/webrtc-loop";

type BridgeOpts = {
  callId: string;
  offerer: boolean;
  video: boolean;
  lowData: boolean;
  token?: string | null;
  quality?: "auto" | "saver" | "high";
  audioDeviceId?: string;
};

async function iceConfig(): Promise<RTCConfiguration> {
  try {
    const res = await fetch("/api/calls/ice", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { iceServers?: RTCIceServer[] };
      if (data.iceServers?.length) return { iceServers: data.iceServers };
    }
  } catch {
    /* fallback */
  }
  return { iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] };
}

async function postSignal(callId: string, type: string, body: string, token?: string | null) {
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  await fetch(`/api/calls/${callId}/signal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, body, nonce, token: token || undefined }),
  });
}

export async function startBridgedCall(opts: BridgeOpts): Promise<LoopSession & { stopPoll: () => void }> {
  const local = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      deviceId: opts.audioDeviceId ? { exact: opts.audioDeviceId } : undefined,
    },
    video: opts.video
      ? {
          facingMode: "user",
          width: opts.lowData ? { ideal: 480 } : { ideal: 1280 },
          height: opts.lowData ? { ideal: 360 } : { ideal: 720 },
          frameRate: opts.lowData ? { ideal: 15, max: 24 } : { ideal: 30, max: 30 },
        }
      : false,
  });
  const ice = await iceConfig();
  const pc = new RTCPeerConnection(ice);
  const remote = new MediaStream();
  local.getTracks().forEach((t) => pc.addTrack(t, local));
  pc.ontrack = (ev) => {
    ev.streams[0]?.getTracks().forEach((t) => {
      if (!remote.getTracks().some((x) => x.id === t.id)) remote.addTrack(t);
    });
  };
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      void postSignal(opts.callId, "ice", JSON.stringify(e.candidate), opts.token);
    }
  };

  let after = 0;
  const seen = new Set<string>();
  const poll = window.setInterval(async () => {
    const res = await fetch(`/api/calls/${opts.callId}/signal?after=${after}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as {
      items?: { id: string; type: string; fromMe: boolean; body?: string; createdAt: number }[];
    };
    for (const item of data.items ?? []) {
      after = Math.max(after, item.createdAt);
      if (seen.has(item.id) || item.fromMe || !item.body) continue;
      seen.add(item.id);
      try {
        if (item.type === "offer") {
          await pc.setRemoteDescription({ type: "offer", sdp: item.body });
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          if (answer.sdp) void postSignal(opts.callId, "answer", answer.sdp, opts.token);
        } else if (item.type === "answer") {
          if (pc.signalingState === "have-local-offer") {
            await pc.setRemoteDescription({ type: "answer", sdp: item.body });
          }
        } else if (item.type === "ice") {
          const cand = JSON.parse(item.body) as RTCIceCandidateInit;
          if (cand.candidate) await pc.addIceCandidate(cand);
        }
      } catch {
        /* ignore stale SDP */
      }
    }
  }, 700);

  if (opts.offerer) {
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: opts.video });
    await pc.setLocalDescription(offer);
    if (offer.sdp) void postSignal(opts.callId, "offer", offer.sdp, opts.token);
  }

  await applyBitrate(pc, opts.lowData, opts.quality ?? "auto");
  return {
    local,
    remote,
    pcLocal: pc,
    pcRemote: pc,
    stopPoll: () => window.clearInterval(poll),
  };
}
