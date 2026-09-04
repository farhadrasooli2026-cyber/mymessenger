"use client";

import { useEffect, useState } from "react";
import { defaultNixoFeaturePrefs, mergeNixoPrefs, type NixoFeaturePrefs } from "@/lib/nixo-features";

export function useNixoPrefs() {
  const [prefs, setPrefs] = useState<NixoFeaturePrefs>(defaultNixoFeaturePrefs());

  useEffect(() => {
    let live = true;
    fetch("/api/account", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        if (d.account?.prefs) setPrefs(mergeNixoPrefs(d.account.prefs));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--nixo-glass-alpha", String(prefs.glassOpacity / 100));
    root.style.setProperty("--nixo-glass-blur", `${prefs.glassBlur}px`);
    root.classList.toggle("nixo-glass", prefs.glassEnabled);
    const applyPower = (batteryLow: boolean) => {
      const on = prefs.powerSaveEnabled && batteryLow;
      root.classList.toggle("nixo-power-save", on);
      root.classList.toggle("nixo-no-ui-anim", on || !prefs.powerUiAnim);
      root.classList.toggle("nixo-no-sticker-anim", on || !prefs.powerStickerAnim);
      root.classList.toggle("nixo-no-preload", on || !prefs.powerPreload);
    };
    applyPower(false);
    root.classList.toggle("nixo-allow-video-autoplay", prefs.powerAutoplayVideo);
    root.classList.toggle("nixo-allow-gif-autoplay", prefs.powerAutoplayGif);
    root.classList.toggle("nixo-no-gif-autoplay", !prefs.powerAutoplayGif);
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; addEventListener: (e: string, fn: () => void) => void; removeEventListener: (e: string, fn: () => void) => void }> };
    if (!nav.getBattery) return;
    let bat: Awaited<ReturnType<NonNullable<typeof nav.getBattery>>> | null = null;
    const onBat = () => {
      if (!bat) return;
      const low = bat.level * 100 <= prefs.powerSaveBatteryPct;
      applyPower(low);
      const allowVideo = prefs.powerAutoplayVideo && !(prefs.powerSaveEnabled && low);
      const allowGif = prefs.powerAutoplayGif && !(prefs.powerSaveEnabled && low);
      root.classList.toggle("nixo-allow-video-autoplay", allowVideo);
      root.classList.toggle("nixo-allow-gif-autoplay", allowGif);
      root.classList.toggle("nixo-no-gif-autoplay", !allowGif);
    };
    void nav.getBattery().then((b) => {
      bat = b;
      onBat();
      b.addEventListener("levelchange", onBat);
    });
    return () => {
      bat?.removeEventListener("levelchange", onBat);
    };
  }, [prefs]);

  return prefs;
}

export function NixoChrome() {
  useNixoPrefs();
  return null;
}
