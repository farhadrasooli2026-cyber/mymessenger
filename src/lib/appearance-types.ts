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

export const GRADIENT_DIRS: { id: GradientDir; fa: string }[] = [
  { id: "to bottom", fa: "بالا به پایین" },
  { id: "to top", fa: "پایین به بالا" },
  { id: "to left", fa: "راست به چپ" },
  { id: "to right", fa: "چپ به راست" },
  { id: "to bottom right", fa: "مورب ↘" },
  { id: "to bottom left", fa: "مورب ↙" },
];
