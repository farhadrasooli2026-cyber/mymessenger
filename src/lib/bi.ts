import "server-only";
import { hmacIdentifier, randomId } from "@/lib/crypto-utils";
import { mutateStore, readStoreSnapshot, type StoreData } from "@/lib/store";
import { APP_VERSION } from "@/lib/release";
import {
  BI_CLIENT_EVENTS,
  BI_ESSENTIAL_EVENTS,
  BI_FEATURE_KEYS,
  BI_SCHEMA_VERSION,
  METRIC_DEFINITIONS,
  NONCE_CAP,
  SENSITIVE_ANALYTICS_RE,
  isBiEventName,
  rangeMs,
  type BiDesk,
  type BiEvent,
  type BiEventName,
  type BiExperiment,
  type BiPropValue,
  type BiRange,
} from "@/lib/bi-types";
import { hydrateBiPersist } from "@/lib/bi-persist";

const FEATURE_SET = new Set<string>(BI_FEATURE_KEYS);

const buffer: BiEvent[] = [];
const memNonces = new Set<string>();

function dayKey(at: number) {
  return new Date(at).toISOString().slice(0, 10);
}

export { hydrateBiPersist };

export function pruneBiPersist(data: StoreData) {
  data.bi = hydrateBiPersist(data.bi);
}

function sanitizeProps(raw: Record<string, unknown> | undefined): Record<string, BiPropValue> | null {
  if (!raw) return {};
  const out: Record<string, BiPropValue> = {};
  const keys = Object.keys(raw).slice(0, 8);
  for (const key of keys) {
    if (SENSITIVE_ANALYTICS_RE.test(key)) return null;
    const val = raw[key];
    if (typeof val === "boolean" || (typeof val === "number" && Number.isFinite(val) && Math.abs(val) < 1e12)) {
      out[key.slice(0, 40)] = val;
      continue;
    }
    if (typeof val === "string") {
      if (SENSITIVE_ANALYTICS_RE.test(val)) return null;
      if (val.length > 40) return null;
      if (/^[A-Za-z0-9+/=._-]{80,}$/.test(val)) return null;
      out[key.slice(0, 40)] = val;
      continue;
    }
    return null;
  }
  return out;
}

export type TrackBiInput = {
  name: BiEventName;
  source: string;
  userId?: string;
  consented?: boolean;
  nonce?: string;
  props?: Record<string, unknown>;
};

export function trackBi(input: TrackBiInput): void {
  try {
    const essential = BI_ESSENTIAL_EVENTS.has(input.name);
    if (!essential && !input.consented) {
      noteDrop("droppedConsent");
      return;
    }
    const props = sanitizeProps(input.props);
    if (!props) {
      noteDrop("droppedInvalid");
      return;
    }
    if (input.name === "ui.feature_open") {
      const feat = String(props.feature ?? "");
      if (!FEATURE_SET.has(feat)) {
        noteDrop("droppedInvalid");
        return;
      }
    }
    const nonce = (input.nonce || randomId()).slice(0, 64);
    if (memNonces.has(nonce)) {
      noteDrop("droppedDedupe");
      return;
    }
    memNonces.add(nonce);
    if (memNonces.size > NONCE_CAP) memNonces.clear();
    const ev: BiEvent = {
      v: BI_SCHEMA_VERSION,
      name: input.name,
      at: Date.now(),
      source: String(input.source || "nixo").slice(0, 64),
      subject: hmacIdentifier(input.userId ? `bi:${input.userId}` : "bi:anon"),
      essential,
      nonce,
      props,
    };
    buffer.push(ev);
    scheduleFlush();
  } catch {
    /* analytics must never throw into product paths */
  }
}

type DropField = "droppedInvalid" | "droppedDedupe" | "droppedConsent" | "droppedSchema";
const pendingDrops: Record<DropField, number> = {
  droppedInvalid: 0,
  droppedDedupe: 0,
  droppedConsent: 0,
  droppedSchema: 0,
};

function noteDrop(field: DropField) {
  pendingDrops[field] += 1;
  scheduleFlush();
}

