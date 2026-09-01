import { z } from "zod";
import { json, jsonError } from "@/lib/http";
import { requireActiveSession } from "@/lib/auth";
import { applyClientLocale, i18nAdminDashboard, i18nAdminMutate, publicI18nState, recordMissingKeys } from "@/lib/i18n-admin";
import { t } from "@/lib/i18n/t";
import { COUNTRIES } from "@/lib/i18n/countries";
import { TIMEZONES } from "@/lib/prefs-types";

export async function GET(request: Request) {
  const view = new URL(request.url).searchParams.get("view");
  if (view === "admin") {
    const r = await i18nAdminDashboard();
    if (!r.ok) return jsonError(r.error, r.status);
    return json(r);
  }
  const accept = request.headers.get("accept-language");
  const state = await publicI18nState(accept);
  const locale = state.locale;
  return json({
    ...state,
    timezones: TIMEZONES,
    countries: COUNTRIES.map((c) => ({ iso: c.iso, nativeName: c.nativeName, dial: c.dial })),
    sample: t("lang.title", { locale }),
  });
}

const bodySchema = z.object({
  action: z.enum(["detect", "set", "missing", "enable", "overlay", "provider", "clear-missing"]),
  locale: z.string().max(16).optional(),
  timezone: z.string().max(64).optional(),
  scope: z.enum(["account", "device"]).optional(),
  key: z.string().max(120).optional(),
  text: z.string().max(2000).optional(),
  locales: z.array(z.string().max(8)).max(12).optional(),
  provider: z.enum(["none", "mock"]).optional(),
});

export async function POST(request: Request) {
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch {
    return jsonError("درخواست نامعتبر است.", 400);
  }

  if (parsed.action === "detect" || parsed.action === "set") {
    const session = await requireActiveSession();
    const accept = request.headers.get("accept-language");
    const r = await applyClientLocale({
      locale: parsed.action === "detect" ? parsed.locale : parsed.locale,
      timezone: parsed.timezone,
      userId: session?.user.id ?? null,
      scope: parsed.scope,
      acceptLanguage: parsed.action === "detect" ? accept : undefined,
    });
    return json(r);
  }

  if (parsed.action === "missing") {
    const r = await recordMissingKeys();
    return json(r);
  }

  if (parsed.action === "enable" || parsed.action === "overlay" || parsed.action === "provider" || parsed.action === "clear-missing") {
    const r = await i18nAdminMutate({
      action: parsed.action,
      locales: parsed.locales,
      locale: parsed.locale,
      key: parsed.key,
      text: parsed.text,
      provider: parsed.provider,
    });
    if (!r.ok) return jsonError(r.error, r.status);
    return json(r);
  }

  return jsonError("عملیات نامعتبر است.", 400);
}
