import { hmacIdentifier } from "@/lib/crypto-utils";
import {
  BI_SCHEMA_VERSION,
  DAILY_CAP,
  DAILY_RETENTION_MS,
  NONCE_CAP,
  RAW_CAP,
  RAW_RETENTION_MS,
  SENSITIVE_ANALYTICS_RE,
  emptyBiPersist,
  isBiEventName,
  type BiDailyRow,
  type BiEvent,
  type BiExperiment,
  type BiPersist,
} from "@/lib/bi-types";

export { emptyBiPersist };
export type { BiPersist };

function num(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function isStoredEvent(e: unknown): e is BiEvent {
  if (!e || typeof e !== "object") return false;
  const r = e as BiEvent;
  if (r.v !== BI_SCHEMA_VERSION || !isBiEventName(r.name) || typeof r.at !== "number") return false;
  if (typeof r.subject !== "string" || r.subject.length !== 64) return false;
  if (SENSITIVE_ANALYTICS_RE.test(JSON.stringify(r.props ?? {}))) return false;
  return true;
}

function isDaily(r: unknown): r is BiDailyRow {
  return !!r && typeof r === "object" && typeof (r as BiDailyRow).day === "string" && typeof (r as BiDailyRow).counts === "object";
}

function isExperiment(r: unknown): r is BiExperiment {
  return !!r && typeof r === "object" && typeof (r as BiExperiment).key === "string" && Array.isArray((r as BiExperiment).variants);
}

export function hydrateBiPersist(raw: unknown): BiPersist {
  const base = emptyBiPersist();
  if (!raw || typeof raw !== "object") return base;
  const rec = raw as Record<string, unknown>;
  const pipeline = rec.pipeline && typeof rec.pipeline === "object" ? (rec.pipeline as BiPersist["pipeline"]) : base.pipeline;
  const now = Date.now();
  return {
    raw: Array.isArray(rec.raw)
      ? rec.raw.filter(isStoredEvent).filter((e) => now - e.at < RAW_RETENTION_MS).slice(-RAW_CAP)
      : [],
    daily: Array.isArray(rec.daily)
      ? rec.daily.filter(isDaily).filter((d) => now - Date.parse(`${d.day}T00:00:00.000Z`) < DAILY_RETENTION_MS).slice(-DAILY_CAP)
      : [],
    experiments: Array.isArray(rec.experiments) ? rec.experiments.filter(isExperiment) : [],
    pipeline: {
      flushed: num(pipeline.flushed),
      droppedInvalid: num(pipeline.droppedInvalid),
      droppedDedupe: num(pipeline.droppedDedupe),
      droppedConsent: num(pipeline.droppedConsent),
      droppedSchema: num(pipeline.droppedSchema),
      lastFlushAt: typeof pipeline.lastFlushAt === "number" ? pipeline.lastFlushAt : null,
      lastError: typeof pipeline.lastError === "string" ? pipeline.lastError.slice(0, 160) : null,
      failures: num(pipeline.failures),
    },
    audit: Array.isArray(rec.audit)
      ? rec.audit
          .filter((a): a is BiPersist["audit"][number] => !!a && typeof a === "object" && typeof (a as { action?: string }).action === "string")
          .slice(-200)
      : [],
    nonces: Array.isArray(rec.nonces)
      ? rec.nonces
          .filter((n): n is { nonce: string; at: number } => !!n && typeof n === "object" && typeof (n as { nonce?: string }).nonce === "string")
          .filter((n) => now - n.at < RAW_RETENTION_MS)
          .slice(-NONCE_CAP)
      : [],
  };
}

export function purgeBiSubjectFromPersist(persist: BiPersist, userId: string): BiPersist {
  const subject = hmacIdentifier(`bi:${userId}`);
  return { ...persist, raw: persist.raw.filter((e) => e.subject !== subject) };
}
