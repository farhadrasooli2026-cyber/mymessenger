"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/components/i18n-provider";
import type { NixoLocale } from "@/lib/i18n/languages";

type Dash = {
  ok?: boolean;
  enabledLocales?: NixoLocale[];
  overlays?: Record<string, Record<string, string>>;
  missing?: { key: string; locale: string; at: number }[];
  audit?: { id: string; action: string; at: number; detail: string }[];
  provider?: string;
  languages?: { code: string; nativeName: string }[];
  error?: string;
};

export function I18nDesk() {
  const { t } = useI18n();
  const [dash, setDash] = useState<Dash | null>(null);
  const [overlayLocale, setOverlayLocale] = useState("en");
  const [overlayKey, setOverlayKey] = useState("");
  const [overlayText, setOverlayText] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/i18n?view=admin", { cache: "no-store" })
      .then((r) => r.json())
      .then((data: Dash) => setDash(data))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/i18n", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) {
        toast.error(data.error ?? t("lang.failed"));
        return;
      }
      toast.success(t("lang.saved"));
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!dash) return <p className="p-4 text-sm opacity-70">{t("lang.loading")}</p>;
  if (dash.ok === false) return <p className="p-4 text-sm">{dash.error}</p>;

  const enabled = new Set(dash.enabledLocales ?? []);

  return (
    <div className="mt-4 space-y-4 text-sm" dir="auto">
      <h2 className="text-lg font-semibold">{t("admin.i18n.title")}</h2>
      <p className="text-xs opacity-70">{t("admin.i18n.no_secrets")}</p>
      <section className="rounded-2xl bg-white/5 p-4">
        <p className="text-xs opacity-70">{t("admin.i18n.enabled")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {(dash.languages ?? []).map((l) => (
            <label key={l.code} className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={enabled.has(l.code as NixoLocale)}
                disabled={l.code === "fa" || busy}
                onChange={(e) => {
                  const next = new Set(enabled);
                  if (e.target.checked) next.add(l.code as NixoLocale);
                  else next.delete(l.code as NixoLocale);
                  void act({ action: "enable", locales: Array.from(next) });
                }}
              />
              {l.nativeName}
            </label>
          ))}
        </div>
      </section>
      <section className="rounded-2xl bg-white/5 p-4">
        <p className="text-xs opacity-70">{t("admin.i18n.provider")}</p>
        <select
          className="mt-1 h-9 rounded-lg bg-black/30 px-2"
          value={dash.provider ?? "none"}
          onChange={(e) => void act({ action: "provider", provider: e.target.value })}
        >
          <option value="none">none</option>
          <option value="mock">mock</option>
        </select>
      </section>
      <section className="rounded-2xl bg-white/5 p-4">
        <p className="text-xs opacity-70">{t("admin.i18n.overlays")}</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <Input value={overlayLocale} onChange={(e) => setOverlayLocale(e.target.value)} placeholder="locale" />
          <Input value={overlayKey} onChange={(e) => setOverlayKey(e.target.value)} placeholder="key" />
          <Input value={overlayText} onChange={(e) => setOverlayText(e.target.value)} placeholder="text" />
        </div>
        <Button className="mt-2" size="sm" disabled={busy} onClick={() => void act({ action: "overlay", locale: overlayLocale, key: overlayKey, text: overlayText })}>
          {t("lang.save")}
        </Button>
      </section>
      <section className="rounded-2xl bg-white/5 p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs opacity-70">{t("admin.i18n.missing")}</p>
          <Button size="xs" variant="outline" disabled={busy} onClick={() => void act({ action: "clear-missing" })}>
            clear
          </Button>
        </div>
        <ul className="mt-2 max-h-40 overflow-auto text-xs">
          {(dash.missing ?? []).map((m) => (
            <li key={`${m.locale}:${m.key}`}>
              {m.locale} · {m.key}
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-2xl bg-white/5 p-4">
        <p className="text-xs opacity-70">{t("admin.i18n.audit")}</p>
        <ul className="mt-2 max-h-40 overflow-auto text-xs">
          {(dash.audit ?? []).map((a) => (
            <li key={a.id}>
              {a.action} · {a.detail}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
