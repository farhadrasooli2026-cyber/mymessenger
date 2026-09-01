"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { A11Y_COOKIE, defaultA11yPrefs, hydrateA11yPrefs, type A11yPrefs } from "@/lib/a11y/types";

type Ctx = {
  prefs: A11yPrefs;
  announce: (text: string, assertive?: boolean) => void;
  polite: string;
  assertive: string;
  patch: (next: Partial<A11yPrefs>) => void;
};

const A11yContext = createContext<Ctx | null>(null);

function readCookie(): A11yPrefs | null {
  if (typeof document === "undefined") return null;
  const raw = document.cookie.split("; ").find((c) => c.startsWith(`${A11Y_COOKIE}=`));
  if (!raw) return null;
  try {
    return hydrateA11yPrefs(JSON.parse(decodeURIComponent(raw.slice(A11Y_COOKIE.length + 1))));
  } catch {
    return null;
  }
}

function writeCookie(prefs: A11yPrefs) {
  document.cookie = `${A11Y_COOKIE}=${encodeURIComponent(JSON.stringify(prefs))}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

function applyDom(prefs: A11yPrefs, systemReduce: boolean, systemContrast: boolean, systemTransparent: boolean) {
  const root = document.documentElement;
  const reduce = prefs.reducedMotion || (prefs.followSystem && systemReduce);
  const contrast = prefs.highContrast || (prefs.followSystem && systemContrast);
  const glass = prefs.reduceTransparency || (prefs.followSystem && systemTransparent);
  root.classList.toggle("a11y-reduced-motion", reduce);
  root.classList.toggle("a11y-high-contrast", contrast);
  root.classList.toggle("a11y-reduce-transparency", glass);
  root.classList.toggle("a11y-underline-links", prefs.underlineLinks);
  root.classList.toggle("a11y-large-targets", prefs.largeTargets);
  root.classList.toggle("a11y-sr-hints", prefs.screenReaderHints);
  root.classList.toggle("a11y-follow-system", prefs.followSystem);
  root.style.fontSize = `${prefs.fontScale}%`;
  root.dataset.a11yScale = String(prefs.fontScale);
}

export function A11yProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<A11yPrefs>(defaultA11yPrefs);
  const [polite, setPolite] = useState("");
  const [assertive, setAssertive] = useState("");

  useEffect(() => {
    const fromCookie = readCookie();
    const mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mqContrast = window.matchMedia("(prefers-contrast: more)");
    const mqTrans = window.matchMedia("(prefers-reduced-transparency: reduce)");
    const sync = (p: A11yPrefs) => applyDom(p, mqReduce.matches, mqContrast.matches, mqTrans.matches);
    sync(fromCookie ?? defaultA11yPrefs());
    fetch("/api/account", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!d?.account?.prefs) {
          if (fromCookie) setPrefs(fromCookie);
          return;
        }
        const merged = hydrateA11yPrefs({ ...fromCookie, ...d.account.prefs });
        setPrefs(merged);
        writeCookie(merged);
        sync(merged);
      })
      .catch(() => undefined);
    const onChange = () => sync(fromCookie ?? defaultA11yPrefs());
    mqReduce.addEventListener("change", onChange);
    mqContrast.addEventListener("change", onChange);
    mqTrans.addEventListener("change", onChange);
    return () => {
      mqReduce.removeEventListener("change", onChange);
      mqContrast.removeEventListener("change", onChange);
      mqTrans.removeEventListener("change", onChange);
    };
  }, []);

  useEffect(() => {
    const mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mqContrast = window.matchMedia("(prefers-contrast: more)");
    const mqTrans = window.matchMedia("(prefers-reduced-transparency: reduce)");
    applyDom(prefs, mqReduce.matches, mqContrast.matches, mqTrans.matches);
  }, [prefs]);

  const announce = useCallback((text: string, assertive = false) => {
    if (prefs.liveAnnounce === "off") return;
    if (prefs.liveAnnounce === "polite" && assertive) {
      setPolite(text);
      return;
    }
    if (assertive) setAssertive(text);
    else setPolite(text);
  }, [prefs.liveAnnounce]);

  const patch = useCallback((next: Partial<A11yPrefs>) => {
    setPrefs((prev) => {
      const merged = hydrateA11yPrefs({ ...prev, ...next });
      writeCookie(merged);
      return merged;
    });
  }, []);

  const value = useMemo(() => ({ prefs, announce, polite, assertive, patch }), [prefs, announce, polite, assertive, patch]);

  return (
    <A11yContext.Provider value={value}>
      <a href="#nixo-main" className="skip-link">
        پرش به محتوا
      </a>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {polite}
      </div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {assertive}
      </div>
      {children}
    </A11yContext.Provider>
  );
}

export function useA11y() {
  const ctx = useContext(A11yContext);
  if (!ctx) {
    return {
      prefs: defaultA11yPrefs(),
      announce: () => undefined,
      polite: "",
      assertive: "",
      patch: () => undefined,
    };
  }
  return ctx;
}