let flushing = false;
function scheduleFlush() {
  if (process.env.VITEST) return;
  if (flushing) return;
  flushing = true;
  setImmediate(() => {
    void flushBiBuffer()
      .catch(() => undefined)
      .finally(() => {
        flushing = false;
        if (buffer.length || Object.values(pendingDrops).some((n) => n > 0)) scheduleFlush();
      });
  });
}

export async function flushBiBuffer() {
  const batch = buffer.splice(0, buffer.length);
  const drops = { ...pendingDrops };
  pendingDrops.droppedInvalid = 0;
  pendingDrops.droppedDedupe = 0;
  pendingDrops.droppedConsent = 0;
  pendingDrops.droppedSchema = 0;
  try {
    await mutateStore((data) => {
      pruneBiPersist(data);
      const seen = new Set(data.bi.nonces.map((n) => n.nonce));
      const kept: BiEvent[] = [];
      for (const ev of batch) {
        if (seen.has(ev.nonce)) {
          data.bi.pipeline.droppedDedupe += 1;
          continue;
        }
        seen.add(ev.nonce);
        data.bi.nonces.push({ nonce: ev.nonce, at: ev.at });
        kept.push(ev);
      }
      data.bi.raw.push(...kept);
      for (const ev of kept) {
        const day = dayKey(ev.at);
        let row = data.bi.daily.find((d) => d.day === day);
        if (!row) {
          row = { day, counts: {}, essential: 0, product: 0 };
          data.bi.daily.push(row);
        }
        row.counts[ev.name] = (row.counts[ev.name] ?? 0) + 1;
        if (ev.essential) row.essential += 1;
        else row.product += 1;
      }
      data.bi.pipeline.flushed += kept.length;
      data.bi.pipeline.droppedInvalid += drops.droppedInvalid;
      data.bi.pipeline.droppedDedupe += drops.droppedDedupe;
      data.bi.pipeline.droppedConsent += drops.droppedConsent;
      data.bi.pipeline.droppedSchema += drops.droppedSchema;
      data.bi.pipeline.lastFlushAt = Date.now();
      data.bi.pipeline.lastError = null;
      pruneBiPersist(data);
    });
  } catch (err) {
    buffer.unshift(...batch);
    try {
      await mutateStore((data) => {
        pruneBiPersist(data);
        data.bi.pipeline.failures += 1;
        data.bi.pipeline.lastError = err instanceof Error ? err.message.slice(0, 160) : "flush_failed";
      });
    } catch {
      /* swallow */
    }
  }
}

export async function flushBiForTests() {
  await flushBiBuffer();
}

export function resetBiMemoryForTests() {
  buffer.length = 0;
  memNonces.clear();
  pendingDrops.droppedInvalid = 0;
  pendingDrops.droppedDedupe = 0;
  pendingDrops.droppedConsent = 0;
  pendingDrops.droppedSchema = 0;
}

export function experimentVariant(experiments: BiExperiment[] | undefined, userId: string, key: string): "control" | "treatment" | null {
  const exp = (experiments ?? []).find((e) => e.key === key);
  if (!exp || exp.status !== "running") return null;
  const digest = hmacIdentifier(`exp:${key}:${userId}`);
  const bucket = parseInt(digest.slice(0, 8), 16) % 100;
  if (bucket >= exp.percent) return "control";
  return "treatment";
}

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx] ?? null;
}

function inRange(ts: number, from: number, to: number) {
  return ts >= from && ts <= to;
}

function countEvents(raw: BiEvent[], name: BiEventName, from: number, to: number) {
  return raw.filter((e) => e.name === name && inRange(e.at, from, to)).length;
}

export async function biConsentState(userId: string) {
  const data = await readStoreSnapshot();
  const user = data.users.find((u) => u.id === userId);
  return {
    ok: true as const,
    productAnalytics: Boolean(user?.prefs?.consents?.analytics),
    essentialAlways: true,
    note: "تحلیل ضروری امنیت و پایداری جدا از رضایت محصول است. متن پیام ذخیره نمی‌شود.",
  };
}

