import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { z } from "zod";
import { hashOtp, hmacIdentifier, newSalt, otpHashesEqual, randomId } from "@/lib/crypto-utils";
import { hitRateLimit } from "@/lib/rate-limit";
import { decodeDataUrl, saveUserPhoto } from "@/lib/photo-files";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { StoreData } from "@/lib/store";
import { emitNotification } from "@/lib/notify";
import { normalizeUsername } from "@/lib/username";
import {
  BOT_API_MAX,
  BOT_API_WINDOW_MS,
  BOT_CATEGORIES,
  BOT_CREATE_MAX_DAY,
  BOT_JOB_MAX,
  BOT_KV_MAX,
  BOT_MSG_MAX,
  BOT_WEBHOOK_TIMEOUT_MS,
  DEFAULT_BOT_COMMANDS,
  DEFAULT_BOT_PERMS,
  FORBIDDEN_DEFAULTS,
  MINI_SCOPES,
  MINI_SENSITIVE,
  type BotApiPerms,
  type BotButton,
  type BotCategory,
  type BotCommand,
  type BotLog,
  type BotMessage,
  type BotRecord,
  type BotReportCategory,
  type BotStatus,
  type MiniAppStatus,
  type MiniCategory,
  type MiniScope,
} from "@/lib/bot-types";

const OFFICIAL_ID = "official-nixo-help";

export const createBotSchema = z.object({
  name: z.string().trim().min(2).max(40),
  username: z.string().min(3).max(24),
  description: z.string().trim().min(4).max(280),
  photoDataUrl: z.string().max(1_400_000).optional(),
  startMessage: z.string().trim().max(500).optional(),
  category: z.enum(["utility", "games", "education", "business", "productivity", "entertainment", "support"]).optional(),
  privacyUrl: z.string().trim().max(200).optional(),
  termsUrl: z.string().trim().max(200).optional(),
});

function emptyPerms(): BotApiPerms {
  return { ...DEFAULT_BOT_PERMS };
}

function log(data: StoreData, botId: string, kind: BotLog["kind"], summary: string) {
  const clean = summary.replace(/nxtb_[a-z0-9]+/gi, "nxtb_***").replace(/\b\d{6}\b/g, "******").slice(0, 180);
  data.botLogs = [
    { id: randomId(), botId, at: Date.now(), kind, summary: clean },
    ...(data.botLogs ?? []),
  ].slice(0, 800);
}

function accessLog(data: StoreData, botId: string, userId: string, action: string) {
  data.botAccessLogs = [
    { id: randomId(), botId, userId, action: action.slice(0, 80), at: Date.now() },
    ...(data.botAccessLogs ?? []),
  ].slice(0, 2000);
}

export function hydrateBot(b: BotRecord): BotRecord {
  const cat = BOT_CATEGORIES.some((c) => c.id === b.category) ? b.category : "utility";
  const status: BotStatus =
    b.status === "disabled" || b.status === "suspended" || b.status === "deleted" || b.status === "active" ? b.status : "active";
  return {
    ...b,
    category: cat,
    version: b.version || "1.0.0",
    versions: b.versions ?? [],
    privacyUrl: b.privacyUrl ?? "",
    termsUrl: b.termsUrl ?? "",
    webhookTimeoutMs: b.webhookTimeoutMs ?? BOT_WEBHOOK_TIMEOUT_MS,
    webhookFailCount: b.webhookFailCount ?? 0,
    health: b.health ?? "ok",
    status,
  };
}

export function ensureOfficialBot(data: StoreData) {
  data.bots ??= [];
  data.botChats ??= [];
  data.botMessages ??= [];
  data.miniApps ??= [];
  data.miniGrants ??= [];
  data.botPlacements ??= [];
  data.botLogs ??= [];
  data.botUpdates ??= [];
  data.botReviews ??= [];
  data.botAccessLogs ??= [];
  data.botKv ??= [];
  data.botJobs ??= [];
  data.botIdempotency ??= [];
  data.botWebhookJobs ??= [];
  if (data.bots.some((b) => b.id === OFFICIAL_ID)) return;
  const salt = newSalt();
  const raw = `nxtb_${randomBytes(24).toString("hex")}`;
  data.bots.push({
    id: OFFICIAL_ID,
    ownerUserId: "system",
    name: "دستیار نیکسو",
    username: "nixo_bot",
    description: "ربات رسمی راهنما. به چت خصوصی E2EE، مخاطبین، گالری یا موقعیت دسترسی ندارد.",
    photoKind: "default",
    verified: true,
    status: "active",
    perms: emptyPerms(),
    commands: DEFAULT_BOT_COMMANDS.map((c) => ({ ...c })),
    tokenSalt: salt,
    tokenHash: hashOtp(raw, salt),
    tokenHint: raw.slice(-4),
    tokenRevokedAt: Date.now(),
    webhookUrl: null,
    webhookSecret: null,
    webhookLastStatus: null,
    webhookLastAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    category: "support",
    version: "1.0.0",
    privacyUrl: "/app/settings/privacy",
    termsUrl: "/app/settings/account",
    health: "ok",
    webhookTimeoutMs: BOT_WEBHOOK_TIMEOUT_MS,
    startMessage: "سلام. من @nixo_bot هستم. /start را بزن. Mini App راهنما را از دکمه باز کن. کلید خصوصی و OTP هرگز به مینی‌اپ داده نمی‌شود.",
  });
  data.miniApps.push({
    id: "mini-nixo-guide",
    botId: OFFICIAL_ID,
    title: "راهنمای نیکسو",
    category: "education",
    description: "فرم و داشبورد کوچک داخل سندباکس نیکسو.",
    html: `<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8"><style>body{font-family:sans-serif;background:#0f2f2c;color:#ecfdf5;padding:16px}button{background:#fbbf24;border:0;padding:8px 12px;border-radius:8px}</style></head><body><h1>مینی‌اپ راهنما</h1><p id="who">در انتظار اجازهٔ پروفایل…</p><button id="ask">درخواست نام نمایشی</button><script>
window.addEventListener("message", function(e){
  if(!e.data || e.data.type!=="nixo-init") return;
  var u=e.data.user;
  document.getElementById("who").textContent = u ? ("سلام "+(u.displayName||u.username||u.id)) : "پروفایل مجاز نشده. OTP و کلید خصوصی هرگز ارسال نمی‌شود.";
});
document.getElementById("ask").onclick=function(){ parent.postMessage({type:"nixo-request-profile"}, "*"); };
</script></body></html>`,
    paymentHint: true,
    version: "1.0.0",
    status: "active",
    requestedScopes: ["profile", "username"],
    privacyUrl: "/app/settings/privacy",
    termsUrl: "/app/settings/account",
    createdAt: Date.now(),
  });
}

function usernameTaken(data: StoreData, username: string, exceptBotId?: string) {
  if (data.users.some((u) => u.username === username)) return true;
  if ((data.businesses ?? []).some((b) => b.username === username)) return true;
  return data.bots.some((b) => b.username === username && b.id !== exceptBotId && b.status !== "deleted");
}

export function mintBotToken() {
  return `nxtb_${randomBytes(24).toString("hex")}`;
}

function applyToken(bot: BotRecord, raw: string) {
  bot.tokenSalt = newSalt();
  bot.tokenHash = hashOtp(raw, bot.tokenSalt);
  bot.tokenHint = raw.slice(-4);
  bot.tokenRevokedAt = null;
}

export function publicBot(bot: BotRecord, viewerId?: string | null) {
  const b = hydrateBot(bot);
  return {
    id: b.id,
    name: b.name,
    username: b.username,
    description: b.description,
    verified: b.verified,
    status: b.status,
    category: b.category,
    version: b.version,
    developer: b.ownerUserId === "system" ? "NIXO" : "developer",
    privacyUrl: b.privacyUrl,
    termsUrl: b.termsUrl,
    health: b.health,
    photoUrl: b.photoKind === "upload" ? `/api/media/photo/${b.id}` : null,
    owner: viewerId === b.ownerUserId,
    createdAt: b.createdAt,
  };
}

