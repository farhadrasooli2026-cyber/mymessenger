/** Client-safe release identity. No secrets, no env values. */

export const APP_VERSION = "0.1.1";
export const APP_CHANNEL = "nixo";
export const MIN_CLIENT_VERSION = "0.1.0";
export const MOBILE_COMPAT = "0.1";

export function parseSemver(v: string): { major: number; minor: number; patch: number } | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function bumpPatch(v: string): string {
  const p = parseSemver(v);
  if (!p) return "0.1.1";
  return `${p.major}.${p.minor}.${p.patch + 1}`;
}

export function semverGte(a: string, b: string): boolean {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) return a === b;
  if (x.major !== y.major) return x.major > y.major;
  if (x.minor !== y.minor) return x.minor > y.minor;
  return x.patch >= y.patch;
}

/** Git SHA from the host (Render sets RENDER_GIT_COMMIT). Empty locally unless injected. */
export function deployedGitSha(): string {
  const candidates = [
    process.env.RENDER_GIT_COMMIT,
    process.env.SOURCE_VERSION,
    process.env.COMMIT_SHA,
    process.env.GIT_COMMIT,
    process.env.VERCEL_GIT_COMMIT_SHA,
  ];
  for (const raw of candidates) {
    const v = (raw ?? "").trim().toLowerCase();
    if (/^[a-f0-9]{7,40}$/.test(v)) return v.slice(0, 40);
  }
  return "";
}

export function publicReleaseInfo() {
  const gitSha = deployedGitSha();
  return {
    product: "NIXO",
    app: APP_VERSION,
    api: "1",
    compat: "0",
    minClient: MIN_CLIENT_VERSION,
    mobileCompat: MOBILE_COMPAT,
    gitSha,
  };
}