export async function ingestClientBi(input: {
  userId: string;
  consented: boolean;
  name: string;
  nonce: string;
  props?: Record<string, unknown>;
  source?: string;
}) {
  if (!isBiEventName(input.name) || !BI_CLIENT_EVENTS.has(input.name)) {
    return { ok: true as const, stored: false as const, reason: "name" };
  }
  trackBi({
    name: input.name,
    source: (input.source || "client").slice(0, 40),
    userId: input.userId,
    consented: input.consented,
    nonce: input.nonce,
    props: input.props,
  });
  return { ok: true as const, stored: true as const };
}

export async function biDashboard(opts: {
  range: BiRange;
  compare: boolean;
  desk?: BiDesk | "all";
  locale?: string;
  country?: string;
  device?: string;
  os?: string;
}) {
  const { requireStaff } = await import("@/lib/admin-moderation");
  const staff = await requireStaff("analytics.view");
  if (!staff.ok) return staff;
  const data = await readStoreSnapshot();
  pruneBiPersist(data);
  const now = Date.now();
  const span = rangeMs(opts.range);
  const from = now - span;
  const prevFrom = from - span;
  const canMonitor = staff.perms.includes("monitor");
  const canManage = staff.perms.includes("analytics.manage");
  const users = data.users.filter((u) => {
    if (opts.locale && u.prefs?.locale !== opts.locale) return false;
    if (opts.country && (u.prefs?.country ?? "").toUpperCase() !== opts.country.toUpperCase()) return false;
    return true;
  });
  const devices = (data.devices ?? []).filter((d) => {
    if (opts.device && d.deviceType !== opts.device) return false;
    if (opts.os && d.os !== opts.os) return false;
    return true;
  });
  const deviceUserIds = new Set(devices.map((d) => d.userId));
  const scopedUsers = opts.device || opts.os ? users.filter((u) => deviceUserIds.has(u.id)) : users;

  const growth = (start: number, end: number) => {
    const dau = scopedUsers.filter((u) => inRange(u.lastSeenAt || 0, end - 24 * 60 * 60_000, end)).length;
    const wau = scopedUsers.filter((u) => inRange(u.lastSeenAt || 0, end - 7 * 24 * 60 * 60_000, end)).length;
    const mau = scopedUsers.filter((u) => inRange(u.lastSeenAt || 0, end - 30 * 24 * 60 * 60_000, end)).length;
    const neu = scopedUsers.filter((u) => inRange(u.createdAt || 0, start, end)).length;
    const cohort = scopedUsers.filter((u) => end - (u.createdAt || 0) > 7 * 24 * 60 * 60_000);
    const retained = cohort.filter((u) => inRange(u.lastSeenAt || 0, end - 7 * 24 * 60 * 60_000, end)).length;
    const churned = scopedUsers.filter((u) => (u.lastSeenAt || 0) < end - 30 * 24 * 60 * 60_000).length;
    const returning = scopedUsers.filter(
      (u) => inRange(u.lastSeenAt || 0, start, end) && (u.createdAt || 0) < start - 14 * 24 * 60 * 60_000,
    ).length;
    return {
      dau,
      wau,
      mau,
      newUsers: neu,
      retention7d: cohort.length ? Math.round((retained / cohort.length) * 1000) / 10 : null,
      churnRate: scopedUsers.length ? Math.round((churned / scopedUsers.length) * 1000) / 10 : null,
      returning,
      sessions: devices.filter((d) => !d.revokedAt && inRange(d.lastSeenAt, start, end)).length,
      sessionFreq:
        scopedUsers.length === 0
          ? 0
          : Math.round((devices.filter((d) => !d.revokedAt).length / Math.max(1, scopedUsers.length)) * 10) / 10,
    };
  };

  const current = growth(from, now);
  const previous = opts.compare ? growth(prevFrom, from) : null;

  const msgs = data.messages ?? [];
  const delivered = msgs.filter((m) => m.deliveredAt).length;
  const read = msgs.filter((m) => m.readAt).length;
  const latencies = msgs
    .filter((m) => m.deliveredAt && m.createdAt)
    .map((m) => Math.max(0, (m.deliveredAt as number) - m.createdAt))
    .filter((n) => n < 60_000);

  const quality = data.callQuality ?? [];
  const rtts = quality.map((q) => q.rttMs ?? 0).filter((n) => n > 0);
  const calls = data.calls ?? [];
  const videoCalls = calls.filter((c) => c.kind === "video");

  const payments = data.payments ?? [];
  const refunds = data.refunds ?? [];
  const paid = payments.filter((p) => p.status === "confirmed");
  const payFail = payments.filter((p) => p.status === "failed");
  const refunded = refunds.filter((r) => r.status === "completed");
  const revenue = paid.reduce((s, p) => s + (p.amount || 0), 0);
  const refundSum = refunded.reduce((s, r) => s + (r.amount || 0), 0);

  const vault = data.vaultObjects ?? [];
  const liveBytes = vault.reduce((s, v) => s + (v.deletedAt ? 0 : v.size || 0), 0);
  const api = data.monitor?.api;
  const bw = (api?.bytesIn ?? 0) + (api?.bytesOut ?? 0);

  const countryMap: Record<string, number> = {};
  const langMap: Record<string, number> = {};
  for (const u of scopedUsers) {
    const c = (u.prefs?.country || "??").toUpperCase();
    countryMap[c] = (countryMap[c] ?? 0) + 1;
    const l = u.prefs?.locale || "fa";
    langMap[l] = (langMap[l] ?? 0) + 1;
  }
  const deviceMap: Record<string, number> = {};
  const osMap: Record<string, number> = {};
  const browserMap: Record<string, number> = {};
  const versionMap: Record<string, number> = {};
  for (const d of devices) {
    deviceMap[d.deviceType] = (deviceMap[d.deviceType] ?? 0) + 1;
    osMap[d.os || "unknown"] = (osMap[d.os || "unknown"] ?? 0) + 1;
    const ua = d.userAgent || "";
    const browser = /Edg\//.test(ua) ? "edge" : /Chrome\//.test(ua) ? "chrome" : /Firefox\//.test(ua) ? "firefox" : /Safari\//.test(ua) ? "safari" : "other";
    browserMap[browser] = (browserMap[browser] ?? 0) + 1;
    versionMap[d.appVersion || APP_VERSION] = (versionMap[d.appVersion || APP_VERSION] ?? 0) + 1;
  }

  const samples = data.monitor?.samples ?? [];
  const up = samples.filter((s) => s.services?.api === "up").length;
  const req = api?.requests ?? 0;
  const errors = api?.errors ?? 0;
  const avgLatency = req ? Math.round((api?.latencySum ?? 0) / req) : 0;

  const searchQ = data.searchMetrics?.queries ?? 0;
  const searchEmpty = data.searchMetrics?.emptyResults ?? 0;

  const push = data.pushJobs ?? [];
  const pushFail = push.filter((j) => j.status === "failed" || j.status === "dead").length;

  const groups = (data.groups ?? []).filter((g) => !g.deletedAt);
  const channels = (data.pubChannels ?? []).filter((c) => !c.deletedAt);
  const stories = data.userStories ?? [];
  const watches = data.storyWatches ?? [];

  const flags = data.deploy?.flags ?? [];
  const featureUsage = {
    stories: stories.length,
    groups: groups.length,
    channels: channels.length,
    calls: calls.length,
    search: searchQ,
    live: (data.lives ?? []).length,
    bots: (data.bots ?? []).length,
  };

  const raw = data.bi.raw;
  const funnel = {
    registerStart: countEvents(raw, "funnel.register_start", from, now),
    registerVerify: countEvents(raw, "funnel.register_verify", from, now),
    onboarding: countEvents(raw, "funnel.onboarding_complete", from, now),
    loginOk: countEvents(raw, "auth.login_success", from, now),
    loginFail: countEvents(raw, "auth.login_fail", from, now),
    sessions: countEvents(raw, "ui.session_start", from, now),
  };
  const loginTotal = funnel.loginOk + funnel.loginFail;

  const featureEvents: Record<string, number> = {};
  for (const e of raw) {
    if (e.name === "ui.feature_open" && inRange(e.at, from, now)) {
      const f = String(e.props.feature ?? "other");
      featureEvents[f] = (featureEvents[f] ?? 0) + 1;
    }
  }

  const cohorts: { week: string; size: number; retained: number }[] = [];
  for (let i = 0; i < 8; i += 1) {
    const end = now - i * 7 * 24 * 60 * 60_000;
    const start = end - 7 * 24 * 60 * 60_000;
    const size = scopedUsers.filter((u) => inRange(u.createdAt || 0, start, end)).length;
    const retained = scopedUsers.filter((u) => inRange(u.createdAt || 0, start, end) && (u.lastSeenAt || 0) > now - 7 * 24 * 60 * 60_000).length;
    cohorts.push({ week: dayKey(start), size, retained });
  }

  const acquisition = {
    phone: scopedUsers.filter((u) => u.channel === "phone").length,
    email: scopedUsers.filter((u) => u.channel === "email").length,
    referrals: (data.contactInvites ?? []).length,
  };

  const slaTarget = 99.9;
  const availability = samples.length ? Math.round((up / samples.length) * 10000) / 100 : null;

  const payload = {
    ok: true as const,
    privacy: {
      storesPlaintextMessages: false,
      storesPasswords: false,
      storesTokens: false,
      storesSecrets: false,
      subjectIsPseudonymous: true,
      productAnalyticsDefaultOff: true,
      note: "داشبورد متن پیام، فایل، تماس یا شناسهٔ کاربر را نشان نمی‌دهد.",
    },
    access: {
      desk: opts.desk ?? "all",
      canManage,
      canReliability: canMonitor,
      canSecurity: canMonitor,
      businessSeparated: true,
    },
    range: opts.range,
    compare: Boolean(opts.compare),
    definitions: METRIC_DEFINITIONS,
    growth: { current, previous, cohorts, acquisition },
    engagement: {
      ...current,
      featureOpens: featureEvents,
      productSessions: funnel.sessions,
    },
    product: {
      messaging: {
        envelopes: msgs.length,
        delivered,
        deliveryRate: msgs.length ? Math.round((delivered / msgs.length) * 1000) / 10 : 0,
        read,
        readRate: delivered ? Math.round((read / delivered) * 1000) / 10 : 0,
        p50DeliveryMs: percentile(latencies, 50),
        p95DeliveryMs: percentile(latencies, 95),
        note: "envelope counts only",
      },
      groups: {
        total: groups.length,
        createdInRange: groups.filter((g) => inRange(g.createdAt || 0, from, now)).length,
        messages: (data.groupMessages ?? []).length,
      },
      channels: {
        total: channels.length,
        posts: (data.channelPosts ?? []).length,
        subscribers: channels.reduce((s, c) => s + subscriberCount(c), 0),
      },
      stories: { total: stories.length, views: watches.length },
      featureUsage,
      featureAdoption: flags.map((f) => ({ key: f.key, enabled: f.enabled && !f.kill, percent: f.percent })),
      funnel,
      onboardingDropOff: {
        startToVerify: funnel.registerStart ? Math.round((1 - funnel.registerVerify / funnel.registerStart) * 1000) / 10 : null,
        verifyToProfile: funnel.registerVerify ? Math.round((1 - funnel.onboarding / funnel.registerVerify) * 1000) / 10 : null,
      },
    },
    reliability: canMonitor
      ? {
          requests: req,
          errorRate: req ? Math.round((errors / req) * 1000) / 10 : 0,
          avgLatencyMs: avgLatency,
          p99LatencyMs: api?.latencyMax ?? null,
          timeouts: api?.timeouts ?? 0,
          slow: api?.slow ?? 0,
          availability,
          slaTarget,
          slaMet: availability == null ? null : availability >= slaTarget,
          crashes: data.monitor?.clientErrors ?? 0,
          incidents: (data.monitor?.incidents ?? []).length,
          alerts: (data.monitor?.alerts ?? []).length,
          rateLimitHits: api?.status?.["429"] ?? 0,
          note: "لاگ خام و PII در این نما نیست. جزئیات حادثه در زبانهٔ پایش است.",
        }
      : { withheld: true, reason: "نیاز به مجوز monitor" },
    security: canMonitor
      ? {
          loginFails: data.securityMetrics?.loginFails ?? 0,
          loginFailRate: loginTotal ? Math.round((funnel.loginFail / loginTotal) * 1000) / 10 : null,
          permissionDenies: data.securityMetrics?.permissionDenies ?? 0,
          incidents: data.securityMetrics?.incidents ?? 0,
          note: "رویداد امنیتی تجمیعی است؛ محتوای خصوصی نیست.",
        }
      : { withheld: true, reason: "نیاز به مجوز monitor" },
    storage: {
      objects: vault.filter((v) => !v.deletedAt).length,
      bytes: liveBytes,
      uploads: data.storageMetrics?.uploads ?? 0,
      uploadFail: data.storageMetrics?.uploadFail ?? 0,
      downloads: data.storageMetrics?.downloads ?? 0,
      downloadFail: data.storageMetrics?.downloadFail ?? 0,
    },
    calls: {
      total: calls.length,
      video: videoCalls.length,
      failed: calls.filter((c) => c.status === "missed" || c.status === "declined").length,
      dropRate: calls.length ? Math.round((calls.filter((c) => c.status === "missed").length / calls.length) * 1000) / 10 : 0,
      p95RttMs: percentile(rtts, 95),
      p99RttMs: percentile(rtts, 99),
      frozen: quality.filter((q) => q.frozen).length,
    },
    search: {
      queries: searchQ,
      errors: data.searchMetrics?.errors ?? 0,
      empty: searchEmpty,
      successRate: searchQ ? Math.round((1 - searchEmpty / searchQ) * 1000) / 10 : null,
      latencyMs: data.searchMetrics?.lastLatencyMs ?? 0,
      cacheHits: data.searchMetrics?.cacheHits ?? 0,
    },
    notifications: {
      records: (data.notifications ?? []).length,
      push: push.length,
      pushFail,
      pushFailRate: push.length ? Math.round((pushFail / push.length) * 1000) / 10 : 0,
      deadLetters: (data.notifyDeadLetters ?? []).length,
    },
    segments: {
      country: countryMap,
      language: langMap,
      device: deviceMap,
      os: osMap,
      browser: browserMap,
      clientVersion: versionMap,
    },
    release: {
      app: APP_VERSION,
      note: "اثر انتشار را با Error Rate و Engagement همین بازه با بازهٔ قبل مقایسه کن.",
    },
    experiments: data.bi.experiments.map((e) => ({
      key: e.key,
      status: e.status,
      percent: e.percent,
      metric: e.metric,
      startedAt: e.startedAt,
      stoppedAt: e.stoppedAt,
    })),
    business: {
      payments: payments.length,
      paymentOk: paid.length,
      paymentFail: payFail.length,
      paymentSuccessRate: payments.length ? Math.round((paid.length / payments.length) * 1000) / 10 : null,
      revenueAggregate: Math.round(revenue * 100) / 100,
      refunds: refunded.length,
      refundRate: paid.length ? Math.round((refunded.length / paid.length) * 1000) / 10 : null,
      refundAmount: Math.round(refundSum * 100) / 100,
      arpu: scopedUsers.length ? Math.round((revenue / scopedUsers.length) * 100) / 100 : 0,
      subscriptions: {
        note: "اشتراک جدا هنوز فعال نیست؛ سفارش فروشگاه سندباکس است.",
        activeShops: (data.shops ?? []).length,
      },
      conversionCheckout: payments.length && (data.bizCarts ?? []).length ? Math.round((paid.length / Math.max(1, data.bizCarts.length)) * 1000) / 10 : null,
    },
    cost: {
      note: "برآورد داخلی است نه فاکتور.",
      storageUsdMonth: Math.round((liveBytes / (1024 * 1024 * 1024)) * 0.023 * 10000) / 10000,
      bandwidthUsd: Math.round((bw / (1024 * 1024 * 1024)) * 0.09 * 10000) / 10000,
      computeHintMb: Math.round((samples[0]?.memMb ?? 0) * 100) / 100,
      thirdParty: { stunTurn: "از env؛ کلید در داشبورد نیست", apiCalls: 0 },
    },
    quality: {
      rawEvents: data.bi.raw.length,
      dailyRows: data.bi.daily.length,
      completeness: data.bi.pipeline.flushed
        ? Math.round((1 - data.bi.pipeline.droppedInvalid / Math.max(1, data.bi.pipeline.flushed + data.bi.pipeline.droppedInvalid)) * 1000) / 10
        : 100,
      consentOptInUsers: data.users.filter((u) => u.prefs?.consents?.analytics).length,
      consentEvents: (data.consentEvents ?? []).filter((e) => e.key === "analytics").length,
    },
    pipeline: {
      ...data.bi.pipeline,
      buffer: buffer.length,
      healthy: !data.bi.pipeline.lastError,
    },
    realtime: {
      heartbeatAt: data.monitor?.heartbeatAt ?? null,
      note: "نزدیک به لحظه از پایش + صف BI.",
    },
    role: staff.staff.role,
  };

  const blob = JSON.stringify(payload);
  if (/\b(refreshToken|BEGIN RSA|nixoadminpass)\b/i.test(blob)) {
    return { ok: false as const, error: "خروجی تحلیل آلوده تشخیص داده شد.", status: 500 as const };
  }
  return payload;
}

