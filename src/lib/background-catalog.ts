import { randomId } from "@/lib/crypto-utils";
import type { CatalogCategory, CatalogItem } from "@/lib/profile-types";

export const BG_CATEGORIES: CatalogCategory[] = [
  { id: "dark", en: "Dark", fa: "تیره", sort: 1 },
  { id: "light", en: "Light", fa: "روشن", sort: 2 },
  { id: "nature", en: "Nature", fa: "طبیعت", sort: 3 },
  { id: "city", en: "City", fa: "شهر", sort: 4 },
  { id: "gaming", en: "Gaming", fa: "گیمینگ", sort: 5 },
  { id: "cars", en: "Cars", fa: "ماشین", sort: 6 },
  { id: "abstract", en: "Abstract", fa: "انتزاعی", sort: 7 },
  { id: "minimal", en: "Minimal", fa: "مینیمال", sort: 8 },
  { id: "space", en: "Space", fa: "فضا", sort: 9 },
  { id: "other", en: "Other", fa: "سایر", sort: 10 },
];

const SCENES: Record<string, [string, string, string][]> = {
  dark: [["#071614", "#102824", "#fbbf24"], ["#0b1020", "#1e293b", "#38bdf8"], ["#111111", "#3f3f46", "#a1a1aa"]],
  light: [["#f8fafc", "#e2e8f0", "#0f766e"], ["#fff7ed", "#fed7aa", "#9a3412"], ["#ecfeff", "#a5f3fc", "#155e75"]],
  nature: [["#14532d", "#166534", "#fde68a"], ["#0c4a6e", "#0369a1", "#86efac"], ["#365314", "#4d7c0f", "#fef3c7"]],
  city: [["#0f172a", "#334155", "#fbbf24"], ["#1e1b4b", "#312e81", "#e0e7ff"], ["#111827", "#4b5563", "#f97316"]],
  gaming: [["#052e16", "#16a34a", "#a3e635"], ["#1e1b4b", "#7c3aed", "#22d3ee"], ["#450a0a", "#dc2626", "#facc15"]],
  cars: [["#18181b", "#3f3f46", "#ef4444"], ["#0c4a6e", "#0369a1", "#e2e8f0"], ["#1c1917", "#78716c", "#f59e0b"]],
  abstract: [["#4c1d95", "#db2777", "#22d3ee"], ["#9f1239", "#f97316", "#34d399"], ["#0e7490", "#c026d3", "#fbbf24"]],
  minimal: [["#0f172a", "#1e293b", "#e2e8f0"], ["#f1f5f9", "#cbd5e1", "#0f766e"], ["#102824", "#14532d", "#fbbf24"]],
  space: [["#020617", "#312e81", "#fbbf24"], ["#0b1026", "#1d4ed8", "#e0f2fe"], ["#111827", "#581c87", "#f5d0fe"]],
  other: [["#102824", "#fbbf24", "#34d399"], ["#1e293b", "#38bdf8", "#f8fafc"], ["#431407", "#fb923c", "#fed7aa"]],
};

function sceneSvg(category: string, index: number, colors: [string, string, string]): string {
  const [a, b, c] = colors;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 64" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g${category}${index}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="96" height="64" fill="url(#g${category}${index})"/><path d="M8 8 L48 56 L88 8" fill="none" stroke="${c}" stroke-width="2" opacity="0.45"/><circle cx="78" cy="16" r="7" fill="${c}" opacity="0.5"/></svg>`;
}

export function seedBackgroundItems(): CatalogItem[] {
  const now = Date.now();
  const items: CatalogItem[] = [];
  for (const cat of BG_CATEGORIES) {
    const palettes = SCENES[cat.id] ?? SCENES.other;
    palettes.forEach((colors, index) => {
      items.push({
        id: randomId(),
        categoryId: cat.id,
        title: `${cat.en} ${index + 1}`,
        svg: sceneSvg(cat.id, index, colors),
        sort: index + 1,
        createdAt: now,
        updatedAt: now,
      });
    });
  }
  return items;
}
