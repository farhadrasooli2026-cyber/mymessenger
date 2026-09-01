import "server-only";
import { cookies } from "next/headers";
import { randomId } from "@/lib/crypto-utils";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import { requireStaff } from "@/lib/admin-moderation";
import { NIXO_LOCALES, TIMEZONES, defaultUserPrefs } from "@/lib/prefs-types";
import { DEFAULT_TZ, I18N_COOKIE_MAX_AGE, LANG_COOKIE, TZ_COOKIE } from "@/lib/i18n/cookies";
import {
  DEFAULT_ENABLED_LOCALES,
  DEFAULT_LOCALE,
  LANGUAGE_CATALOG,
  detectLocaleFromAccept,
  localeDir,
  parseLocale,
  TRANSLATION_VERSION,
  type NixoLocale,
} from "@/lib/i18n/languages";
import { setTranslationOverlays, drainMissingKeys } from "@/lib/i18n/t";
import type { TranslateProviderId } from "@/lib/i18n/provider";

export { LANG_COOKIE, TZ_COOKIE };

function cookieOpts() {
  return {
    httpOnly: false,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: I18N_COOKIE_MAX_AGE,
  };
}

export async function readLangCookies() {
  const jar = await cookies();
  const lang = parseLocale(jar.get(LANG_COOKIE)?.value);
  const tzRaw = jar.get(TZ_COOKIE)?.value?.trim() || "";
  const timezone = tzRaw && tzRaw.length < 80 ? tzRaw : DEFAULT_TZ;
  return { locale: lang, timezone, hasLang: Boolean(jar.get(LANG_COOKIE)?.value) };
}

export async function writeLangCookies(locale: NixoLocale, timezone: string) {
  const jar = await cookies();
  jar.set(LANG_COOKIE, locale, cookieOpts());
  if (timezone) jar.set(TZ_COOKIE, timezone.slice(0, 64), cookieOpts());
}

export async function syncOverlaysFromStore() {
  const data = await readStoreSnapshot();
  setTranslationOverlays(data.i18n?.overlays ?? {});
}

export async function publicI18nState(acceptLanguage?: string | null) {
  await syncOverlaysFromStore();
  const cookiesState = await readLangCookies();
  const data = await readStoreSnapshot();
  const enabled = data.i18n?.enabledLocales?.length ? data.i18n.enabledLocales : [...DEFAULT_ENABLED_LOCALES];
  let locale = cookiesState.locale;
  let source: "cookie" | "account" | "default" = cookiesState.hasLang ? "cookie" : "default";
  if (!cookiesState.hasLang) {
    const { requireActiveSession } = await import("@/lib/auth");
    const session = await requireActiveSession();
    const prefs = session ? data.users.find((u) => u.id === session.user.id)?.prefs : null;
    if (prefs?.languageScope === "account" && prefs.locale && enabled.includes(prefs.locale)) {
      locale = prefs.locale;
      source = "account";
    } else {
      locale = detectLocaleFromAccept(acceptLanguage);
      if (!enabled.includes(locale)) locale = DEFAULT_LOCALE;
    }
  }
  if (!enabled.includes(locale)) locale = enabled.includes(DEFAULT_LOCALE) ? DEFAULT_LOCALE : (enabled[0] ?? DEFAULT_LOCALE);
  return {
    ok: true as const,
    locale,
    dir: localeDir(locale),
    timezone: cookiesState.timezone,
    version: TRANSLATION_VERSION,
    enabledLocales: enabled,
    languages: LANGUAGE_CATALOG.filter((l) => enabled.includes(l.code)).map((l) => ({
      code: l.code,
      nativeName: l.nativeName,
      displayName: l.displayName,
      direction: l.direction,
    })),
    provider: data.i18n?.provider ?? "none",
    source,
  };
}

export async function applyClientLocale(input: {
  locale?: string;
  timezone?: string;
  userId?: string | null;
  scope?: "account" | "device";
  acceptLanguage?: string | null;
}) {
  const snap = await readStoreSnapshot();
  const enabled = snap.i18n?.enabledLocales?.length ? snap.i18n.enabledLocales : [...DEFAULT_ENABLED_LOCALES];
  let locale = parseLocale(input.locale);
  if (!input.locale) locale = detectLocaleFromAccept(input.acceptLanguage);
  if (!enabled.includes(locale)) locale = DEFAULT_LOCALE;
  const timezone = (input.timezone || DEFAULT_TZ).slice(0, 64);
  await writeLangCookies(locale, timezone);
  if (input.userId && (input.scope ?? "device") === "account") {
    await mutateStore((store) => {
      const user = store.users.find((u) => u.id === input.userId);
      if (!user) return;
      user.prefs ??= defaultUserPrefs();
      if ((NIXO_LOCALES as readonly string[]).includes(locale)) user.prefs.locale = locale;
      user.prefs.languageScope = "account";
      if ((TIMEZONES as readonly string[]).includes(timezone)) {
        user.prefs.timezone = timezone as (typeof user.prefs)["timezone"];
      }
    });
  }
  return { ok: true as const, locale, timezone, dir: localeDir(locale) };
}

