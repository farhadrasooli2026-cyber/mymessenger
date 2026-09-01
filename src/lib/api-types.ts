export const API_VERSION = "1";
export const API_COMPAT = "0";
export const JSON_BODY_MAX = 1_000_000;
export const LIST_MAX = 50;
export const JOB_MAX_ATTEMPTS = 5;
export const JOB_BACKOFF_MS = [1_000, 4_000, 16_000, 32_000, 60_000];
export const WS_TICKET_TTL_MS = 60_000;
export const CACHE_TTL_MS = 8_000;

export const API_CODES = {
  ok: "ok",
  validation_error: "validation_error",
  unauthorized: "unauthorized",
  forbidden: "forbidden",
  not_found: "not_found",
  conflict: "conflict",
  rate_limited: "rate_limited",
  payload_too_large: "payload_too_large",
  unsupported_media_type: "unsupported_media_type",
  timeout: "timeout",
  csrf: "csrf",
  idempotency_conflict: "idempotency_conflict",
  internal: "internal",
  deprecated: "deprecated",
  service_unavailable: "service_unavailable",
} as const;

export type ApiCode = (typeof API_CODES)[keyof typeof API_CODES];

export function statusToCode(status: number): string {
  if (status === 400) return API_CODES.validation_error;
  if (status === 401) return API_CODES.unauthorized;
  if (status === 403) return API_CODES.forbidden;
  if (status === 404) return API_CODES.not_found;
  if (status === 409) return API_CODES.conflict;
  if (status === 413) return API_CODES.payload_too_large;
  if (status === 415) return API_CODES.unsupported_media_type;
  if (status === 429) return API_CODES.rate_limited;
  if (status === 503) return API_CODES.service_unavailable;
  if (status >= 500) return API_CODES.internal;
  return API_CODES.validation_error;
}

export type ApiJob = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  userId: string | null;
  idempotencyKey: string;
  attempts: number;
  maxAttempts: number;
  nextAt: number;
  status: "queued" | "running" | "done" | "dead";
  lastError: string;
  result?: Record<string, unknown> | null;
  createdAt: number;
  correlationId: string;
};

export type WsTicket = {
  hash: string;
  userId: string;
  exp: number;
  createdAt: number;
};

export const NIXO_SERVICES = [
  { id: "user", title: "User Service", module: "src/lib/registration.ts" },
  { id: "auth", title: "Authentication Service", module: "src/lib/session.ts" },
  { id: "profile", title: "Profile Service", module: "src/lib/profile.ts" },
  { id: "contact", title: "Contact Service", module: "src/lib/contacts.ts" },
  { id: "messaging", title: "Messaging Service", module: "src/lib/chat.ts" },
  { id: "group", title: "Group Service", module: "src/lib/groups.ts" },
  { id: "channel", title: "Channel Service", module: "src/lib/channels.ts" },
  { id: "media", title: "Media Service", module: "src/lib/media.ts" },
  { id: "file", title: "File Service", module: "src/lib/files.ts" },
  { id: "notify", title: "Notification Service", module: "src/lib/notify.ts" },
  { id: "settings", title: "Settings Service", module: "src/lib/privacy.ts" },
  { id: "search", title: "Search Service", module: "src/lib/search.ts" },
  { id: "moderation", title: "Moderation Service", module: "src/lib/safety.ts" },
  { id: "security", title: "Security Service", module: "src/lib/security.ts" },
  { id: "audit", title: "Audit Service", module: "src/lib/security.ts" },
] as const;
