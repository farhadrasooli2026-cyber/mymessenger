"use client";

import { useEffect } from "react";

function redact(text: string) {
  return text
    .replace(/(password|token|secret|authorization|cookie)\s*[:=]\s*["']?[^"'&\s]+/gi, "$1=[redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .slice(0, 200);
}

/** Sends only a redacted error message. Never includes message bodies or file bytes. */
export function MonitorBeacon() {
  useEffect(() => {
    function send(message: string) {
      const body = redact(message);
      if (body.length < 3) return;
      void fetch("/api/monitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "client-error", message: body }),
      }).catch(() => undefined);
    }
    function onError(event: ErrorEvent) {
      send(event.message || "client error");
    }
    function onReject(event: PromiseRejectionEvent) {
      const reason = event.reason instanceof Error ? event.reason.message : String(event.reason ?? "rejection");
      send(reason);
    }
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onReject);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onReject);
    };
  }, []);
  return null;
}
