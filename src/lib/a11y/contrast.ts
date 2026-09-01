/** WCAG contrast helpers. Hex or rgb() only; no runtime CSS parsing of secrets. */

function channel(n: number) {
  const s = n / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function parseColor(input: string): [number, number, number] | null {
  const hex = input.trim();
  const short = /^#([0-9a-f]{3})$/i.exec(hex);
  if (short?.[1]) {
    const [r, g, b] = short[1].split("");
    return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16)];
  }
  const full = /^#([0-9a-f]{6})$/i.exec(hex);
  if (full?.[1]) {
    return [parseInt(full[1].slice(0, 2), 16), parseInt(full[1].slice(2, 4), 16), parseInt(full[1].slice(4, 6), 16)];
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(hex);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

export function relativeLuminance(color: string): number {
  const rgb = parseColor(color);
  if (!rgb) return 0;
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

export function contrastRatio(fg: string, bg: string): number {
  const L1 = relativeLuminance(fg);
  const L2 = relativeLuminance(bg);
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

export function meetsWcagAa(fg: string, bg: string, large = false): boolean {
  return contrastRatio(fg, bg) >= (large ? 3 : 4.5);
}

/** Documented NIXO chrome pairs that must stay readable. */
export const NIXO_CONTRAST_PAIRS: { name: string; fg: string; bg: string; large?: boolean }[] = [
  { name: "body", fg: "#ecfdf5", bg: "#071614" },
  { name: "primary-button", fg: "#102824", bg: "#fbbf24" },
  { name: "link-amber", fg: "#fde68a", bg: "#071614" },
  { name: "error-text", fg: "#fecaca", bg: "#071614" },
  { name: "focus-ring", fg: "#fbbf24", bg: "#071614", large: true },
];
