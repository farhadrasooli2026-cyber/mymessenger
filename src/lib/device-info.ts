export const APP_VERSION = "0.1.0-web";
export const DEVICE_INACTIVE_MS = 72 * 60 * 60 * 1000;
export const SESSION_EXPIRE_INACTIVE_MS = 90 * 24 * 60 * 60 * 1000;

export type DeviceKind = "phone" | "tablet" | "desktop" | "unknown";

export function parseUserAgent(ua: string) {
  const s = ua || "";
  const lower = s.toLowerCase();
  let kind: DeviceKind = "desktop";
  if (/ipad|tablet|kindle/.test(lower)) kind = "tablet";
  else if (/iphone|android.+mobile|mobile/.test(lower)) kind = "phone";
  else if (!s || s === "unknown") kind = "unknown";

  let os = "Unknown";
  if (/iphone|ipad|ios/.test(lower)) os = "iOS";
  else if (/android/.test(lower)) os = "Android";
  else if (/windows/.test(lower)) os = "Windows";
  else if (/mac os x|macintosh/.test(lower)) os = "macOS";
  else if (/linux/.test(lower)) os = "Linux";

  const name =
    kind === "phone"
      ? os === "iOS"
        ? "iPhone"
        : os === "Android"
          ? "Android Phone"
          : "Mobile"
      : kind === "tablet"
        ? os === "iOS"
          ? "iPad"
          : "Tablet"
        : os === "macOS"
          ? "Mac"
          : os === "Windows"
            ? "Windows PC"
            : os === "Linux"
              ? "Linux PC"
              : "Web Browser";

  return { kind, os, name };
}

export function deviceKindFa(kind: DeviceKind) {
  if (kind === "phone") return "گوشی";
  if (kind === "tablet") return "تبلت";
  if (kind === "desktop") return "رایانه / وب";
  return "نامشخص";
}
