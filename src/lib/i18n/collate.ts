import { bcp47, DEFAULT_LOCALE } from "./languages";

export function collate(a: string, b: string, locale?: string | null) {
  return a.localeCompare(b, bcp47(locale ?? DEFAULT_LOCALE), { sensitivity: "base", numeric: true });
}

export function collateBy<T>(items: T[], pick: (row: T) => string, locale?: string | null): T[] {
  return [...items].sort((x, y) => collate(pick(x), pick(y), locale));
}
