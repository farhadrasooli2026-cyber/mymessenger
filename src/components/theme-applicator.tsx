"use client";

import { useEffect } from "react";
import type { Appearance } from "@/lib/appearance-types";
import { DEFAULT_CUSTOM_THEME } from "@/lib/appearance-types";

export function ThemeApplicator({ appearance }: { appearance: Appearance }) {
  useEffect(() => {
    const root = document.documentElement;
    const apply = (dark: boolean) => {
      root.classList.toggle("dark", dark);
      root.dataset.nixoTheme = dark ? "dark" : "light";
    };
    if (appearance.theme === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      apply(mq.matches);
      const onChange = () => apply(mq.matches);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    apply(appearance.theme !== "light");
    return undefined;
  }, [appearance.theme]);

  useEffect(() => {
    const root = document.documentElement;
    const custom = appearance.customTheme;
    const theme = custom ?? (appearance.theme === "light" ? {
      main: "#f4f7f6",
      secondary: "#e8eeec",
      bubble: "#0f766e",
      bubbleText: "#ecfdf5",
      background: "#f8fafc",
      text: "#0f172a",
      accent: "#0f766e",
    } : DEFAULT_CUSTOM_THEME);
    root.style.setProperty("--nixo-main", theme.main);
    root.style.setProperty("--nixo-secondary", theme.secondary);
    root.style.setProperty("--nixo-bubble", theme.bubble);
    root.style.setProperty("--nixo-bubble-text", theme.bubbleText);
    root.style.setProperty("--nixo-bg", theme.background);
    root.style.setProperty("--nixo-text", theme.text);
    root.style.setProperty("--nixo-accent", theme.accent);
  }, [appearance.customTheme, appearance.theme]);

  return null;
}
