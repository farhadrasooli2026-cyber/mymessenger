import { randomId } from "@/lib/crypto-utils";
import type { CatalogCategory, CatalogItem } from "@/lib/profile-types";
import { DEFAULT_AVATAR_SVG } from "@/lib/default-avatar";

export { DEFAULT_AVATAR_SVG };

export const DEFAULT_CATEGORIES: CatalogCategory[] = [
  { id: "male", en: "Male", fa: "مرد", sort: 1 },
  { id: "female", en: "Female", fa: "زن", sort: 2 },
  { id: "anime", en: "Anime", fa: "انیمه", sort: 3 },
  { id: "gaming", en: "Gaming", fa: "گیمینگ", sort: 4 },
  { id: "cars", en: "Cars", fa: "ماشین", sort: 5 },
  { id: "animals", en: "Animals", fa: "حیوانات", sort: 6 },
  { id: "nature", en: "Nature", fa: "طبیعت", sort: 7 },
  { id: "abstract", en: "Abstract", fa: "انتزاعی", sort: 8 },
  { id: "minimal", en: "Minimal", fa: "مینیمال", sort: 9 },
  { id: "other", en: "Other", fa: "سایر", sort: 10 },
];

const PALETTES: Record<string, [string, string, string][]> = {
  male: [["#1e3a5f", "#fbbf24", "#e2e8f0"], ["#123834", "#34d399", "#f8fafc"], ["#292524", "#fb923c", "#fef3c7"]],
  female: [["#4c1d95", "#f9a8d4", "#f5d0fe"], ["#9f1239", "#fda4af", "#fff1f2"], ["#164e63", "#67e8f9", "#ecfeff"]],
  anime: [["#1e1b4b", "#c084fc", "#fae8ff"], ["#831843", "#fb7185", "#ffe4e6"], ["#0f766e", "#5eead4", "#ccfbf1"]],
  gaming: [["#14532d", "#a3e635", "#052e16"], ["#1e3a8a", "#22d3ee", "#0f172a"], ["#7c2d12", "#f97316", "#1c1917"]],
  cars: [["#111827", "#ef4444", "#9ca3af"], ["#1e293b", "#38bdf8", "#e2e8f0"], ["#3f3f46", "#facc15", "#18181b"]],
  animals: [["#365314", "#fde68a", "#422006"], ["#9a3412", "#fed7aa", "#1c1917"], ["#1e40af", "#93c5fd", "#0f172a"]],
  nature: [["#14532d", "#86efac", "#052e16"], ["#1e3a8a", "#38bdf8", "#082f49"], ["#854d0e", "#facc15", "#365314"]],
  abstract: [["#4c1d95", "#fbbf24", "#22d3ee"], ["#9f1239", "#34d399", "#f97316"], ["#0e7490", "#c084fc", "#f43f5e"]],
  minimal: [["#0f172a", "#e2e8f0", "#fbbf24"], ["#14532d", "#d1fae5", "#34d399"], ["#1e1b4b", "#e9d5ff", "#c084fc"]],
  other: [["#102824", "#fbbf24", "#34d399"], ["#111827", "#f8fafc", "#38bdf8"], ["#431407", "#fed7aa", "#fb923c"]],
};

function svgFor(category: string, index: number, colors: [string, string, string]): string {
  const [a, b, c] = colors;
  const shapes =
    category === "cars"
      ? `<rect x="10" y="22" width="44" height="16" rx="4" fill="${b}"/><circle cx="18" cy="40" r="5" fill="${c}"/><circle cx="46" cy="40" r="5" fill="${c}"/>`
      : category === "animals"
        ? `<circle cx="24" cy="20" r="8" fill="${b}"/><circle cx="40" cy="20" r="8" fill="${b}"/><circle cx="32" cy="34" r="12" fill="${c}"/>`
        : category === "nature"
          ? `<circle cx="32" cy="18" r="10" fill="${b}"/><path d="M12 48 L32 22 L52 48" fill="${c}"/>`
          : category === "minimal"
            ? `<circle cx="32" cy="32" r="14" fill="none" stroke="${b}" stroke-width="4"/>`
            : `<circle cx="32" cy="24" r="10" fill="${c}"/><path d="M16 48 C16 34 48 34 48 48" fill="${b}"/>`;
  const x =
    category === "gaming" || category === "abstract"
      ? `<path d="M18 18 L46 46 M46 18 L18 46" stroke="${b}" stroke-width="5" stroke-linecap="round"/>`
      : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="20" fill="${a}"/>${shapes}${x}<text x="32" y="60" text-anchor="middle" font-size="6" fill="${c}" font-family="sans-serif">${category}${index + 1}</text></svg>`;
}

export function seedCatalogItems(): CatalogItem[] {
  const now = Date.now();
  const items: CatalogItem[] = [];
  for (const cat of DEFAULT_CATEGORIES) {
    const palettes = PALETTES[cat.id] ?? PALETTES.other;
    palettes.forEach((colors, index) => {
      items.push({
        id: randomId(),
        categoryId: cat.id,
        title: `${cat.en} ${index + 1}`,
        svg: svgFor(cat.id, index, colors),
        sort: index + 1,
        createdAt: now,
        updatedAt: now,
      });
    });
  }
  return items;
}

