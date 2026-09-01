"use client";

import { useEffect, useRef } from "react";

function nonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Product analytics ping. Never sends message text, tokens, or passwords. */
export function BiBeacon() {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    const t = window.setTimeout(() => {
      void fetch("/api/bi?view=consent", { cache: "no-store" })
        .then((r) => r.json())
        .then((d: { productAnalytics?: boolean }) => {
          if (!d.productAnalytics) return;
          return fetch("/api/bi", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "event", name: "ui.session_start", nonce: nonce(), props: { feature: "chat" } }),
          });
        })
        .catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(t);
  }, []);
  return null;
}