function subscriberCount(c: { members?: unknown[]; subscriberCount?: number; subscribers?: unknown[] }) {
  if (typeof c.subscriberCount === "number") return c.subscriberCount;
  if (Array.isArray(c.members)) return c.members.length;
  if (Array.isArray(c.subscribers)) return c.subscribers.length;
  return 0;
}

export async function biMutate(input: {
  action: "purge" | "experiment.upsert" | "experiment.rollback";
  key?: string;
  percent?: number;
  metric?: string;
}) {
  const { requireStaff } = await import("@/lib/admin-moderation");
  const staff = await requireStaff("analytics.manage");
  if (!staff.ok) return staff;
  return mutateStore((data) => {
    pruneBiPersist(data);
    const actorHint = hmacIdentifier(`staff:${staff.user.id}`).slice(0, 12);
    if (input.action === "purge") {
      data.bi.raw = [];
      data.bi.daily = [];
      data.bi.nonces = [];
      data.bi.audit.unshift({ id: randomId(), at: Date.now(), actorHint, action: "purge", detail: "حذف raw و aggregate طبق سیاست" });
      data.bi.audit = data.bi.audit.slice(0, 200);
      return { ok: true as const };
    }
    if (input.action === "experiment.upsert") {
      const key = (input.key || "").trim().slice(0, 40);
      if (!/^[a-z][a-z0-9_.-]{1,39}$/.test(key)) return { ok: false as const, error: "کلید آزمایش نامعتبر است.", status: 400 as const };
      const percent = Math.min(100, Math.max(0, Math.floor(input.percent ?? 50)));
      const metric = (input.metric || "engagement.dau").slice(0, 80);
      const existing = data.bi.experiments.find((e) => e.key === key);
      if (existing) {
        existing.percent = percent;
        existing.metric = metric;
        existing.status = "running";
        existing.stoppedAt = null;
      } else {
        data.bi.experiments.push({
          id: randomId(),
          key,
          variants: ["control", "treatment"],
          percent,
          metric,
          status: "running",
          startedAt: Date.now(),
          stoppedAt: null,
        });
      }
      data.bi.audit.unshift({ id: randomId(), at: Date.now(), actorHint, action: "experiment.upsert", detail: key });
      return { ok: true as const, experiments: data.bi.experiments };
    }
    if (input.action === "experiment.rollback") {
      const key = (input.key || "").trim();
      const existing = data.bi.experiments.find((e) => e.key === key);
      if (!existing) return { ok: false as const, error: "آزمایش یافت نشد.", status: 404 as const };
      existing.status = "rolled_back";
      existing.stoppedAt = Date.now();
      data.bi.audit.unshift({ id: randomId(), at: Date.now(), actorHint, action: "experiment.rollback", detail: key });
      return { ok: true as const, experiments: data.bi.experiments };
    }
    return { ok: false as const, error: "عملیات نامعتبر است.", status: 400 as const };
  });
}
