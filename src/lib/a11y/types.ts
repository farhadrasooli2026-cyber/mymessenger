/** Client-safe accessibility types. No secrets. */

export const FONT_SCALES = [100, 125, 150, 175] as const;
export type FontScale = (typeof FONT_SCALES)[number];

export const LIVE_ANNOUNCE = ["off", "polite", "all"] as const;
export type LiveAnnounce = (typeof LIVE_ANNOUNCE)[number];

export type A11yPrefs = {
  reducedMotion: boolean;
  highContrast: boolean;
  screenReaderHints: boolean;
  fontScale: FontScale;
  reduceTransparency: boolean;
  underlineLinks: boolean;
  largeTargets: boolean;
  keyboardShortcuts: boolean;
  liveAnnounce: LiveAnnounce;
  timeoutWarnings: boolean;
  followSystem: boolean;
};

export const A11Y_COOKIE = "nixo_a11y";

export function defaultA11yPrefs(): A11yPrefs {
  return {
    reducedMotion: false,
    highContrast: false,
    screenReaderHints: true,
    fontScale: 100,
    reduceTransparency: false,
    underlineLinks: false,
    largeTargets: true,
    keyboardShortcuts: true,
    liveAnnounce: "polite",
    timeoutWarnings: true,
    followSystem: true,
  };
}

export function hydrateA11yPrefs(raw: unknown): A11yPrefs {
  const base = defaultA11yPrefs();
  if (!raw || typeof raw !== "object") return base;
  const p = raw as Record<string, unknown>;
  if (typeof p.reducedMotion === "boolean") base.reducedMotion = p.reducedMotion;
  if (typeof p.highContrast === "boolean") base.highContrast = p.highContrast;
  if (typeof p.screenReaderHints === "boolean") base.screenReaderHints = p.screenReaderHints;
  if (p.fontScale === 100 || p.fontScale === 125 || p.fontScale === 150 || p.fontScale === 175) {
    base.fontScale = p.fontScale;
  }
  if (typeof p.reduceTransparency === "boolean") base.reduceTransparency = p.reduceTransparency;
  if (typeof p.underlineLinks === "boolean") base.underlineLinks = p.underlineLinks;
  if (typeof p.largeTargets === "boolean") base.largeTargets = p.largeTargets;
  if (typeof p.keyboardShortcuts === "boolean") base.keyboardShortcuts = p.keyboardShortcuts;
  if (p.liveAnnounce === "off" || p.liveAnnounce === "polite" || p.liveAnnounce === "all") {
    base.liveAnnounce = p.liveAnnounce;
  }
  if (typeof p.timeoutWarnings === "boolean") base.timeoutWarnings = p.timeoutWarnings;
  if (typeof p.followSystem === "boolean") base.followSystem = p.followSystem;
  if (typeof p.followSystemA11y === "boolean") base.followSystem = p.followSystemA11y;
  return base;
}
