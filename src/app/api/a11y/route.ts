import { cookies } from "next/headers";
import { z } from "zod";
import { json, jsonError } from "@/lib/http";
import { requireActiveSession } from "@/lib/auth";
import { updateAccountPrefs } from "@/lib/account";
import { A11Y_COOKIE, defaultA11yPrefs, hydrateA11yPrefs } from "@/lib/a11y/types";

const patchSchema = z.object({
  reducedMotion: z.boolean().optional(),
  highContrast: z.boolean().optional(),
  screenReaderHints: z.boolean().optional(),
  fontScale: z.union([z.literal(100), z.literal(125), z.literal(150), z.literal(175)]).optional(),
  reduceTransparency: z.boolean().optional(),
  underlineLinks: z.boolean().optional(),
  largeTargets: z.boolean().optional(),
  keyboardShortcuts: z.boolean().optional(),
  liveAnnounce: z.enum(["off", "polite", "all"]).optional(),
  timeoutWarnings: z.boolean().optional(),
  followSystemA11y: z.boolean().optional(),
});

function cookiePrefs(raw: string | undefined) {
  if (!raw) return defaultA11yPrefs();
  try {
    return hydrateA11yPrefs(JSON.parse(raw));
  } catch {
    return defaultA11yPrefs();
  }
}

export async function GET() {
  const jar = await cookies();
  const guest = cookiePrefs(jar.get(A11Y_COOKIE)?.value);
  const ctx = await requireActiveSession();
  if (!ctx) return json({ ok: true, prefs: guest, source: "device" });
  const { getAccount } = await import("@/lib/account");
  const account = await getAccount(ctx.user.id);
  const prefs = hydrateA11yPrefs({ ...guest, ...(account?.prefs ?? {}), followSystem: account?.prefs.followSystemA11y });
  return json({ ok: true, prefs, source: "account" });
}

export async function POST(request: Request) {
  let parsed: z.infer<typeof patchSchema>;
  try {
    parsed = patchSchema.parse(await request.json());
  } catch {
    return jsonError("درخواست نامعتبر است.", 400);
  }
  const jar = await cookies();
  const next = hydrateA11yPrefs({ ...cookiePrefs(jar.get(A11Y_COOKIE)?.value), ...parsed, followSystem: parsed.followSystemA11y });
  jar.set(A11Y_COOKIE, JSON.stringify(next), { path: "/", maxAge: 31_536_000, sameSite: "lax", httpOnly: false });
  const ctx = await requireActiveSession();
  if (!ctx) return json({ ok: true, prefs: next, source: "device" });
  const result = await updateAccountPrefs(ctx.user.id, { ...parsed, followSystemA11y: parsed.followSystemA11y ?? next.followSystem });
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true, prefs: hydrateA11yPrefs({ ...result.prefs, followSystem: result.prefs.followSystemA11y }), source: "account" });
}
