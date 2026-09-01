"use client";

import { useEffect } from "react";

/** Sampled RUM: TTFB only, no URL query, tokens, or message ids. */
export function EdgeBeacon() {
  useEffect(() => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const ms = nav ? Math.round(nav.responseStart) : Math.round(performance.now());
    if (!ms || ms > 20000) return;
    if (Math.random() > 0.25) return;
    void fetch("/api/edge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "rum", kind: "static", ms }),
    }).catch(() => undefined);
  }, []);
  return null;
}
