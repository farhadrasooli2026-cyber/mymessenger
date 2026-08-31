export const MUSIC_MAX_BYTES = 3 * 1024 * 1024;
export const MUSIC_TOKEN_MS = 15 * 60 * 1000;
export const MUSIC_CACHE_MAX = 24;

export type MusicKind = "music" | "song" | "podcast" | "voice" | "file";
export type MusicQuality = "standard" | "high" | "original";
export type RepeatMode = "off" | "all" | "one";

export const MUSIC_KIND_FA: Record<MusicKind, string> = {
  music: "موسیقی",
  song: "آهنگ",
  podcast: "پادکست",
  voice: "صوت",
  file: "فایل صوتی",
};

export type LicensedTone = {
  id: string;
  title: string;
  artist: string;
  album: string;
  freq: number;
  durationMs: number;
};

/** Original NIXO tones — not third-party commercial recordings. */
export const NIXO_TONES: LicensedTone[] = [
  { id: "pulse", title: "نبض کهربا", artist: "NIXO Originals", album: "مجوز داخلی", freq: 392, durationMs: 2500 },
  { id: "breeze", title: "نسیم سبز", artist: "NIXO Originals", album: "مجوز داخلی", freq: 523, durationMs: 2500 },
  { id: "night", title: "شب آرام", artist: "NIXO Originals", album: "مجوز داخلی", freq: 330, durationMs: 3000 },
];

export type MusicPrefs = {
  userId: string;
  autoWifi: boolean;
  autoMobile: boolean;
  autoRoaming: boolean;
  quality: MusicQuality;
  speed: number;
  dataSaver: boolean;
  notifyPlayback: boolean;
  backgroundPlayback: boolean;
  lastTrackId: string | null;
  lastPositionMs: number;
  lastQueue: string[];
  recentlyPlayed: { id: string; catalog: boolean; at: number }[];
};

export const DEFAULT_MUSIC_PREFS: Omit<MusicPrefs, "userId"> = {
  autoWifi: true,
  autoMobile: false,
  autoRoaming: false,
  quality: "standard",
  speed: 1,
  dataSaver: false,
  notifyPlayback: true,
  backgroundPlayback: true,
  lastTrackId: null,
  lastPositionMs: 0,
  lastQueue: [],
  recentlyPlayed: [],
};