export async function recordMissingKeys() {
  const hits = drainMissingKeys();
  if (!hits.length) return { ok: true as const, added: 0 };
  await mutateStore((data) => {
    data.i18n ??= emptySafe();
    for (const h of hits) {
      if (data.i18n.missing.some((m) => m.key === h.key && m.locale === h.locale)) continue;
      data.i18n.missing.push(h);
    }
    if (data.i18n.missing.length > 400) data.i18n.missing = data.i18n.missing.slice(-400);
  });
  return { ok: true as const, added: hits.length };
}

function emptySafe() {
  return {
    enabledLocales: [...DEFAULT_ENABLED_LOCALES] as NixoLocale[],
    overlays: {} as Partial<Record<NixoLocale, Record<string, string>>>,
    missing: [] as { key: string; locale: string; at: number }[],
    audit: [] as { id: string; actorUserId: string; action: string; at: number; detail: string }[],
    provider: "none" as TranslateProviderId,
  };
}

export async function i18nAdminDashboard() {
  const ctx = await requireStaff("i18n.view");
  if (!ctx.ok) return ctx;
  await syncOverlaysFromStore();
  const data = await readStoreSnapshot();
  const i18n = data.i18n ?? emptySafe();
  return {
    ok: true as const,
    enabledLocales: i18n.enabledLocales,
    overlays: i18n.overlays,
    missing: i18n.missing.slice(-80),
    audit: i18n.audit.slice(-40).map((a) => ({ id: a.id, action: a.action, at: a.at, detail: a.detail })),
    provider: i18n.provider,
    languages: LANGUAGE_CATALOG,
    version: TRANSLATION_VERSION,
  };
}

export async function i18nAdminMutate(input: {
  action: "enable" | "overlay" | "provider" | "clear-missing";
  locales?: string[];
  locale?: string;
  key?: string;
  text?: string;
  provider?: string;
}) {
  const ctx = await requireStaff("i18n.manage");
  if (!ctx.ok) return ctx;
  return mutateStore((data) => {
    const gate = hitRateLimit(data, `i18n:admin:${ctx.user.id}`, 60_000, 40);
    if (!gate.allowed) return { ok: false as const, error: "تعداد درخواست بیش از حد است.", status: 429 };
    data.i18n ??= emptySafe();
    if (input.action === "enable") {
      const next = (input.locales ?? []).filter((c): c is NixoLocale => (NIXO_LOCALES as readonly string[]).includes(c));
      if (!next.includes("fa")) next.unshift("fa");
      data.i18n.enabledLocales = Array.from(new Set(next));
    } else if (input.action === "overlay") {
      const loc = parseLocale(input.locale);
      const key = (input.key ?? "").slice(0, 120);
      const text = (input.text ?? "").slice(0, 2000);
      if (!key) return { ok: false as const, error: "کلید لازم است.", status: 400 };
      if (/(password|secret|token|nixo_reg|nixo_staff)/i.test(key + text)) {
        return { ok: false as const, error: "این مقدار مجاز نیست.", status: 400 };
      }
      data.i18n.overlays[loc] ??= {};
      if (!text) delete data.i18n.overlays[loc]![key];
      else data.i18n.overlays[loc]![key] = text;
      setTranslationOverlays(data.i18n.overlays);
    } else if (input.action === "provider") {
      data.i18n.provider = input.provider === "mock" ? "mock" : "none";
    } else if (input.action === "clear-missing") {
      data.i18n.missing = [];
    }
    data.i18n.audit.push({
      id: randomId(),
      actorUserId: ctx.user.id,
      action: input.action,
      at: Date.now(),
      detail: input.key ? input.key : input.action,
    });
    if (data.i18n.audit.length > 200) data.i18n.audit = data.i18n.audit.slice(-200);
    return {
      ok: true as const,
      enabledLocales: data.i18n.enabledLocales,
      overlays: data.i18n.overlays,
      provider: data.i18n.provider,
      missing: data.i18n.missing.slice(-80),
    };
  });
}