function liveBot(data: StoreData, botId: string) {
  return data.bots.find((b) => b.id === botId && b.status === "active");
}

function chatOf(data: StoreData, botId: string, userId: string) {
  return data.botChats.find((c) => c.botId === botId && c.userId === userId);
}

function pushMessage(
  data: StoreData,
  chat: { id: string; botId: string; userId: string },
  from: "user" | "bot",
  text: string,
  kind: BotMessage["kind"] = "text",
  buttons: BotButton[] = [],
  replyToId?: string,
) {
  const msg: BotMessage = {
    id: randomId(),
    chatId: chat.id,
    botId: chat.botId,
    userId: chat.userId,
    from,
    kind,
    text: text.slice(0, 4000),
    buttons,
    createdAt: Date.now(),
    replyToId,
    editedAt: null,
    deletedAt: null,
  };
  data.botMessages.push(msg);
  const row = data.botChats.find((c) => c.id === chat.id);
  if (row) row.updatedAt = Date.now();
  return msg;
}

function defaultButtons(): BotButton[] {
  return [
    { id: "start", label: "Start", payload: "/start" },
    { id: "help", label: "Help", payload: "/help" },
    { id: "mini", label: "Open Mini App", payload: "open_mini" },
  ];
}

function commandReply(bot: BotRecord, cmd: string) {
  if (cmd === "start") return bot.startMessage || `سلام. من @${bot.username} هستم.`;
  if (cmd === "help") return "دستورها: /start /help /settings /search — ربات به چت خصوصی، مخاطبین، گالری، میکروفون، دوربین و موقعیت دسترسی پیش‌فرض ندارد.";
  if (cmd === "settings") return "اعلان‌ها: Enable / Disable / Mute از همین گفتگو.";
  if (cmd === "search") return "جستجوی ربات‌های تأییدشده: Settings → ربات‌ها یا تب فضاها.";
  return null;
}

export async function usernameAvailableForBot(raw: string) {
  const username = normalizeUsername(raw);
  if (!username) return { ok: false as const, available: false, username: null };
  const data = await readStoreSnapshot();
  ensureOfficialBot(data);
  return { ok: true as const, available: !usernameTaken(data, username), username };
}

export async function createBot(ownerUserId: string, input: z.infer<typeof createBotSchema>) {
  const username = normalizeUsername(input.username);
  if (!username) return { ok: false as const, status: 400, error: "نام کاربری ربات معتبر نیست." };
  let photoBuf: Buffer | null = null;
  if (input.photoDataUrl) {
    photoBuf = decodeDataUrl(input.photoDataUrl);
    if (!photoBuf) return { ok: false as const, status: 400, error: "عکس پروفایل معتبر نیست." };
  }
  const id = randomId();
  const created = await mutateStore((data) => {
    ensureOfficialBot(data);
    const owner = data.users.find((u) => u.id === ownerUserId && u.status === "active");
    if (!owner) return { ok: false as const, status: 401, error: "حساب فعال نیست." };
    const day = hitRateLimit(data, `bot:create:${ownerUserId}`, 24 * 60 * 60_000, BOT_CREATE_MAX_DAY);
    if (!day.allowed) return { ok: false as const, status: 429, error: "ساخت ربات امروز به سقف رسید.", retryAfterSec: day.retryAfterSec };
    if (usernameTaken(data, username)) return { ok: false as const, status: 409, error: "این @username قبلاً گرفته شده." };
    const token = mintBotToken();
    const bot: BotRecord = {
      id,
      ownerUserId,
      name: input.name.trim(),
      username,
      description: input.description.trim(),
      photoKind: input.photoDataUrl ? "upload" : "default",
      verified: false,
      status: "active",
      perms: emptyPerms(),
      commands: DEFAULT_BOT_COMMANDS.map((c) => ({ ...c })),
      category: input.category && BOT_CATEGORIES.some((c) => c.id === input.category) ? input.category : "utility",
      privacyUrl: input.privacyUrl ?? "",
      termsUrl: input.termsUrl ?? "",
      version: "1.0.0",
      versions: [{ version: "1.0.0", startMessage: input.startMessage?.trim() || `سلام. من @${username} هستم.`, commands: DEFAULT_BOT_COMMANDS.map((c) => ({ ...c })), at: Date.now() }],
      health: "ok" as const,
      webhookTimeoutMs: BOT_WEBHOOK_TIMEOUT_MS,
      tokenSalt: "",
      tokenHash: "",
      tokenHint: "",
      tokenRevokedAt: null,
      webhookUrl: null,
      webhookSecret: null,
      webhookLastStatus: null,
      webhookLastAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      startMessage: input.startMessage?.trim() || `سلام. من @${username} هستم. Start را بزن.`,
    };
    applyToken(bot, token);
    data.bots.push(bot);
    log(data, id, "auth", "ربات ساخته شد. توکن فقط همین‌بار نمایش داده می‌شود.");
    return {
      ok: true as const,
      bot: publicBot(bot, ownerUserId),
      token,
      warning: "توکن را در سرور خود نگه دارید. در فرانت‌اند یا مخزن عمومی نگذارید. پس از بستن این صفحه دیگر نشان داده نمی‌شود.",
    };
  });
  if (created.ok && photoBuf) await saveUserPhoto(id, photoBuf);
  return created;
}

export async function listOwnedBots(ownerUserId: string) {
  const data = await readStoreSnapshot();
  ensureOfficialBot(data);
  return data.bots.filter((b) => b.ownerUserId === ownerUserId && b.status !== "deleted").map((b) => ({
    ...publicBot(b, ownerUserId),
    tokenHint: b.tokenHint,
    webhookHost: b.webhookUrl ? safeHost(b.webhookUrl) : null,
    status: b.status,
  }));
}

export async function directoryBots(q = "", category?: string) {
  const data = await readStoreSnapshot();
  ensureOfficialBot(data);
  const n = q.replace(/^@/, "").toLowerCase().trim();
  return data.bots
    .map(hydrateBot)
    .filter((b) => b.status === "active")
    .filter((b) => !category || b.category === category)
    .filter((b) => !n || `${b.name} ${b.username} ${b.description} ${b.category}`.toLowerCase().includes(n))
    .sort((a, b) => Number(b.verified) - Number(a.verified) || b.createdAt - a.createdAt)
    .map((b) => {
      const reviews = (data.botReviews ?? []).filter((r) => r.botId === b.id && !r.hidden);
      const rating = reviews.length ? reviews.reduce((s, r) => s + r.stars, 0) / reviews.length : 0;
      return { ...publicBot(b), rating: Math.round(rating * 10) / 10, reviewCount: reviews.length };
    });
}

export async function directoryMiniApps(category?: string) {
  const data = await readStoreSnapshot();
  ensureOfficialBot(data);
  return data.miniApps
    .filter((m) => {
      const bot = liveBot(data, m.botId);
      if (!bot) return false;
      if (m.status === "removed" || m.status === "suspended" || m.status === "pending") return false;
      if (category && m.category !== category) return false;
      return true;
    })
    .map((m) => {
      const bot = liveBot(data, m.botId)!;
      return {
        id: m.id,
        title: m.title,
        category: m.category,
        description: m.description,
        paymentHint: m.paymentHint,
        bot: publicBot(bot),
      };
    });
}

function safeHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export async function developerDashboard(ownerUserId: string, botId: string) {
  const data = await readStoreSnapshot();
  ensureOfficialBot(data);
  const bot = data.bots.find((b) => b.id === botId && b.ownerUserId === ownerUserId && b.status !== "deleted");
  if (!bot) return null;
  const usage = data.botLogs.filter((l) => l.botId === botId).length;
  return {
    bot: {
      ...publicBot(bot, ownerUserId),
      description: bot.description,
      startMessage: bot.startMessage,
      commands: bot.commands,
      perms: bot.perms,
      tokenHint: `••••${bot.tokenHint}`,
      tokenRevoked: Boolean(bot.tokenRevokedAt),
      webhookUrl: bot.webhookUrl,
      webhookHost: bot.webhookUrl ? safeHost(bot.webhookUrl) : null,
      webhookLastStatus: bot.webhookLastStatus,
      webhookLastAt: bot.webhookLastAt,
      status: bot.status,
    },
    miniApps: data.miniApps.filter((m) => m.botId === botId).map((m) => ({
      id: m.id,
      title: m.title,
      category: m.category,
      description: m.description,
      paymentHint: m.paymentHint,
      status: m.status ?? "active",
      version: m.version ?? "1.0.0",
    })),
    placements: data.botPlacements.filter((p) => p.botId === botId),
    logs: data.botLogs.filter((l) => l.botId === botId).slice(0, 40),
    usage,
    chats: data.botChats.filter((c) => c.botId === botId && !c.stoppedAt).length,
    analytics: {
      chats: data.botChats.filter((c) => c.botId === botId).length,
      messages: data.botMessages.filter((m) => m.botId === botId).length,
      jobs: (data.botJobs ?? []).filter((j) => j.botId === botId).length,
      kvKeys: (data.botKv ?? []).filter((k) => k.botId === botId).length,
      rating: (() => {
        const reviews = (data.botReviews ?? []).filter((r) => r.botId === botId && !r.hidden);
        return reviews.length ? reviews.reduce((s, r) => s + r.stars, 0) / reviews.length : 0;
      })(),
    },
    health: hydrateBot(bot).health,
    version: hydrateBot(bot).version,
    versions: hydrateBot(bot).versions,
    apiVersion: "v1",
    jobs: (data.botJobs ?? []).filter((j) => j.botId === botId).slice(0, 20),
    webhookQueue: (data.botWebhookJobs ?? []).filter((j) => j.botId === botId).slice(0, 10).map((j) => ({ id: j.id, attempts: j.attempts, nextAt: j.nextAt, lastError: j.lastError })),
  };
}

export async function rotateToken(ownerUserId: string, botId: string) {
  return mutateStore((data) => {
    ensureOfficialBot(data);
    const bot = data.bots.find((b) => b.id === botId && b.ownerUserId === ownerUserId && b.status !== "deleted");
    if (!bot) return { ok: false as const, status: 404, error: "ربات یافت نشد." };
    const token = mintBotToken();
    applyToken(bot, token);
    bot.updatedAt = Date.now();
    log(data, botId, "auth", "توکن چرخانده شد. توکن قبلی نامعتبر است.");
    return { ok: true as const, token, warning: "توکن قبلی دیگر کار نمی‌کند." };
  });
}

export async function revokeToken(ownerUserId: string, botId: string) {
  return mutateStore((data) => {
    ensureOfficialBot(data);
    const bot = data.bots.find((b) => b.id === botId && b.ownerUserId === ownerUserId);
    if (!bot) return { ok: false as const, status: 404, error: "ربات یافت نشد." };
    bot.tokenRevokedAt = Date.now();
    bot.tokenHash = hashOtp(mintBotToken(), newSalt());
    bot.updatedAt = Date.now();
    log(data, botId, "auth", "توکن باطل شد. Old Token → Invalid.");
    return { ok: true as const };
  });
}

export function validHttpsWebhook(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1";
  } catch {
    return false;
  }
}

export async function setWebhook(ownerUserId: string, botId: string, url: string | null) {
  return mutateStore((data) => {
    ensureOfficialBot(data);
    const bot = data.bots.find((b) => b.id === botId && b.ownerUserId === ownerUserId && b.status === "active");
    if (!bot) return { ok: false as const, status: 404, error: "ربات یافت نشد." };
    if (url && !validHttpsWebhook(url)) {
      return { ok: false as const, status: 400, error: "Webhook باید HTTPS معتبر باشد (نه localhost)." };
    }
    bot.webhookUrl = url;
    bot.webhookSecret = url ? randomBytes(24).toString("hex") : null;
    bot.webhookLastStatus = url ? "configured" : "cleared";
    bot.webhookLastAt = Date.now();
    bot.updatedAt = Date.now();
    log(data, botId, "webhook", url ? `Webhook روی ${safeHost(url)} تنظیم شد.` : "Webhook حذف شد.");
    return { ok: true as const, secret: bot.webhookSecret, url: bot.webhookUrl };
  });
}

