import { PUBLIC_CHAT_BACKGROUNDS as PUBLIC_WALLPAPERS, isPublicBackgroundPath } from "@/lib/public-assets";

export { PUBLIC_WALLPAPERS };

export const INACTIVITY_MONTHS = [6, 12, 18, 24] as const;
export type InactivityMonths = (typeof INACTIVITY_MONTHS)[number];

export const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export type NixoFeaturePrefs = {
  ghostMode: boolean;
  silentDefault: boolean;
  hideForwardOriginDefault: boolean;
  translateSkip: string[];
  translateTarget: string;
  glassEnabled: boolean;
  glassOpacity: number;
  glassBlur: number;
  chatWallpaperPublic: string;
  powerSaveEnabled: boolean;
  powerSaveBatteryPct: number;
  powerAutoplayVideo: boolean;
  powerAutoplayGif: boolean;
  powerStickerAnim: boolean;
  powerUiAnim: boolean;
  powerPreload: boolean;
  autoSavePrivatePhotos: boolean;
  autoSavePrivateVideos: boolean;
  autoSaveGroupPhotos: boolean;
  autoSaveGroupVideos: boolean;
  autoSaveChannelPhotos: boolean;
  autoSaveChannelVideos: boolean;
  inactivityDeleteEnabled: boolean;
  inactivityDeleteMonths: InactivityMonths;
};

export function defaultNixoFeaturePrefs(): NixoFeaturePrefs {
  return {
    ghostMode: false,
    silentDefault: false,
    hideForwardOriginDefault: false,
    translateSkip: ["fa", "en"],
    translateTarget: "fa",
    glassEnabled: true,
    glassOpacity: 72,
    glassBlur: 16,
    chatWallpaperPublic: "",
    powerSaveEnabled: true,
    powerSaveBatteryPct: 15,
    powerAutoplayVideo: false,
    powerAutoplayGif: true,
    powerStickerAnim: true,
    powerUiAnim: true,
    powerPreload: true,
    autoSavePrivatePhotos: false,
    autoSavePrivateVideos: false,
    autoSaveGroupPhotos: false,
    autoSaveGroupVideos: false,
    autoSaveChannelPhotos: false,
    autoSaveChannelVideos: false,
    inactivityDeleteEnabled: false,
    inactivityDeleteMonths: 12,
  };
}

export function clampPct(n: unknown, fallback: number) {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function mergeNixoPrefs(raw: Partial<NixoFeaturePrefs> | undefined): NixoFeaturePrefs {
  const d = defaultNixoFeaturePrefs();
  if (!raw) return d;
  const skip = Array.isArray(raw.translateSkip)
    ? raw.translateSkip.map((s) => String(s).toLowerCase()).filter((s) => /^[a-z]{2}$/.test(s)).slice(0, 40)
    : d.translateSkip;
  const months = INACTIVITY_MONTHS.includes(raw.inactivityDeleteMonths as InactivityMonths)
    ? (raw.inactivityDeleteMonths as InactivityMonths)
    : d.inactivityDeleteMonths;
  const wall = typeof raw.chatWallpaperPublic === "string" && isPublicBackgroundPath(raw.chatWallpaperPublic)
    ? raw.chatWallpaperPublic
    : raw.chatWallpaperPublic === ""
      ? ""
      : d.chatWallpaperPublic;
  const target = typeof raw.translateTarget === "string" && /^[a-z]{2}$/.test(raw.translateTarget) ? raw.translateTarget : d.translateTarget;
  return {
    ghostMode: Boolean(raw.ghostMode),
    silentDefault: Boolean(raw.silentDefault),
    hideForwardOriginDefault: Boolean(raw.hideForwardOriginDefault),
    translateSkip: skip,
    translateTarget: target,
    glassEnabled: raw.glassEnabled !== false,
    glassOpacity: clampPct(raw.glassOpacity, d.glassOpacity),
    glassBlur: clampPct(raw.glassBlur, d.glassBlur),
    chatWallpaperPublic: wall,
    powerSaveEnabled: raw.powerSaveEnabled !== false,
    powerSaveBatteryPct: clampPct(raw.powerSaveBatteryPct, d.powerSaveBatteryPct),
    powerAutoplayVideo: Boolean(raw.powerAutoplayVideo),
    powerAutoplayGif: raw.powerAutoplayGif !== false,
    powerStickerAnim: raw.powerStickerAnim !== false,
    powerUiAnim: raw.powerUiAnim !== false,
    powerPreload: raw.powerPreload !== false,
    autoSavePrivatePhotos: Boolean(raw.autoSavePrivatePhotos),
    autoSavePrivateVideos: Boolean(raw.autoSavePrivateVideos),
    autoSaveGroupPhotos: Boolean(raw.autoSaveGroupPhotos),
    autoSaveGroupVideos: Boolean(raw.autoSaveGroupVideos),
    autoSaveChannelPhotos: Boolean(raw.autoSaveChannelPhotos),
    autoSaveChannelVideos: Boolean(raw.autoSaveChannelVideos),
    inactivityDeleteEnabled: Boolean(raw.inactivityDeleteEnabled),
    inactivityDeleteMonths: months,
  };
}

export function inactivityThresholdMs(months: InactivityMonths) {
  return months * 30 * 24 * 60 * 60_000;
}

export function shouldSelfDeleteForInactivity(opts: {
  enabled: boolean;
  months: InactivityMonths;
  lastSeenAt: number;
  createdAt: number;
  accountStatus?: string;
  now: number;
}) {
  if (!opts.enabled) return false;
  if ((opts.accountStatus ?? "active") !== "active") return false;
  const last = opts.lastSeenAt > 0 ? opts.lastSeenAt : opts.createdAt;
  if (!last) return false;
  return opts.now - last >= inactivityThresholdMs(opts.months);
}
