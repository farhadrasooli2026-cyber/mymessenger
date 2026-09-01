import { createHash } from "node:crypto";
import { redactLogText, stripSensitive } from "@/lib/safe-web";
import type { LogLevel, MonitorService } from "@/lib/monitor-types";

const PROD = process.env.NIXO_ENV === "production" || process.env.NODE_ENV === "production";

export function fingerprintError(service: string, message: string) {
  const tmpl = message.replace(/\d+/g, "#").replace(/[a-f0-9]{8,}/gi, "*").slice(0, 160);
  return createHash("sha256").update(`${service}:${tmpl}`).digest("hex").slice(0, 16);
}

export function redactMonitorText(raw: string) {
  return redactLogText(String(raw ?? ""))
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\+?\d[\d\s-]{7,}\d/g, "[phone]")
    .replace(/nxtb_[a-z0-9]+/gi, "[token]")
    .replace(/bearer\s+[a-z0-9._-]+/gi, "bearer [redacted]")
    .replace(/api[_-]?key\s*[:=]\s*\S+/gi, "api_key=[redacted]")
    .replace(/nixo_staff=[^;\s]+/gi, "nixo_staff=[redacted]")
    .replace(/nixo_admin=[^;\s]+/gi, "nixo_admin=[redacted]")
    .slice(0, 400);
}

export function safeLogPayload(value: unknown) {
  return stripSensitive(value);
}

export function shouldEmitLevel(level: LogLevel) {
  if (PROD && level === "debug") return false;
  return true;
}

export function formatStructuredLog(input: {
  level: LogLevel;
  service: MonitorService;
  message: string;
  traceId?: string;
  at?: number;
}) {
  return {
    ts: new Date(input.at ?? Date.now()).toISOString(),
    level: input.level,
    service: input.service,
    msg: redactMonitorText(input.message),
    traceId: (input.traceId ?? "").slice(0, 40),
  };
}
