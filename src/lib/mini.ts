import "server-only";
import { hashOtp, hmacIdentifier, newSalt, otpHashesEqual, randomId, signPayload, verifyPayload } from "@/lib/crypto-utils";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot, type StoreData } from "@/lib/store";
import type { MiniAccessLog, MiniAppRecord, MiniGrant, MiniReview, MiniSession } from "@/lib/bot-types";
import {
  MINI_CATEGORIES,
  MINI_SCOPE_FA,
  MINI_SCOPES,
  MINI_SENSITIVE,
  type MiniAppStatus,
  type MiniCategory,
  type MiniScope,
} from "@/lib/bot-types";
import { emitNotification } from "@/lib/notify";
import { scanNamedFile } from "@/lib/files";
import { fileReport } from "@/lib/safety";

const MINI_TOKEN_TTL = 30 * 60_000;
const MINI_API_MAX = 40;
const MINI_NOTIFY_MAX = 6;

function liveBot(data: StoreData, botId: string) {
  return data.bots.find((b) => b.id === botId && b.status === "active");
}

export function hydrateMini(m: MiniAppRecord): MiniAppRecord {
  const cat = MINI_CATEGORIES.some((c) => c.id === m.category) ? m.category : "utilities";
  const status: MiniAppStatus =
    m.status === "maintenance" || m.status === "suspended" || m.status === "removed" || m.status === "pending" || m.status === "active"
      ? m.status
      : "active";
  const requested = (m.requestedScopes ?? ["profile"]).filter((s): s is MiniScope => (MINI_SCOPES as readonly string[]).includes(s));
  return {
    ...m,
    category: cat,
    version: m.version || "1.0.0",
    status,
    requestedScopes: requested.length ? requested : ["profile"],
    privacyUrl: m.privacyUrl ?? "",
    termsUrl: m.termsUrl ?? "",
    webUrl: m.webUrl ?? null,
    iconDataUrl: m.iconDataUrl ?? "",
    updatedAt: m.updatedAt ?? m.createdAt,
  };
}