export function webhookSignature(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export async function setCommands(ownerUserId: string, botId: string, commands: BotCommand[]) {
  return mutateStore((data) => {
    ensureOfficialBot(data);
    const bot = data.bots.find((b) => b.id === botId && b.ownerUserId === ownerUserId);
    if (!bot) return { ok: false as const, status: 404, error: "ربات یافت نشد." };
    bot.commands = commands
      .slice(0, 20)
      .map((c) => ({
        command: c.command.replace(/^\//, "").toLowerCase().slice(0, 32),
        description: c.description.slice(0, 80),
        permission: c.permission === "public" || (c.permission && c.permission in DEFAULT_BOT_PERMS) ? c.permission : "public",
      }))
      .filter((c) => /^[a-z][a-z0-9_]{1,31}$/.test(c.command));
    bot.updatedAt = Date.now();
    return { ok: true as const, commands: bot.commands };
  });
}

export async function setBotPerms(ownerUserId: string, botId: string, patch: Partial<BotApiPerms>) {
  return mutateStore((data) => {
    ensureOfficialBot(data);
    const bot = data.bots.find((b) => b.id === botId && b.ownerUserId === ownerUserId);
    if (!bot) return { ok: false as const, status: 404, error: "ربات یافت نشد." };
    const next = { ...bot.perms, ...patch };
    for (const k of FORBIDDEN_DEFAULTS) {
      if (next[k]) {
        return { ok: false as const, status: 403, error: `دسترسی ${k} از API قابل فعال‌سازی نیست.` };
      }
    }
    bot.perms = next;
    bot.updatedAt = Date.now();
    log(data, botId, "auth", "مجوزهای API به‌روز شد (بررسی سمت سرور).");
    return { ok: true as const, perms: bot.perms };
  });
}

export async function setBotStatus(ownerUserId: string, botId: string, status: "active" | "disabled" | "deleted" | "suspended") {
  return mutateStore((data) => {
    ensureOfficialBot(data);
    const bot = data.bots.find((b) => b.id === botId && b.ownerUserId === ownerUserId);
    if (!bot) return { ok: false as const, status: 404, error: "ربات یافت نشد." };
    if (bot.id === OFFICIAL_ID) return { ok: false as const, status: 403, error: "ربات رسمی حذف نمی‌شود." };
    bot.status = status;
    bot.updatedAt = Date.now();
    if (status !== "active") {
      bot.tokenRevokedAt = Date.now();
      bot.tokenHash = hashOtp(mintBotToken(), newSalt());
    }
    log(data, botId, "auth", status === "deleted" ? "ربات حذف شد." : status === "disabled" ? "ربات غیرفعال شد." : "ربات فعال شد.");
    return { ok: true as const };
  });
}

export async function registerMiniApp(
  ownerUserId: string,
  botId: string,
  input: {
    title: string;
    category: MiniCategory;
    description: string;
    html?: string;
    paymentHint?: boolean;
    requestedScopes?: MiniScope[];
    webUrl?: string;
    privacyUrl?: string;
    termsUrl?: string;
    version?: string;
    iconDataUrl?: string;
  },
) {
  return mutateStore((data) => {
    ensureOfficialBot(data);
    const bot = data.bots.find((b) => b.id === botId && b.ownerUserId === ownerUserId && b.status === "active");
    if (!bot) return { ok: false as const, status: 404, error: "ربات یافت نشد." };
    const requested = (input.requestedScopes ?? ["profile"]).filter((s): s is MiniScope =>
      (MINI_SCOPES as readonly string[]).includes(s),
    );
    const sensitive = requested.some((s) => MINI_SENSITIVE.includes(s));
    const mini = {
      id: randomId(),
      botId,
      title: input.title.trim().slice(0, 40),
      category: input.category,
      description: input.description.trim().slice(0, 200),
      html: (input.html ?? "<p>مینی‌اپ نیکسو</p>").slice(0, 20_000),
      paymentHint: Boolean(input.paymentHint),
      createdAt: Date.now(),
      version: (input.version ?? "1.0.0").slice(0, 16),
      status: (sensitive && !bot.verified ? "pending" : "active") as MiniAppStatus,
      requestedScopes: requested,
      privacyUrl: (input.privacyUrl ?? "").slice(0, 200),
      termsUrl: (input.termsUrl ?? "").slice(0, 200),
      webUrl: input.webUrl && input.webUrl.startsWith("https://") ? input.webUrl : null,
      iconDataUrl: input.iconDataUrl?.startsWith("data:image/") ? input.iconDataUrl.slice(0, 80_000) : "",
      updatedAt: Date.now(),
    };
    data.miniApps.push(mini);
    return { ok: true as const, mini: { id: mini.id, title: mini.title, category: mini.category, status: mini.status } };
  });
}

export async function resolveBotFromToken(token: string) {
  if (!token.startsWith("nxtb_")) return null;
  const data = await readStoreSnapshot();
  ensureOfficialBot(data);
  for (const bot of data.bots) {
    if (bot.status !== "active" || bot.tokenRevokedAt) continue;
    if (otpHashesEqual(bot.tokenHash, hashOtp(token, bot.tokenSalt))) return bot;
  }
  return null;
}

function apiGate(data: StoreData, bot: BotRecord, key: string, max: number) {
  const hit = hitRateLimit(data, `bot:api:${bot.id}:${key}`, BOT_API_WINDOW_MS, max);
  if (!hit.allowed) {
    log(data, bot.id, "abuse", "Rate limit Bot API");
    return { ok: false as const, status: 429 as const, error: "Rate limit / quota ربات.", retryAfterSec: hit.retryAfterSec };
  }
  return { ok: true as const };
}

export async function botApiMe(token: string) {
  const bot = await resolveBotFromToken(token);
  if (!bot) return { ok: false as const, status: 401, error: "توکن نامعتبر یا باطل است." };
  return { ok: true as const, apiVersion: "v1", bot: { id: bot.id, username: bot.username, name: bot.name, perms: bot.perms, version: bot.version ?? "1.0.0", health: bot.health ?? "ok" } };
}

export async function botSendToUser(
  token: string,
  input: { userId: string; text?: string; kind?: BotMessage["kind"]; buttons?: BotButton[]; replyToId?: string; idempotencyKey?: string },
) {
  return mutateStore((data) => {
    ensureOfficialBot(data);
    const bot = data.bots.find((b) => b.status === "active" && !b.tokenRevokedAt && otpHashesEqual(b.tokenHash, hashOtp(token, b.tokenSalt)));
    if (!bot) return { ok: false as const, status: 401, error: "توکن نامعتبر یا باطل است. Access Denied." };
    if (input.idempotencyKey) {
      data.botIdempotency = data.botIdempotency ?? [];
      const hit = data.botIdempotency.find((i) => i.botId === bot.id && i.key === input.idempotencyKey && Date.now() - i.at < 10 * 60_000);
      if (hit) return { ok: true as const, messageId: hit.result, idempotent: true as const };
    }
    const gate = apiGate(data, bot, "send", BOT_MSG_MAX);
    if (!gate.ok) return gate;
    const kind = input.kind ?? "text";
    if (kind === "photo" && !bot.perms.sendPhoto) return { ok: false as const, status: 403, error: "مجوز sendPhoto نیست." };
    if (kind === "video" && !bot.perms.sendVideo) return { ok: false as const, status: 403, error: "مجوز sendVideo نیست." };
    if (kind === "file" && !bot.perms.sendFile) return { ok: false as const, status: 403, error: "مجوز sendFile نیست." };
    if (kind === "notification" && !bot.perms.sendNotification) {
      return { ok: false as const, status: 403, error: "مجوز اعلان نیست." };
    }
    if (kind === "text" && !bot.perms.sendMessage) return { ok: false as const, status: 403, error: "مجوز sendMessage نیست." };
    if (input.buttons?.length && !bot.perms.sendButton) return { ok: false as const, status: 403, error: "مجوز دکمه نیست." };
    if (bot.perms.readPrivateChats || bot.perms.readContacts || bot.perms.gallery) {
      return { ok: false as const, status: 403, error: "Permission bypass رد شد." };
    }
    const user = data.users.find((u) => u.id === input.userId && u.status === "active");
    if (!user) return { ok: false as const, status: 404, error: "کاربر در دسترس این ربات نیست." };
    if (user.blockedPeerKeys.includes(`bot:${bot.id}`)) {
      return { ok: false as const, status: 403, error: "کاربر ربات را مسدود کرده." };
    }
    const chat = chatOf(data, bot.id, user.id);
    if (!chat || chat.stoppedAt) {
      log(data, bot.id, "error", "ارسال بدون Start کاربر رد شد.");
      return { ok: false as const, status: 403, error: "فقط پس از Start کاربر در همین گفتگوی ربات." };
    }
    if (chat.notify === "off" && kind === "notification") {
      return { ok: false as const, status: 403, error: "اعلان ربات خاموش است." };
    }
    const msg = pushMessage(data, chat, "bot", input.text ?? "", kind, input.buttons ?? [], input.replyToId);
    if (input.idempotencyKey) {
      data.botIdempotency.unshift({ botId: bot.id, key: input.idempotencyKey.slice(0, 80), result: msg.id, at: Date.now() });
      data.botIdempotency = data.botIdempotency.slice(0, 400);
    }
    log(data, bot.id, "api", `send ${kind}`);
    queueWebhook(data, bot, { type: "sent", chatId: chat.id });
    if (chat.notify !== "off") {
      emitNotification(data, {
        userId: user.id,
        category: "bots",
        kind: kind === "notification" ? "bot_push" : "bot_message",
        title: bot.name,
        senderName: bot.name,
        body: (input.text ?? "پیام ربات").slice(0, 120),
        sourceId: `bot:${bot.id}`,
        muteType: "bot",
        muteId: bot.id,
        forceSuppress: chat.notify === "mute",
        target: { type: "bot", id: bot.id, href: `/app/bots/chat/${bot.id}` },
      });
    }
    return { ok: true as const, messageId: msg.id };
  });
}

export async function botPollUpdates(token: string) {
  return mutateStore((data) => {
    ensureOfficialBot(data);
    const bot = data.bots.find((b) => b.status === "active" && !b.tokenRevokedAt && otpHashesEqual(b.tokenHash, hashOtp(token, b.tokenSalt)));
    if (!bot) return { ok: false as const, status: 401, error: "توکن نامعتبر است." };
    if (!bot.perms.receiveMessage) return { ok: false as const, status: 403, error: "مجوز receiveMessage نیست." };
    const gate = apiGate(data, bot, "poll", BOT_API_MAX);
    if (!gate.ok) return gate;
    const pending = data.botUpdates.filter((u) => u.botId === bot.id && !u.consumedAt).slice(0, 50);
    for (const u of pending) u.consumedAt = Date.now();
    log(data, bot.id, "api", "getUpdates");
    return {
      ok: true as const,
      updates: pending.map((u) => ({
        id: u.id,
        type: u.type,
        userId: u.userId,
        text: u.text,
        payload: u.payload,
        createdAt: u.createdAt,
      })),
    };
  });
}

function queueWebhook(data: StoreData, bot: BotRecord, event: Record<string, unknown>) {
  if (!bot.webhookUrl || !bot.webhookSecret) return;
  const limit = hitRateLimit(data, `bot:hook:${bot.id}`, BOT_API_WINDOW_MS, 30);
  if (!limit.allowed) {
    bot.webhookLastStatus = "rate_limited";
    bot.webhookLastAt = Date.now();
    return;
  }
  const body = JSON.stringify({ ...event, botId: bot.id, at: Date.now() });
  const sig = webhookSignature(bot.webhookSecret, body);
  bot.webhookLastStatus = `queued https sig=${sig.slice(0, 8)}`;
  bot.webhookLastAt = Date.now();
  data.botWebhookJobs = data.botWebhookJobs ?? [];
  data.botWebhookJobs.unshift({
    id: randomId(),
    botId: bot.id,
    body,
    attempts: 0,
    nextAt: Date.now(),
    lastError: "",
  });
  data.botWebhookJobs = data.botWebhookJobs.slice(0, 200);
  log(data, bot.id, "webhook", "رویداد بدون متن خصوصی کاربر صف شد.");
}

export async function startBot(userId: string, botId: string) {
  return mutateStore((data) => {
    ensureOfficialBot(data);
    const bot = liveBot(data, botId);
    if (!bot) return { ok: false as const, status: 404, error: "ربات یافت نشد." };
    const user = data.users.find((u) => u.id === userId && u.status === "active");
    if (!user) return { ok: false as const, status: 401, error: "حساب فعال نیست." };
    if (user.blockedPeerKeys.includes(`bot:${bot.id}`)) {
      return { ok: false as const, status: 403, error: "این ربات مسدود است. ابتدا رفع مسدود." };
    }
    let chat = chatOf(data, bot.id, userId);
    if (!chat) {
      chat = {
        id: randomId(),
        botId: bot.id,
        userId,
        startedAt: Date.now(),
        stoppedAt: null,
        notify: "on",
        updatedAt: Date.now(),
      };
      data.botChats.push(chat);
    } else {
      chat.stoppedAt = null;
      chat.updatedAt = Date.now();
    }
    const msg = pushMessage(data, chat, "bot", commandReply(bot, "start") || bot.startMessage, "text", defaultButtons());
    data.botUpdates.push({
      id: randomId(),
      botId: bot.id,
      userId,
      type: "message",
      text: "/start",
      createdAt: Date.now(),
      consumedAt: null,
    });
    queueWebhook(data, bot, { type: "start", userId });
    accessLog(data, bot.id, userId, "start");
    return { ok: true as const, chatId: chat.id, message: publicMsg(msg), bot: publicBot(bot, userId) };
  });
}

function publicMsg(m: BotMessage) {
  return {
    id: m.id,
    from: m.from,
    kind: m.kind,
    text: m.deletedAt ? "" : m.text,
    buttons: m.deletedAt ? [] : m.buttons,
    createdAt: m.createdAt,
    replyToId: m.replyToId,
    editedAt: m.editedAt ?? null,
    deleted: Boolean(m.deletedAt),
  };
}

export async function userBotChat(userId: string, botId: string) {
  const data = await readStoreSnapshot();
  ensureOfficialBot(data);
  const bot = data.bots.find((b) => b.id === botId && b.status !== "deleted");
  if (!bot) return null;
  const chat = chatOf(data, botId, userId);
  const messages = chat ? data.botMessages.filter((m) => m.chatId === chat.id).slice(-80).map(publicMsg) : [];
  const mini = data.miniApps.filter((m) => m.botId === botId).map((m) => ({ id: m.id, title: m.title, category: m.category }));
  const reviews = (data.botReviews ?? []).filter((r) => r.botId === botId && !r.hidden).slice(0, 12);
  return {
    bot: publicBot(bot, userId),
    commands: bot.commands,
    chat: chat
      ? { id: chat.id, started: !chat.stoppedAt, notify: chat.notify, blocked: false }
      : { id: null, started: false, notify: "on" as const, blocked: false },
    messages,
    miniApps: mini,
    stopped: Boolean(chat?.stoppedAt),
    reviews: reviews.map((r) => ({ stars: r.stars, body: r.body, createdAt: r.createdAt })),
  };
}

export async function userSendToBot(userId: string, botId: string, text: string) {
  return mutateStore((data) => {
    ensureOfficialBot(data);
    const bot = liveBot(data, botId);
    if (!bot) return { ok: false as const, status: 404, error: "ربات یافت نشد." };
    const user = data.users.find((u) => u.id === userId);
    if (!user || user.blockedPeerKeys.includes(`bot:${botId}`)) {
      return { ok: false as const, status: 403, error: "ارسال ممکن نیست." };
    }
    const chat = chatOf(data, botId, userId);
    if (!chat || chat.stoppedAt) return { ok: false as const, status: 403, error: "ابتدا Start را بزن." };
    const body = text.trim().slice(0, 2000);
    if (!body) return { ok: false as const, status: 400, error: "پیام خالی است." };
    pushMessage(data, chat, "user", body);
    const cmd = body.startsWith("/") ? body.slice(1).split(/\s+/)[0]?.toLowerCase() : "";
    const spec = cmd ? bot.commands.find((c) => c.command === cmd) : undefined;
    if (spec?.permission && spec.permission !== "public") {
      const need = spec.permission;
      if (!bot.perms[need]) {
        const denied = pushMessage(data, chat, "bot", "این دستور روی سرور برای این ربات فعال نیست.", "system");
        return { ok: true as const, reply: publicMsg(denied) };
      }
    }
    const auto = cmd ? commandReply(bot, cmd) : null;
    let reply: BotMessage | null = null;
    if (body === "open_mini" || cmd === "app") {
      reply = pushMessage(data, chat, "bot", "Open Mini App را از نوار بالا انتخاب کن. دسترسی پروفایل جداگانه است.", "text", [
        { id: "mini", label: "Open Mini App", payload: "open_mini" },
      ]);
    } else if (auto) {
      reply = pushMessage(data, chat, "bot", auto, "text", defaultButtons());
    } else if (bot.perms.inline && body.startsWith("@")) {
      reply = pushMessage(data, chat, "bot", `نتیجه اینلاین مجاز: ${body.slice(0, 80)}`, "text", [
        { id: "pick", label: "انتخاب", payload: "inline_pick" },
      ]);
    } else {
      reply = pushMessage(data, chat, "bot", "پیام در صف به‌روزرسانی ربات است. محتوای چت خصوصی E2EE اینجا نیست.", "text", defaultButtons());
    }
    data.botUpdates.push({
      id: randomId(),
      botId,
      userId,
      type: cmd ? "message" : body.startsWith("@") ? "inline" : "message",
      text: body,
      createdAt: Date.now(),
      consumedAt: null,
    });
    queueWebhook(data, bot, { type: "message", chatId: chat.id });
    return { ok: true as const, reply: reply ? publicMsg(reply) : null };
  });
}

export async function setBotNotify(userId: string, botId: string, notify: "on" | "off" | "mute") {
  return mutateStore((data) => {
    ensureOfficialBot(data);
    const chat = chatOf(data, botId, userId);
    if (!chat) return { ok: false as const, status: 404, error: "گفتگوی ربات نیست." };
    chat.notify = notify;
    return { ok: true as const, notify };
  });
}

export async function stopBot(userId: string, botId: string) {
  return mutateStore((data) => {
    ensureOfficialBot(data);
    const chat = chatOf(data, botId, userId);
    if (!chat) return { ok: false as const, status: 404, error: "گفتگو نیست." };
    chat.stoppedAt = Date.now();
    pushMessage(data, chat, "bot", "ربات Stop شد. دیگر پیام نمی‌فرستد تا دوباره Start کنی.", "system");
    return { ok: true as const };
  });
}

export async function blockBot(userId: string, botId: string, blocked: boolean) {
  return mutateStore((data) => {
    ensureOfficialBot(data);
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, status: 401, error: "حساب فعال نیست." };
    const key = `bot:${botId}`;
    if (blocked) {
      if (!user.blockedPeerKeys.includes(key)) user.blockedPeerKeys.push(key);
      const chat = chatOf(data, botId, userId);
      if (chat) chat.stoppedAt = Date.now();
    } else {
      user.blockedPeerKeys = user.blockedPeerKeys.filter((k) => k !== key);
    }
    return { ok: true as const };
  });
}

export async function reportBot(userId: string, botId: string, category: BotReportCategory, details: string) {
  return mutateStore((data) => {
    ensureOfficialBot(data);
    const bot = data.bots.find((b) => b.id === botId);
    if (!bot) return { ok: false as const, status: 404, error: "ربات یافت نشد." };
    const limit = hitRateLimit(data, `report:${userId}`, 60 * 60_000, 8);
    if (!limit.allowed) return { ok: false as const, status: 429, error: "سقف گزارش." };
    data.reports.push({
      id: randomId(),
      reporterId: userId,
      targetKind: "bot",
      targetKey: botId,
      messageIds: [],
      category: category === "spam" || category === "harassment" || category === "other" ? category : "abuse",
      details: `${category}: ${details}`.slice(0, 500),
      createdAt: Date.now(),
    });
    log(data, botId, "abuse", "گزارش کاربر (بدون متن خصوصی).");
    return { ok: true as const };
  });
}

export async function addBotToGroup(
  adminId: string,
  groupId: string,
  botId: string,
  perms: { canSend: boolean; canModerate: boolean },
) {
  return mutateStore((data) => {
    ensureOfficialBot(data);
    const bot = liveBot(data, botId);
    if (!bot) return { ok: false as const, status: 404, error: "ربات یافت نشد." };
    const group = data.groups.find((g) => g.id === groupId && !g.deletedAt);
    if (!group) return { ok: false as const, status: 404, error: "گروه یافت نشد." };
    const me = group.members.find((m) => m.key === adminId && !m.leftAt);
    if (!me || (me.role !== "owner" && me.role !== "admin")) {
      return { ok: false as const, status: 403, error: "فقط Owner/Admin می‌تواند ربات اضافه کند." };
    }
    if (perms.canModerate && !bot.perms.moderateSpam) {
      return { ok: false as const, status: 403, error: "مجوز moderation ربات روی سرور خاموش است." };
    }
    if (perms.canSend && !bot.perms.groupMessages) {
      return { ok: false as const, status: 403, error: "ابتدا مجوز groupMessages ربات را در داشبورد روشن کنید." };
    }
    const key = `bot:${bot.id}`;
    if (!group.members.some((m) => m.key === key && !m.leftAt)) {
      group.members.push({
        id: randomId(),
        key,
        kind: "bot",
        role: perms.canModerate ? "moderator" : "member",
        customRoleId: null,
        name: bot.name,
        joinedAt: Date.now(),
        mutedUntil: null,
        restrictedUntil: null,
        notifyMutedUntil: null,
        leftAt: null,
      });
    }
    data.botPlacements = data.botPlacements.filter((p) => !(p.botId === botId && p.groupId === groupId));
    data.botPlacements.push({
      id: randomId(),
      botId,
      groupId,
      canSend: perms.canSend,
      canModerate: perms.canModerate,
      canPost: false,
      addedBy: adminId,
      addedAt: Date.now(),
    });
    log(data, botId, "auth", "ربات با مجوز مشخص به گروه اضافه شد.");
    return { ok: true as const };
  });
}

export async function addBotToChannel(
  adminId: string,
  channelId: string,
  botId: string,
  perms: { canPost: boolean; canModerate: boolean },
) {
  return mutateStore((data) => {
    ensureOfficialBot(data);
    const bot = liveBot(data, botId);
    if (!bot) return { ok: false as const, status: 404, error: "ربات یافت نشد." };
    const channel = data.pubChannels.find((c) => c.id === channelId && !c.deletedAt);
    if (!channel) return { ok: false as const, status: 404, error: "کانال یافت نشد." };
    const staff = channel.staff.find((s) => s.userId === adminId);
    if (!staff || (staff.role !== "owner" && staff.role !== "admin")) {
      return { ok: false as const, status: 403, error: "فقط Owner/Admin کانال." };
    }
    if (perms.canPost && !bot.perms.channelPost) {
      return { ok: false as const, status: 403, error: "مجوز channelPost روی سرور خاموش است." };
    }
    const sid = `bot:${bot.id}`;
    if (!channel.staff.some((s) => s.userId === sid)) {
      channel.staff.push({
        userId: sid,
        role: perms.canPost ? "admin" : "moderator",
        name: bot.name,
      });
    }
    data.botPlacements = data.botPlacements.filter((p) => !(p.botId === botId && p.channelId === channelId));
    data.botPlacements.push({
      id: randomId(),
      botId,
      channelId,
      canSend: false,
      canModerate: perms.canModerate,
      canPost: perms.canPost,
      addedBy: adminId,
      addedAt: Date.now(),
    });
    return { ok: true as const };
  });
}

export async function botPostChannel(token: string, channelId: string, body: string) {
  return mutateStore((data) => {
    ensureOfficialBot(data);
    const bot = data.bots.find((b) => b.status === "active" && !b.tokenRevokedAt && otpHashesEqual(b.tokenHash, hashOtp(token, b.tokenSalt)));
    if (!bot) return { ok: false as const, status: 401, error: "توکن نامعتبر." };
    if (!bot.perms.channelPost) return { ok: false as const, status: 403, error: "channelPost مجاز نیست." };
    const place = data.botPlacements.find((p) => p.botId === bot.id && p.channelId === channelId && p.canPost);
    if (!place) return { ok: false as const, status: 403, error: "این کانال به ربات اجازهٔ پست نداده." };
    const channel = data.pubChannels.find((c) => c.id === channelId && !c.deletedAt);
    if (!channel) return { ok: false as const, status: 404, error: "کانال نیست." };
    const flood = hitRateLimit(data, `cpost:${channelId}:bot:${bot.id}`, 20_000, 8);
    if (!flood.allowed) return { ok: false as const, status: 429, error: "سقف پست." };
    const post = {
      id: randomId(),
      channelId,
      authorKey: `bot:${bot.id}`,
      authorName: bot.name,
      kind: "text" as const,
      body: body.slice(0, 4000),
      caption: "",
      status: "published" as const,
      scheduledAt: null,
      publishedAt: Date.now(),
      editedAt: null,
      reactions: [] as { emoji: string; keys: string[] }[],
      comments: [],
      album: [] as string[],
      views: [] as string[],
      forwards: 0,
      createdAt: Date.now(),
    };
    data.channelPosts.unshift(post);
    log(data, bot.id, "api", "channel post");
    return { ok: true as const, postId: post.id };
  });
}

export async function miniSnapshot(userId: string, miniId: string) {
  const data = await readStoreSnapshot();
  ensureOfficialBot(data);
  const mini = data.miniApps.find((m) => m.id === miniId);
  if (!mini) return null;
  const bot = liveBot(data, mini.botId);
  if (!bot) return null;
  const grant = data.miniGrants.find((g) => g.miniAppId === miniId && g.userId === userId);
  const user = data.users.find((u) => u.id === userId);
  return {
    mini: { id: mini.id, title: mini.title, category: mini.category, description: mini.description, paymentHint: mini.paymentHint },
    bot: publicBot(bot, userId),
    html: mini.html,
    grant: grant ? { profile: grant.profile } : null,
    user: grant?.profile
      ? { id: userId, username: user?.username ?? null, displayName: user?.displayName ?? null }
      : null,
  };
}

export async function setMiniProfileGrant(userId: string, miniId: string, allow: boolean) {
  return mutateStore((data) => {
    ensureOfficialBot(data);
    const mini = data.miniApps.find((m) => m.id === miniId);
    if (!mini || !liveBot(data, mini.botId)) return { ok: false as const, status: 404, error: "مینی‌اپ نیست." };
    data.miniGrants = data.miniGrants.filter((g) => !(g.miniAppId === miniId && g.userId === userId));
    if (allow) {
      data.miniGrants.push({
        id: randomId(),
        miniAppId: miniId,
        userId,
        profile: true,
        createdAt: Date.now(),
        scopes: ["profile"],
        installed: true,
        lastUsedAt: Date.now(),
      });
    }
    return { ok: true as const, profile: allow };
  });
}

export async function miniInitPayload(userId: string, miniId: string) {
  const snap = await miniSnapshot(userId, miniId);
  if (!snap) return { ok: false as const, status: 404, error: "مینی‌اپ نیست." };
  const payload = {
    auth_date: Math.floor(Date.now() / 1000),
    miniAppId: miniId,
    user: snap.user,
  };
  const check = `auth_date=${payload.auth_date}\nminiAppId=${miniId}\nuser=${JSON.stringify(payload.user)}`;
  const hash = hmacIdentifier(check);
  return {
    ok: true as const,
    init: { ...payload, hash },
    html: snap.html,
    mini: snap.mini,
    bot: snap.bot,
    grant: snap.grant,
  };
}

export async function nixoPayStub() {
  return {
    ok: false as const,
    status: 503,
    error: "پرداخت فقط از مسیر رسمی NIXO Pay خواهد بود. این Mini App نمی‌تواند درگاه جدا بسازد. سامانهٔ پرداخت هنوز فعال نیست.",
  };
}

function tokenBot(data: StoreData, token: string) {
  if (!token.startsWith("nxtb_")) return null;
  return data.bots.find((b) => b.status === "active" && !b.tokenRevokedAt && otpHashesEqual(b.tokenHash, hashOtp(token, b.tokenSalt))) ?? null;
}

export async function botEditOwnMessage(token: string, messageId: string, text: string) {
  return mutateStore((data) => {
    ensureOfficialBot(data);
    const bot = tokenBot(data, token);
    if (!bot) return { ok: false as const, status: 401, error: "توکن نامعتبر." };
    const gate = apiGate(data, bot, "edit", BOT_API_MAX);
    if (!gate.ok) return gate;
    const msg = data.botMessages.find((m) => m.id === messageId);
    if (!msg || msg.botId !== bot.id || msg.from !== "bot") return { ok: false as const, status: 403, error: "فقط پیام خود همین ربات." };
    if (msg.deletedAt) return { ok: false as const, status: 410, error: "پیام حذف شده." };
    msg.text = text.slice(0, 4000);
    msg.editedAt = Date.now();
    return { ok: true as const, messageId: msg.id };
  });
}

export async function botDeleteOwnMessage(token: string, messageId: string) {
  return mutateStore((data) => {
    ensureOfficialBot(data);
    const bot = tokenBot(data, token);
    if (!bot) return { ok: false as const, status: 401, error: "توکن نامعتبر." };
    const msg = data.botMessages.find((m) => m.id === messageId);
    if (!msg || msg.botId !== bot.id || msg.from !== "bot") return { ok: false as const, status: 403, error: "حذف پیام دیگران مجاز نیست." };
    msg.deletedAt = Date.now();
    msg.text = "";
    msg.buttons = [];
    return { ok: true as const };
  });
}

export async function userCallback(userId: string, botId: string, messageId: string, buttonId: string) {
  return mutateStore((data) => {
    ensureOfficialBot(data);
    const bot = liveBot(data, botId);
    if (!bot) return { ok: false as const, status: 404, error: "ربات فعال نیست." };
    const chat = chatOf(data, botId, userId);
    if (!chat || chat.stoppedAt) return { ok: false as const, status: 403, error: "ابتدا Start." };
    const msg = data.botMessages.find((m) => m.id === messageId && m.botId === botId && m.chatId === chat.id && !m.deletedAt);
    if (!msg) return { ok: false as const, status: 403, error: "دکمه نامعتبر است." };
    const btn = msg.buttons.find((b) => b.id === buttonId);
    if (!btn) return { ok: false as const, status: 403, error: "Callback از پیام دیگری پذیرفته نمی‌شود." };
    data.botUpdates.push({
      id: randomId(),
      botId,
      userId,
      type: "callback",
      text: btn.label,
      payload: btn.payload,
      createdAt: Date.now(),
      consumedAt: null,
    });
    accessLog(data, botId, userId, `callback:${buttonId}`);
    queueWebhook(data, bot, { type: "callback", chatId: chat.id, buttonId });
    return { ok: true as const, payload: btn.payload };
  });
}

export async function botKvSet(token: string, key: string, value: string) {
  return mutateStore((data) => {
    const bot = tokenBot(data, token);
    if (!bot) return { ok: false as const, status: 401, error: "توکن نامعتبر." };
    data.botKv = data.botKv ?? [];
    const k = key.slice(0, 40);
    const v = value.slice(0, 2000);
    const mine = data.botKv.filter((x) => x.botId === bot.id);
    if (mine.length >= BOT_KV_MAX && !mine.some((x) => x.key === k)) {
      return { ok: false as const, status: 429, error: "سهمیه Storage این ربات پر است." };
    }
    data.botKv = data.botKv.filter((x) => !(x.botId === bot.id && x.key === k));
    data.botKv.push({ botId: bot.id, key: k, value: v, updatedAt: Date.now() });
    return { ok: true as const };
  });
}

export async function botKvGet(token: string, key: string) {
  const data = await readStoreSnapshot();
  const bot = tokenBot(data, token);
  if (!bot) return { ok: false as const, status: 401, error: "توکن نامعتبر." };
  const row = (data.botKv ?? []).find((x) => x.botId === bot.id && x.key === key);
  return { ok: true as const, value: row?.value ?? null };
}

export async function scheduleBotJob(token: string, input: { userId: string; text: string; runAt: number; kind?: "notify" | "send"; idempotencyKey?: string }) {
  return mutateStore((data) => {
    const bot = tokenBot(data, token);
    if (!bot) return { ok: false as const, status: 401, error: "توکن نامعتبر." };
    data.botJobs = data.botJobs ?? [];
    if (data.botJobs.filter((j) => j.botId === bot.id && j.status === "queued").length >= BOT_JOB_MAX) {
      return { ok: false as const, status: 429, error: "سقف Job همزمان." };
    }
    const chat = chatOf(data, bot.id, input.userId);
    if (!chat || chat.stoppedAt) return { ok: false as const, status: 403, error: "Job فقط برای کاربر Start‌شده." };
    const job = {
      id: randomId(),
      botId: bot.id,
      kind: input.kind === "notify" ? ("notify" as const) : ("send" as const),
      userId: input.userId,
      text: input.text.slice(0, 400),
      runAt: Math.max(Date.now(), input.runAt),
      status: "queued" as const,
      attempts: 0,
      idempotencyKey: input.idempotencyKey?.slice(0, 80),
    };
    data.botJobs.unshift(job);
    return { ok: true as const, jobId: job.id };
  });
}

export async function runDueBotJobs() {
  return mutateStore((data) => {
    ensureOfficialBot(data);
    const now = Date.now();
    let ran = 0;
    for (const job of data.botJobs ?? []) {
      if (job.status !== "queued" || job.runAt > now) continue;
      if (job.attempts >= 3) {
        job.status = "failed";
        continue;
      }
      job.attempts += 1;
      const bot = liveBot(data, job.botId);
      const chat = bot ? chatOf(data, job.botId, job.userId) : undefined;
      if (!bot || !chat || chat.stoppedAt) {
        job.status = "failed";
        continue;
      }
      if (job.kind === "notify" && !bot.perms.sendNotification) {
        job.status = "failed";
        continue;
      }
      pushMessage(data, chat, "bot", job.text, job.kind === "notify" ? "notification" : "text");
      job.status = "done";
      ran += 1;
    }
    return { ok: true as const, ran };
  });
}

export async function retryWebhooks(ownerUserId: string, botId: string) {
  return mutateStore((data) => {
    const bot = data.bots.find((b) => b.id === botId && b.ownerUserId === ownerUserId);
    if (!bot) return { ok: false as const, status: 404, error: "ربات نیست." };
    const jobs = (data.botWebhookJobs ?? []).filter((j) => j.botId === botId && j.attempts < 5);
    for (const j of jobs) {
      j.attempts += 1;
      j.nextAt = Date.now() + Math.min(60_000, 2 ** j.attempts * 1000);
      j.lastError = j.attempts >= 5 ? "max retries" : `retry scheduled (timeout ${bot.webhookTimeoutMs ?? BOT_WEBHOOK_TIMEOUT_MS}ms)`;
    }
    bot.webhookLastStatus = jobs.length ? "retrying" : "idle";
    bot.health = (bot.webhookFailCount ?? 0) > 5 ? "degraded" : "ok";
    return { ok: true as const, queued: jobs.length };
  });
}

export async function reviewBot(userId: string, botId: string, stars: number, body: string) {
  return mutateStore((data) => {
    if (!data.bots.some((b) => b.id === botId && b.status === "active")) return { ok: false as const, status: 404, error: "ربات نیست." };
    const flood = hitRateLimit(data, `bot:rev:${userId}`, 3_600_000, 8);
    if (!flood.allowed) return { ok: false as const, status: 429, error: "ثبت نظر محدود شد." };
    const text = body.trim().slice(0, 280);
    const spam = /(http|buy now|free crypto|otp|password)/i.test(text);
    data.botReviews = (data.botReviews ?? []).filter((r) => !(r.botId === botId && r.userId === userId));
    data.botReviews.unshift({
      id: randomId(),
      botId,
      userId,
      stars: Math.max(1, Math.min(5, Math.floor(stars))),
      body: text,
      createdAt: Date.now(),
      hidden: spam,
    });
    return { ok: true as const, hidden: spam };
  });
}

export async function connectedBots(userId: string) {
  const data = await readStoreSnapshot();
  const chats = (data.botChats ?? []).filter((c) => c.userId === userId && !c.stoppedAt);
  const logs = (data.botAccessLogs ?? []).filter((l) => l.userId === userId).slice(0, 40);
  return {
    ok: true as const,
    bots: chats.map((c) => {
      const b = data.bots.find((x) => x.id === c.botId);
      return {
        id: c.botId,
        name: b?.name ?? "Bot",
        username: b?.username ?? "",
        notify: c.notify,
        startedAt: c.startedAt,
        status: b?.status ?? "deleted",
      };
    }),
    logs: logs.map((l) => ({ action: l.action, at: l.at, botId: l.botId })),
    export: chats.map((c) => ({ botId: c.botId, startedAt: c.startedAt, notify: c.notify })),
  };
}

export async function adminBotStatus(actorId: string, botId: string, status: BotStatus) {
  return mutateStore((data) => {
    const actor = data.users.find((u) => u.id === actorId);
    const handle = actor?.username?.toLowerCase() ?? "";
    if (handle !== "nixo" && handle !== "nixo_ops") return { ok: false as const, status: 403, error: "فقط ایمنی نیکسو." };
    const bot = data.bots.find((b) => b.id === botId);
    if (!bot || bot.id === OFFICIAL_ID) return { ok: false as const, status: 404, error: "ربات قابل تغییر نیست." };
    bot.status = status;
    bot.updatedAt = Date.now();
    if (status !== "active") {
      bot.tokenRevokedAt = Date.now();
      bot.tokenHash = hashOtp(mintBotToken(), newSalt());
      bot.health = "down";
    }
    log(data, botId, "auth", `admin:${status}`);
    return { ok: true as const };
  });
}

export async function updateBotProfile(
  ownerUserId: string,
  botId: string,
  patch: { name?: string; description?: string; startMessage?: string; privacyUrl?: string; termsUrl?: string; category?: BotCategory },
) {
  return mutateStore((data) => {
    const bot = data.bots.find((b) => b.id === botId && b.ownerUserId === ownerUserId && b.status !== "deleted");
    if (!bot) return { ok: false as const, status: 404, error: "ربات نیست." };
    if (typeof patch.name === "string") bot.name = patch.name.trim().slice(0, 40);
    if (typeof patch.description === "string") bot.description = patch.description.trim().slice(0, 280);
    if (typeof patch.startMessage === "string") bot.startMessage = patch.startMessage.trim().slice(0, 500);
    if (typeof patch.privacyUrl === "string") bot.privacyUrl = patch.privacyUrl.slice(0, 200);
    if (typeof patch.termsUrl === "string") bot.termsUrl = patch.termsUrl.slice(0, 200);
    if (patch.category && BOT_CATEGORIES.some((c) => c.id === patch.category)) bot.category = patch.category;
    bot.updatedAt = Date.now();
    return { ok: true as const, bot: publicBot(bot, ownerUserId) };
  });
}

export async function publishBotVersion(ownerUserId: string, botId: string, version: string) {
  return mutateStore((data) => {
    const bot = data.bots.find((b) => b.id === botId && b.ownerUserId === ownerUserId);
    if (!bot) return { ok: false as const, status: 404, error: "ربات نیست." };
    const v = version.trim().slice(0, 16) || "1.0.1";
    bot.versions = bot.versions ?? [];
    bot.versions.unshift({ version: v, startMessage: bot.startMessage, commands: bot.commands.map((c) => ({ ...c })), at: Date.now() });
    bot.versions = bot.versions.slice(0, 12);
    bot.version = v;
    bot.updatedAt = Date.now();
    log(data, botId, "auth", `version ${v}`);
    return { ok: true as const, version: v };
  });
}

export async function rollbackBotVersion(ownerUserId: string, botId: string, version: string) {
  return mutateStore((data) => {
    const bot = data.bots.find((b) => b.id === botId && b.ownerUserId === ownerUserId);
    if (!bot) return { ok: false as const, status: 404, error: "ربات نیست." };
    const snap = (bot.versions ?? []).find((x) => x.version === version);
    if (!snap) return { ok: false as const, status: 404, error: "نسخه نیست." };
    bot.startMessage = snap.startMessage;
    bot.commands = snap.commands.map((c) => ({ ...c }));
    bot.version = snap.version;
    bot.updatedAt = Date.now();
    log(data, botId, "auth", `rollback ${version}`);
    return { ok: true as const, version: bot.version };
  });
}

export async function removeBotPlacement(adminId: string, botId: string, groupId?: string, channelId?: string) {
  return mutateStore((data) => {
    const place = data.botPlacements.find((p) => p.botId === botId && (groupId ? p.groupId === groupId : p.channelId === channelId));
    if (!place) return { ok: false as const, status: 404, error: "ربات در این فضا نیست." };
    if (place.addedBy !== adminId) {
      if (groupId) {
        const group = data.groups.find((g) => g.id === groupId);
        const me = group?.members.find((m) => m.key === adminId && !m.leftAt);
        if (!me || (me.role !== "owner" && me.role !== "admin")) return { ok: false as const, status: 403, error: "فقط Admin." };
      }
    }
    data.botPlacements = data.botPlacements.filter((p) => p.id !== place.id);
    if (groupId) {
      const group = data.groups.find((g) => g.id === groupId);
      if (group) {
        const mem = group.members.find((m) => m.key === `bot:${botId}` && !m.leftAt);
        if (mem) mem.leftAt = Date.now();
      }
    }
    return { ok: true as const };
  });
}

export async function tryReadPrivateChat() {
  return { ok: false as const, status: 403, error: "ربات به Private Chats دسترسی ندارد." };
}

export { OFFICIAL_ID };
