export const DEFAULT_AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="20" fill="#102824"/><path d="M18 18 L46 46 M46 18 L18 46" stroke="#34d399" stroke-width="6" stroke-linecap="round"/><path d="M18 18 L46 46 M46 18 L18 46" stroke="#fbbf24" stroke-width="2.5" stroke-linecap="round"/></svg>`;

export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