function wrapHtml(html: string) {
  const csp =
    "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; base-uri 'none'";
  if (/<head/i.test(html)) {
    return html.replace(/<head/i, `<head><meta http-equiv="Content-Security-Policy" content="${csp}"`);
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body>${html}</body></html>`;
}

function grantOf(data: StoreData, userId: string, miniId: string) {
  return (data.miniGrants ?? []).find((g) => g.miniAppId === miniId && g.userId === userId && !g.revokedAt);
}

function scopesOf(g: MiniGrant | undefined): MiniScope[] {
  if (!g || g.revokedAt) return [];
  const s = g.scopes ?? (g.profile ? (["profile"] as MiniScope[]) : []);
  return s;
}

function hasScope(g: MiniGrant | undefined, scope: MiniScope) {
  return scopesOf(g).includes(scope);
}

function logAccess(data: StoreData, miniId: string, userId: string, action: string) {
  data.miniAccessLogs = [
    { id: randomId(), miniAppId: miniId, userId, action: action.slice(0, 80), at: Date.now() } satisfies MiniAccessLog,
    ...(data.miniAccessLogs ?? []),
  ].slice(0, 2000);
}

function mintGrantToken(userId: string, miniId: string, scopes: MiniScope[]) {
  const exp = Date.now() + MINI_TOKEN_TTL;
  const token = signPayload({ v: 1, kind: "mini", userId, miniId, scopes, exp });
  const salt = newSalt();
  return { token, salt, hash: hashOtp(token.slice(-48), salt), exp };
}

export function publicMiniCard(data: StoreData, m: MiniAppRecord, userId?: string) {
  const mini = hydrateMini(m);
  const bot = liveBot(data, mini.botId);
  const reviews = (data.miniReviews ?? []).filter((r) => r.miniAppId === mini.id && !r.hidden);
  const avg = reviews.length ? reviews.reduce((n, r) => n + r.stars, 0) / reviews.length : 0;
  const grant = userId ? grantOf(data, userId, mini.id) : undefined;
  return {
    id: mini.id,
    title: mini.title,
    category: mini.category,
    description: mini.description,
    version: mini.version,
    status: mini.status,
    iconDataUrl: mini.iconDataUrl || null,
    developer: bot ? { name: bot.name, username: bot.username, verified: bot.verified } : { name: "ناشناس", username: "", verified: false },
    verified: Boolean(bot?.verified),
    requestedScopes: mini.requestedScopes,
    scopeLabels: (mini.requestedScopes ?? []).map((s) => MINI_SCOPE_FA[s]),
    privacyUrl: mini.privacyUrl,
    termsUrl: mini.termsUrl,
    paymentHint: mini.paymentHint,
    webUrlHost: mini.webUrl ? safeHttpsHost(mini.webUrl) : null,
    rating: Math.round(avg * 10) / 10,
    reviewCount: reviews.length,
    installed: Boolean(grant?.installed),
    favorite: Boolean(grant?.favorite),
    lastUsedAt: grant?.lastUsedAt ?? 0,
  };
}

function safeHttpsHost(url: string) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return null;
    return u.host;
  } catch {
    return null;
  }
}

export function validMiniWebUrl(url: string) {
  return Boolean(safeHttpsHost(url));
}

export async function listMiniDirectory(userId: string, q = "", category?: string) {
  const data = await readStoreSnapshot();
  const needle = q.trim().toLowerCase();
  const items = (data.miniApps ?? [])
    .map(hydrateMini)
    .filter((m) => m.status === "active" || m.status === "maintenance")
    .filter((m) => liveBot(data, m.botId))
    .filter((m) => !category || m.category === category)
    .filter((m) => !needle || `${m.title} ${m.description} ${m.category}`.toLowerCase().includes(needle))
    .map((m) => publicMiniCard(data, m, userId));
  const grantList = (data.miniGrants ?? []).filter((g) => g.userId === userId && !g.revokedAt);
  const recent = [...grantList].sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)).slice(0, 8);
  const favs = grantList.filter((g) => g.favorite).map((g) => g.miniAppId);
  return {
    ok: true as const,
    categories: MINI_CATEGORIES,
    items,
    recent: recent.map((g) => items.find((i) => i.id === g.miniAppId)).filter(Boolean),
    favorites: items.filter((i) => favs.includes(i.id)),
  };
}

export async function getMiniProfile(userId: string, miniId: string) {
  const data = await readStoreSnapshot();
  const raw = (data.miniApps ?? []).find((m) => m.id === miniId);
  if (!raw) return { ok: false as const, error: "مینی‌اپ یافت نشد.", status: 404 };
  const mini = hydrateMini(raw);
  if (mini.status === "removed") return { ok: false as const, error: "این App حذف شده و از لینک قدیمی باز نمی‌شود.", status: 410 };
  const bot = liveBot(data, mini.botId);
  if (!bot && mini.status !== "maintenance") return { ok: false as const, error: "توسعه‌دهنده فعال نیست.", status: 404 };
  const reviews = (data.miniReviews ?? []).filter((r) => r.miniAppId === miniId && !r.hidden).slice(0, 20);
  const grant = grantOf(data, userId, miniId);
  return {
    ok: true as const,
    app: publicMiniCard(data, mini, userId),
    reviews: reviews.map((r) => ({
      id: r.id,
      stars: r.stars,
      body: r.body,
      createdAt: r.createdAt,
      mine: r.userId === userId,
    })),
    grant: {
      scopes: scopesOf(grant),
      installed: Boolean(grant?.installed),
      favorite: Boolean(grant?.favorite),
      tokenExp: grant?.tokenExp ?? null,
    },
  };
}

export async function openMiniSession(userId: string, miniId: string) {
  return mutateStore((data) => {
    const raw = (data.miniApps ?? []).find((m) => m.id === miniId);
    if (!raw) return { ok: false as const, error: "مینی‌اپ یافت نشد.", status: 404 };
    const mini = hydrateMini(raw);
    if (mini.status === "removed") {
      return { ok: false as const, error: "App حذف شده و از لینک قدیمی باز نمی‌شود.", status: 410 };
    }
    if (mini.status === "suspended") {
      return { ok: false as const, error: "این App معلق است و برای کاربران جدید قابل استفاده نیست.", status: 403 };
    }
    if (mini.status === "pending") {
      const botOwner = data.bots.find((b) => b.id === mini.botId);
      if (botOwner?.ownerUserId !== userId) {
        return { ok: false as const, error: "این App هنوز در Review است.", status: 403 };
      }
    }
    const bot = liveBot(data, mini.botId);
    if (!bot) return { ok: false as const, error: "توسعه‌دهنده فعال نیست.", status: 404 };
    const flood = hitRateLimit(data, `mini:open:${userId}`, 60_000, 20);
    if (!flood.allowed) return { ok: false as const, error: "باز کردن پیاپی محدود شد.", status: 429 };
    let grant = grantOf(data, userId, miniId);
    if (!grant) {
      grant = {
        id: randomId(),
        miniAppId: miniId,
        userId,
        profile: false,
        createdAt: Date.now(),
        scopes: [],
        installed: true,
        lastUsedAt: Date.now(),
      };
      data.miniGrants.push(grant);
    } else {
      grant.installed = true;
      grant.lastUsedAt = Date.now();
    }
    data.miniSessions = data.miniSessions ?? [];
    const sess: MiniSession = { id: randomId(), miniAppId: miniId, userId, createdAt: Date.now(), revokedAt: null };
    data.miniSessions.unshift(sess);
    data.miniSessions = data.miniSessions.slice(0, 400);
    logAccess(data, miniId, userId, "open");
    const user = data.users.find((u) => u.id === userId);
    const g = grant;
    const profileUser =
      hasScope(g, "profile") || hasScope(g, "basic") || hasScope(g, "username")
        ? {
            id: hasScope(g, "basic") ? userId : "session",
            username: hasScope(g, "username") || hasScope(g, "profile") ? user?.username ?? null : null,
            displayName: hasScope(g, "profile") ? user?.displayName ?? null : null,
          }
        : null;
    const payload = { auth_date: Math.floor(Date.now() / 1000), miniAppId: miniId, user: profileUser };
    const check = `auth_date=${payload.auth_date}\nminiAppId=${miniId}\nuser=${JSON.stringify(payload.user)}`;
    const minted = mintGrantToken(userId, miniId, scopesOf(g));
    g.tokenSalt = minted.salt;
    g.tokenHash = minted.hash;
    g.tokenExp = minted.exp;
    return {
      ok: true as const,
      html: wrapHtml(mini.html),
      webUrl: mini.webUrl && validMiniWebUrl(mini.webUrl) ? mini.webUrl : null,
      mini: publicMiniCard(data, mini, userId),
      grant: { scopes: scopesOf(g), profile: hasScope(g, "profile") },
      init: { ...payload, hash: hmacIdentifier(check), sessionId: sess.id },
      maintenance: mini.status === "maintenance",
      iframeAllow: [
        hasScope(g, "camera") ? "camera" : "",
        hasScope(g, "microphone") ? "microphone" : "",
        hasScope(g, "location") ? "geolocation" : "",
      ]
        .filter(Boolean)
        .join("; "),
    };
  });
}

export async function setMiniScopes(userId: string, miniId: string, next: Partial<Record<MiniScope, boolean>>) {
  return mutateStore((data) => {
    const mini = (data.miniApps ?? []).find((m) => m.id === miniId);
    if (!mini) return { ok: false as const, error: "مینی‌اپ نیست.", status: 404 };
    const allowedReq = new Set(hydrateMini(mini).requestedScopes);
    let grant = grantOf(data, userId, miniId);
    if (!grant) {
      grant = { id: randomId(), miniAppId: miniId, userId, profile: false, createdAt: Date.now(), scopes: [], installed: true };
      data.miniGrants.push(grant);
    }
    const cur = new Set(scopesOf(grant));
    for (const scope of MINI_SCOPES) {
      if (next[scope] === true) {
        if (!allowedReq.has(scope)) continue;
        cur.add(scope);
      }
      if (next[scope] === false) cur.delete(scope);
    }
    grant.scopes = [...cur];
    grant.profile = cur.has("profile");
    grant.revokedAt = null;
    const minted = mintGrantToken(userId, miniId, grant.scopes);
    grant.tokenSalt = minted.salt;
    grant.tokenHash = minted.hash;
    grant.tokenExp = minted.exp;
    logAccess(data, miniId, userId, `scopes:${grant.scopes.join(",")}`);
    if (MINI_SENSITIVE.some((s) => next[s] === true)) {
      emitNotification(data, {
        userId,
        category: "security",
        kind: "mini_grant",
        title: "مجوز Mini App",
        body: "یک Mini App به مجوز حساس دسترسی گرفت. از Connected Apps قابل لغو است.",
        sourceId: `mini:${miniId}`,
        target: { type: "mini", id: miniId, href: "/app/settings/apps" },
        allowDuringDnd: true,
      });
    }
    return { ok: true as const, scopes: grant.scopes, tokenExp: grant.tokenExp };
  });
}

export async function disconnectMini(userId: string, miniId: string, wipeLocalOnly = false) {
  return mutateStore((data) => {
    const grant = grantOf(data, userId, miniId);
    if (grant) {
      grant.revokedAt = Date.now();
      grant.scopes = [];
      grant.profile = false;
      grant.tokenHash = undefined;
      grant.installed = wipeLocalOnly ? grant.installed : false;
      grant.favorite = false;
    }
    for (const s of data.miniSessions ?? []) {
      if (s.userId === userId && s.miniAppId === miniId && !s.revokedAt) s.revokedAt = Date.now();
    }
    logAccess(data, miniId, userId, wipeLocalOnly ? "clear-local" : "disconnect");
    return { ok: true as const };
  });
}

export async function toggleMiniFlag(userId: string, miniId: string, flag: "favorite" | "installed") {
  return mutateStore((data) => {
    if (!(data.miniApps ?? []).some((m) => m.id === miniId)) return { ok: false as const, error: "مینی‌اپ نیست.", status: 404 };
    let grant = grantOf(data, userId, miniId);
    if (!grant) {
      grant = { id: randomId(), miniAppId: miniId, userId, profile: false, createdAt: Date.now(), scopes: [], installed: flag === "installed" };
      data.miniGrants.push(grant);
    }
    if (flag === "favorite") grant.favorite = !grant.favorite;
    if (flag === "installed") grant.installed = !grant.installed;
    return { ok: true as const, favorite: Boolean(grant.favorite), installed: Boolean(grant.installed) };
  });
}

export async function connectedMiniApps(userId: string) {
  const data = await readStoreSnapshot();
  const grants = (data.miniGrants ?? []).filter((g) => g.userId === userId && !g.revokedAt && (g.installed || scopesOf(g).length));
  const logs = (data.miniAccessLogs ?? []).filter((l) => l.userId === userId).slice(0, 40);
  return {
    ok: true as const,
    apps: grants.map((g) => {
      const m = (data.miniApps ?? []).find((x) => x.id === g.miniAppId);
      return {
        id: g.miniAppId,
        title: m?.title ?? "App",
        scopes: scopesOf(g),
        favorite: Boolean(g.favorite),
        lastUsedAt: g.lastUsedAt ?? 0,
        tokenExp: g.tokenExp ?? null,
      };
    }),
    logs: logs.map((l) => ({ action: l.action, at: l.at, miniAppId: l.miniAppId })),
    export: grants.map((g) => ({ miniAppId: g.miniAppId, scopes: scopesOf(g), connectedAt: g.createdAt })),
  };
}

export async function reviewMini(userId: string, miniId: string, stars: number, body: string) {
  return mutateStore((data) => {
    if (!(data.miniApps ?? []).some((m) => m.id === miniId)) return { ok: false as const, error: "مینی‌اپ نیست.", status: 404 };
    const flood = hitRateLimit(data, `mini:rev:${userId}`, 3_600_000, 8);
    if (!flood.allowed) return { ok: false as const, error: "ثبت نظر محدود شد.", status: 429 };
    const star = Math.max(1, Math.min(5, Math.floor(stars)));
    const text = body.trim().slice(0, 280);
    const spam = /(http|buy now|free crypto|otp|password)/i.test(text);
    data.miniReviews = data.miniReviews ?? [];
    data.miniReviews = data.miniReviews.filter((r) => !(r.miniAppId === miniId && r.userId === userId));
    const row: MiniReview = {
      id: randomId(),
      miniAppId: miniId,
      userId,
      stars: star,
      body: text,
      createdAt: Date.now(),
      hidden: spam,
    };
    data.miniReviews.unshift(row);
    return { ok: true as const, hidden: spam };
  });
}

export async function miniBridge(userId: string, miniId: string, op: string, extra: Record<string, unknown> = {}) {
  return mutateStore((data) => {
    const claimedUser = extra.userId;
    const claimedMini = extra.miniAppId ?? extra.appId;
    if (typeof claimedUser === "string" && claimedUser !== userId) {
      return { ok: false as const, error: "شناسهٔ کاربر از نشست می‌آید نه از درخواست.", status: 403 };
    }
    if (typeof claimedMini === "string" && claimedMini !== miniId) {
      return { ok: false as const, error: "App ID با نشست هم‌خوان نیست.", status: 403 };
    }
    const mini = (data.miniApps ?? []).find((m) => m.id === miniId);
    if (!mini) return { ok: false as const, error: "مینی‌اپ نیست.", status: 404 };
    const h = hydrateMini(mini);
    if (h.status === "removed") return { ok: false as const, error: "App حذف شده.", status: 410 };
    if (h.status === "suspended") return { ok: false as const, error: "App معلق است.", status: 403 };
    if (h.status === "pending") {
      const bot = data.bots.find((b) => b.id === mini.botId);
      if (bot?.ownerUserId !== userId) return { ok: false as const, error: "این App هنوز در Review است.", status: 403 };
    }
    const grant = grantOf(data, userId, miniId);
    if (typeof extra.token === "string" && extra.token) {
      const payload = verifyPayload<{ kind?: string; userId?: string; miniId?: string; exp?: number }>(extra.token);
      if (
        !payload ||
        payload.kind !== "mini" ||
        payload.userId !== userId ||
        payload.miniId !== miniId ||
        typeof payload.exp !== "number" ||
        payload.exp < Date.now()
      ) {
        return { ok: false as const, error: "توکن Mini App نامعتبر یا منقضی است.", status: 401 };
      }
      if (!grant?.tokenHash || !grant.tokenSalt || !otpHashesEqual(grant.tokenHash, hashOtp(extra.token.slice(-48), grant.tokenSalt))) {
        return { ok: false as const, error: "توکن لغو شده است.", status: 401 };
      }
    }
    const flood = hitRateLimit(data, `mini:api:${miniId}:${userId}`, 60_000, MINI_API_MAX);
    if (!flood.allowed) return { ok: false as const, error: "سهمیه API این App تمام شد.", status: 429 };
    const user = data.users.find((u) => u.id === userId);
    if (op === "profile") {
      if (!hasScope(grant, "profile") && !hasScope(grant, "basic")) return { ok: false as const, error: "مجوز پروفایل نیست.", status: 403 };
      return {
        ok: true as const,
        profile: {
          displayName: hasScope(grant, "profile") ? user?.displayName ?? null : null,
          username: hasScope(grant, "username") || hasScope(grant, "profile") ? user?.username ?? null : null,
          id: hasScope(grant, "basic") ? userId : "opaque",
        },
      };
    }
    if (op === "contacts") {
      if (!hasScope(grant, "contacts")) return { ok: false as const, error: "مجوز مخاطبین نیست.", status: 403 };
      const names = (data.contacts ?? [])
        .filter((c) => c.ownerUserId === userId)
        .slice(0, 20)
        .map((c) => ({ name: c.name, username: c.username || null }));
      logAccess(data, miniId, userId, "contacts");
      return { ok: true as const, contacts: names };
    }
    if (op === "location") {
      if (!hasScope(grant, "location")) return { ok: false as const, error: "مجوز موقعیت نیست.", status: 403 };
      const lat = typeof extra.lat === "number" ? extra.lat : null;
      const lng = typeof extra.lng === "number" ? extra.lng : null;
      if (lat == null || lng == null) return { ok: false as const, error: "موقعیت باید از دستگاه کاربر با اجازهٔ OS بیاید.", status: 400 };
      return { ok: true as const, location: { lat, lng, source: "user-device" } };
    }
    if (op === "notify") {
      if (!hasScope(grant, "notifications")) return { ok: false as const, error: "مجوز اعلان نیست.", status: 403 };
      const nlim = hitRateLimit(data, `mini:push:${miniId}:${userId}`, 60_000, MINI_NOTIFY_MAX);
      if (!nlim.allowed) return { ok: false as const, error: "اعلان App محدود شد.", status: 429 };
      emitNotification(data, {
        userId,
        category: "bots",
        kind: "mini_push",
        title: hydrateMini(mini).title,
        body: "اعلان Mini App (بدون دادهٔ خصوصی نیکسو).",
        sourceId: `mini:${miniId}`,
        target: { type: "mini", id: miniId, href: `/app/mini/${miniId}` },
      });
      return { ok: true as const };
    }
    if (op === "open-link") {
      const url = String(extra.url ?? "");
      const host = safeHttpsHost(url);
      if (!host) return { ok: false as const, error: "فقط لینک HTTPS مجاز است.", status: 400 };
      const registered = mini.webUrl ? safeHttpsHost(mini.webUrl) : null;
      if (!registered || host !== registered) return { ok: false as const, error: "Redirect خارج از دامنهٔ ثبت‌شده رد شد.", status: 403 };
      logAccess(data, miniId, userId, `link:${host}`);
      return { ok: true as const, url, host };
    }
    if (op === "file-meta") {
      if (!hasScope(grant, "files")) return { ok: false as const, error: "مجوز فایل نیست.", status: 403 };
      const name = String(extra.name ?? "file");
      const mime = String(extra.mime ?? "application/octet-stream");
      const size = Number(extra.size ?? 0);
      const scan = scanNamedFile(name, mime, size);
      if (!scan.ok) return { ok: false as const, error: scan.warning ?? "فایل رد شد.", status: 400 };
      return { ok: true as const, name, allowed: true };
    }
    if (op === "pay") {
      if (!hasScope(grant, "payments") && !mini.paymentHint) return { ok: false as const, error: "مجوز پرداخت نیست.", status: 403 };
      return {
        ok: false as const,
        error: "پرداخت فقط از مسیر رسمی NIXO Pay است. کارت و توکن پرداخت به Mini App داده نمی‌شود. سامانه هنوز فعال نیست.",
        status: 503,
      };
    }
    return { ok: false as const, error: "API ناشناخته.", status: 400 };
  });
}

export async function developerUpdateMini(
  ownerUserId: string,
  miniId: string,
  patch: {
    title?: string;
    description?: string;
    html?: string;
    iconDataUrl?: string;
    version?: string;
    requestedScopes?: MiniScope[];
    privacyUrl?: string;
    termsUrl?: string;
    webUrl?: string | null;
    category?: MiniCategory;
    status?: MiniAppStatus;
  },
) {
  return mutateStore((data) => {
    const mini = (data.miniApps ?? []).find((m) => m.id === miniId);
    if (!mini) return { ok: false as const, error: "مینی‌اپ نیست.", status: 404 };
    const bot = data.bots.find((b) => b.id === mini.botId);
    if (!bot || bot.ownerUserId !== ownerUserId) return { ok: false as const, error: "فقط Developer این App.", status: 403 };
    if (typeof patch.title === "string") mini.title = patch.title.trim().slice(0, 40);
    if (typeof patch.description === "string") mini.description = patch.description.trim().slice(0, 200);
    if (typeof patch.html === "string") mini.html = patch.html.slice(0, 20_000);
    if (typeof patch.iconDataUrl === "string" && patch.iconDataUrl.startsWith("data:image/")) mini.iconDataUrl = patch.iconDataUrl.slice(0, 80_000);
    if (typeof patch.version === "string") mini.version = patch.version.slice(0, 16);
    if (Array.isArray(patch.requestedScopes)) {
      mini.requestedScopes = patch.requestedScopes.filter((s) => (MINI_SCOPES as readonly string[]).includes(s));
    }
    if (typeof patch.privacyUrl === "string") mini.privacyUrl = patch.privacyUrl.slice(0, 200);
    if (typeof patch.termsUrl === "string") mini.termsUrl = patch.termsUrl.slice(0, 200);
    if (patch.webUrl === null) mini.webUrl = null;
    else if (typeof patch.webUrl === "string") {
      if (!validMiniWebUrl(patch.webUrl)) return { ok: false as const, error: "Web App فقط HTTPS معتبر.", status: 400 };
      mini.webUrl = patch.webUrl;
    }
    if (patch.category && MINI_CATEGORIES.some((c) => c.id === patch.category)) mini.category = patch.category;
    const sensitive = (mini.requestedScopes ?? []).some((s) => MINI_SENSITIVE.includes(s));
    if (sensitive && !bot.verified && patch.status === "active") {
      mini.status = "pending";
      return { ok: false as const, error: "مجوز حساس نیاز به Verification توسعه‌دهنده دارد. App در Review ماند.", status: 403 };
    }
    if (patch.status === "maintenance" || patch.status === "active") mini.status = patch.status;
    mini.updatedAt = Date.now();
    return { ok: true as const, mini: hydrateMini(mini) };
  });
}

export async function adminMiniStatus(actorId: string, miniId: string, status: MiniAppStatus) {
  return mutateStore((data) => {
    const actor = data.users.find((u) => u.id === actorId);
    const handle = actor?.username?.toLowerCase() ?? "";
    if (handle !== "nixo" && handle !== "nixo_ops") {
      return { ok: false as const, error: "فقط ایمنی نیکسو.", status: 403 };
    }
    const mini = (data.miniApps ?? []).find((m) => m.id === miniId);
    if (!mini) return { ok: false as const, error: "مینی‌اپ نیست.", status: 404 };
    mini.status = status;
    mini.updatedAt = Date.now();
    logAccess(data, miniId, actorId, `admin:${status}`);
    return { ok: true as const };
  });
}

export async function reportMiniApp(userId: string, miniId: string, category: "spam" | "abuse" | "fake" | "harassment" | "other", details = "") {
  return fileReport(userId, { targetKind: "miniapp", targetKey: miniId, category, details });
}

export async function miniAnalytics(ownerUserId: string, miniId: string) {
  const data = await readStoreSnapshot();
  const mini = (data.miniApps ?? []).find((m) => m.id === miniId);
  if (!mini) return { ok: false as const, error: "مینی‌اپ نیست.", status: 404 };
  const bot = data.bots.find((b) => b.id === mini.botId);
  if (!bot || bot.ownerUserId !== ownerUserId) return { ok: false as const, error: "فقط Developer.", status: 403 };
  const opens = (data.miniAccessLogs ?? []).filter((l) => l.miniAppId === miniId && l.action === "open").length;
  const connected = (data.miniGrants ?? []).filter((g) => g.miniAppId === miniId && !g.revokedAt && (g.scopes?.length || g.installed)).length;
  const reviews = (data.miniReviews ?? []).filter((r) => r.miniAppId === miniId && !r.hidden);
  return {
    ok: true as const,
    analytics: {
      opens,
      connected,
      rating: reviews.length ? reviews.reduce((n, r) => n + r.stars, 0) / reviews.length : 0,
      reviews: reviews.length,
    },
  };
}
