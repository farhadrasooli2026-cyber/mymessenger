export const VOICE_MAX_MS = 60_000;
export const VOICE_MIN_MS = 600;
export const VOICE_BITRATE = 24_000;
export const VOICE_CIPHER_MAX = 1_200_000;
export const DELETE_EVERYONE_MS = 48 * 60 * 60 * 1000;

export { DISAPPEAR_PRESETS, type DisappearId } from "@/lib/disappear";

export type VoiceInner = {
  mime: string;
  audio: string;
  durationMs: number;
  peaks: number[];
};

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function pickRecorderMime(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? "audio/webm";
}

export function parseVoiceInner(raw: string): VoiceInner | null {
  try {
    const v = JSON.parse(raw) as VoiceInner;
    if (typeof v.audio !== "string" || v.audio.length < 8) return null;
    if (typeof v.mime !== "string") return null;
    return {
      mime: v.mime,
      audio: v.audio,
      durationMs: Number(v.durationMs) || 0,
      peaks: Array.isArray(v.peaks) ? v.peaks.map((n) => Number(n) || 0).slice(0, 64) : [],
    };
  } catch {
    return null;
  }
}

export const VOICE_SAVE_KEY = "nixo.voice.save";
export const VOICE_POS_PREFIX = "nixo.voice.pos.";

export function voiceSaveAllowed(): boolean {
  try {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(VOICE_SAVE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setVoiceSaveAllowed(on: boolean): void {
  try {
    window.localStorage.setItem(VOICE_SAVE_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function loadPlayHead(id: string): number {
  try {
    const n = Number(window.localStorage.getItem(`${VOICE_POS_PREFIX}${id}`) ?? "0");
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function savePlayHead(id: string, t: number): void {
  try {
    window.localStorage.setItem(`${VOICE_POS_PREFIX}${id}`, String(t));
  } catch {
    /* ignore */
  }
}
