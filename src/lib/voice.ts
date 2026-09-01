export const VOICE_MAX_MS = 60_000;
export const VOICE_MIN_MS = 600;
export const VOICE_BITRATE = 24_000;
export const VOICE_CIPHER_MAX = 1_200_000;
export const VOICE_UPLOAD_MAX = 900_000;
export const DELETE_EVERYONE_MS = 48 * 60 * 60 * 1000;
export const VOICE_SEND_PER_MIN = 20;
export const VOICE_PLAY_PER_MIN = 80;

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

export function validateVoiceDuration(ms: unknown): { ok: true; ms: number } | { ok: false; error: string } {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return { ok: false, error: "مدت صوت نامعتبر است." };
  const n = Math.floor(ms);
  if (n < VOICE_MIN_MS) return { ok: false, error: "ضبط خیلی کوتاه یا خالی است." };
  if (n > VOICE_MAX_MS) return { ok: false, error: "مدت صوت از سقف سرور بیشتر است." };
  return { ok: true, ms: n };
}

/** Never trust the filename. Only container signatures that look like audio. */
export function sniffVoiceBytes(bytes: Uint8Array): { ok: boolean; mime: string; error?: string } {
  if (bytes.length < 12) return { ok: false, mime: "application/octet-stream", error: "فایل ناقص است." };
  const ascii = String.fromCharCode(...Array.from(bytes.slice(0, Math.min(32, bytes.length))));
  if (/^\s*</.test(ascii) || /<script/i.test(ascii) || /javascript/i.test(ascii)) {
    return { ok: false, mime: "text/html", error: "محتوای اجرایی/HTML به‌عنوان صوت پذیرفته نمی‌شود." };
  }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf) return { ok: true, mime: "audio/webm" };
  if (ascii.startsWith("OggS")) return { ok: true, mime: "audio/ogg" };
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE") return { ok: true, mime: "audio/wav" };
  if (ascii.includes("ftyp")) return { ok: true, mime: "audio/mp4" };
  if (ascii.startsWith("ID3") || (bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0)) return { ok: true, mime: "audio/mpeg" };
  return { ok: false, mime: "application/octet-stream", error: "امضای فایل صوت شناخته نشد." };
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
    if (/html|javascript|svg/i.test(v.mime)) return null;
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
export const VOICE_AUTOPLAY_KEY = "nixo.voice.autoplay";
export const VOICE_SEQ_KEY = "nixo.voice.sequential";
export const VOICE_OFFLINE_Q = "nixo-voice-q";

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

export function voiceAutoPlay(): boolean {
  try {
    return window.localStorage.getItem(VOICE_AUTOPLAY_KEY) === "1";
  } catch {
    return false;
  }
}

export function setVoiceAutoPlay(on: boolean) {
  try {
    window.localStorage.setItem(VOICE_AUTOPLAY_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function voiceSequential(): boolean {
  try {
    return window.localStorage.getItem(VOICE_SEQ_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setVoiceSequential(on: boolean) {
  try {
    window.localStorage.setItem(VOICE_SEQ_KEY, on ? "1" : "0");
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

export function clearVoicePlayCache() {
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(VOICE_POS_PREFIX));
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

export const VOICE_RETRY_MAX = 3;
export const VOICE_EMPTY_BYTES = 64;

export function voiceBitrate(quality?: string, dataSaver?: boolean): number {
  if (dataSaver || quality === "standard") return 16_000;
  if (quality === "original" || quality === "high") return 48_000;
  return VOICE_BITRATE;
}

export function blobLooksEmpty(size: number): boolean {
  return size < VOICE_EMPTY_BYTES;
}

export type AudioRoute = "speaker" | "earpiece" | "headphones" | "bluetooth";

export function classifyAudioLabel(label: string): AudioRoute {
  const l = label.toLowerCase();
  if (l.includes("bluetooth") || l.includes("airpod") || l.includes("headset")) return "bluetooth";
  if (l.includes("headphone") || l.includes("earphone") || l.includes("wired")) return "headphones";
  if (l.includes("earpiece") || l.includes("communication")) return "earpiece";
  return "speaker";
}

export function shouldAutoDownloadVoice(
  prefs: { autoDownloadVoice?: string; dataSaver?: boolean } | null,
  onWifi: boolean,
): boolean {
  if (!prefs) return onWifi;
  if (prefs.dataSaver) return false;
  if (prefs.autoDownloadVoice === "never") return false;
  if (prefs.autoDownloadVoice === "mobile") return true;
  return onWifi;
}
