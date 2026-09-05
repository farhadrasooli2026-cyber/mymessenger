export type ThemeMode = "light" | "dark" | "system";
export type TextSize = "small" | "medium" | "large" | "xl";
export type BubbleStyle = "classic" | "rounded" | "minimal" | "compact";
export type GradientDir =
  | "to bottom"
  | "to top"
  | "to left"
  | "to right"
  | "to bottom right"
  | "to bottom left";

export type BackgroundSpec =
  | { kind: "default" }
  | { kind: "catalog"; catalogId: string }
  | { kind: "public"; path: string }
  | { kind: "upload"; assetId?: string }
  | { kind: "solid"; color: string }
  | { kind: "gradient"; from: string; to: string; direction: GradientDir };

export type CustomTheme = {
  main: string;
  secondary: string;
  bubble: string;
  bubbleText: string;
  background: string;
  text: string;
  accent: string;
};

export type Appearance = {
  theme: ThemeMode;
  customTheme: CustomTheme | null;
  textSize: TextSize;
  bubbleStyle: BubbleStyle;
  appBackground: BackgroundSpec;
  chatBackground: BackgroundSpec;
  chatBgOpacity: number;
  chatBgBlur: number;
  syncAppearance: boolean;
};

export const DEFAULT_CUSTOM_THEME: CustomTheme = {
  main: "#102824",
  secondary: "#0b2421",
  bubble: "#fbbf24",
  bubbleText: "#102824",
  background: "#071614",
  text: "#ecfdf5",
  accent: "#34d399",
};

export function defaultAppearance(): Appearance {
  return {
    theme: "dark",
    customTheme: null,
    textSize: "medium",
    bubbleStyle: "rounded",
    appBackground: { kind: "default" },
    chatBackground: { kind: "default" },
    chatBgOpacity: 100,
    chatBgBlur: 0,
    syncAppearance: true,
  };
}

export const SOLID_PRESETS = [
  { id: "black", color: "#0a0a0a", fa: "سیاه" },
  { id: "white", color: "#f8fafc", fa: "سفید" },
  { id: "gray", color: "#64748b", fa: "خاکستری" },
  { id: "blue", color: "#1d4ed8", fa: "آبی" },
  { id: "purple", color: "#6d28d9", fa: "بنفش" },
  { id: "green", color: "#047857", fa: "سبز" },
] as const;

export function mergeAppearance(raw: Partial<Appearance> | undefined | null): Appearance {
  const d = defaultAppearance();
  if (!raw) return d;
  const opacity = typeof raw.chatBgOpacity === "number" && Number.isFinite(raw.chatBgOpacity) ? Math.max(20, Math.min(100, Math.round(raw.chatBgOpacity))) : d.chatBgOpacity;
  const blur = typeof raw.chatBgBlur === "number" && Number.isFinite(raw.chatBgBlur) ? Math.max(0, Math.min(32, Math.round(raw.chatBgBlur))) : d.chatBgBlur;
  return {
    ...d,
    ...raw,
    appBackground: raw.appBackground ?? d.appBackground,
    chatBackground: raw.chatBackground ?? d.chatBackground,
    chatBgOpacity: opacity,
    chatBgBlur: blur,
    customTheme: raw.customTheme === undefined ? d.customTheme : raw.customTheme,
  };
}

export const GRADIENT_DIRS: { id: GradientDir; fa: string }[] = [
  { id: "to bottom", fa: "بالا به پایین" },
  { id: "to top", fa: "پایین به بالا" },
  { id: "to left", fa: "راست به چپ" },
  { id: "to right", fa: "چپ به راست" },
  { id: "to bottom right", fa: "مورب ↘" },
  { id: "to bottom left", fa: "مورب ↙" },
];
