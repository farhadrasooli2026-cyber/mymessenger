const RESERVED = new Set([
  "nixo",
  "nikso",
  "admin",
  "support",
  "help",
  "root",
  "system",
  "official",
  "security",
  "nixo_bot",
]);

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

export function normalizeUsername(input: string): string | null {
  const raw = input.trim().replace(/^@/, "").toLowerCase();
  if (raw.length < USERNAME_MIN || raw.length > USERNAME_MAX) return null;
  if (!/^[a-z][a-z0-9._]{2,19}$/.test(raw)) return null;
  if (raw.includes("..") || raw.includes("__") || raw.endsWith(".") || raw.endsWith("_")) return null;
  if (RESERVED.has(raw)) return null;
  return raw;
}

export const USERNAME_HINT =
  "۳ تا ۲۰ نویسه، با حرف انگلیسی شروع شود؛ فقط حروف کوچک، عدد، نقطه و زیرخط.";
