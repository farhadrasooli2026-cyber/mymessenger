const RESERVED = new Set([
  "nixo",
  "nikso",
  "admin",
  "administrator",
  "support",
  "help",
  "root",
  "system",
  "official",
  "security",
  "nixo_bot",
  "moderator",
  "staff",
  "owner",
  "service",
  "services",
  "helpdesk",
  "privacy",
  "abuse",
  "safety",
  "verify",
  "verified",
  "login",
  "signup",
  "register",
  "account",
  "accounts",
  "api",
  "www",
  "http",
  "https",
  "null",
  "undefined",
]);

const FORBIDDEN = ["porn", "sex", "nazi", "terror", "killadmin", "password", "otpcode"];

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

function looksOfficialImpersonation(raw: string) {
  if (raw === "nixouser1" || raw.startsWith("nixouser")) return false;
  if (raw === "nixo" || raw.startsWith("nixo_") || raw.endsWith("_nixo")) return true;
  if (raw.includes("official") || raw.includes("administrator")) return true;
  const compact = raw.replace(/[._]/g, "");
  if (compact === "nixoofficial" || compact === "officialnixo" || compact === "nixoadmin") return true;
  return false;
}

export function usernameIssue(input: string): "invalid" | "reserved" | null {
  const raw = input.trim().replace(/^@/, "").toLowerCase();
  if (!raw) return "invalid";
  if (/\s/.test(input.trim().replace(/^@/, ""))) return "invalid";
  if (raw.length < USERNAME_MIN || raw.length > USERNAME_MAX) return "invalid";
  if (!/^[a-z][a-z0-9._]{2,19}$/.test(raw)) return "invalid";
  if (raw.includes("..") || raw.includes("__") || raw.endsWith(".") || raw.endsWith("_")) return "invalid";
  if (FORBIDDEN.some((w) => raw.includes(w))) return "invalid";
  if (RESERVED.has(raw) || looksOfficialImpersonation(raw)) return "reserved";
  return null;
}

export function normalizeUsername(input: string): string | null {
  if (usernameIssue(input)) return null;
  return input.trim().replace(/^@/, "").toLowerCase();
}

export const USERNAME_HINT =
  "۳ تا ۲۰ نویسه، با حرف انگلیسی شروع شود؛ فقط حروف کوچک، عدد، نقطه و زیرخط. فاصله و نام‌های سیستمی مجاز نیستند.";

export const USERNAME_STATUS_LABEL = {
  free: "Available",
  taken: "Already Taken",
  invalid: "Invalid Username",
  reserved: "Invalid Username",
  checking: "Checking…",
} as const;
