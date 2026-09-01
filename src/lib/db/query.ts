import { QUERY_LIMIT_MAX } from "@/lib/db/catalog";

const IDENT = /^[a-z][a-z0-9_]{0,63}$/;

/** Identifiers must come from an allow-list — never from raw client text. */
export function quoteIdent(name: string, allowlist: readonly string[]): string | null {
  const n = name.trim().toLowerCase();
  if (!IDENT.test(n) || !allowlist.includes(n)) return null;
  return n;
}

/**
 * Parameterized query contract. Concatenating client strings into SQL is rejected.
 * This store is document-based; the helper exists so future SQL drivers cannot interpolate.
 */
export function bindSql(sql: string, params: unknown[]): { ok: true; sql: string; params: unknown[] } | { ok: false; error: string } {
  if (typeof sql !== "string" || sql.length > 8_000) return { ok: false, error: "query too large" };
  if (/\$\{|`|\bexec\b|\bdrop\s+table\b|;--/i.test(sql)) return { ok: false, error: "rejected" };
  if ((sql.match(/\?/g) ?? []).length !== params.length) return { ok: false, error: "bind mismatch" };
  return { ok: true, sql, params };
}

export function encodeCursor(createdAt: number, id: string): string {
  return Buffer.from(`${createdAt}:${id}`, "utf8").toString("base64url");
}

export function decodeCursor(raw: string | undefined | null): { createdAt: number; id: string } | null {
  if (!raw || raw.length > 200) return null;
  try {
    const [a, b] = Buffer.from(raw, "base64url").toString("utf8").split(":");
    const createdAt = Number(a);
    if (!createdAt || !b) return null;
    return { createdAt, id: b };
  } catch {
    return null;
  }
}

export function clampLimit(n: number | undefined): number {
  if (!Number.isFinite(n) || !n) return 40;
  return Math.min(QUERY_LIMIT_MAX, Math.max(1, Math.floor(n)));
}

export function assertRecordOwner(ownerId: string, sessionUserId: string): boolean {
  return Boolean(ownerId) && ownerId === sessionUserId;
}

export function scopedRows<T extends { id: string }>(
  rows: T[],
  ownerOf: (row: T) => string,
  sessionUserId: string,
  opts?: {
    sort?: string;
    allowedSorts?: readonly string[];
    filter?: Record<string, string | number | undefined>;
    allowedFilters?: readonly string[];
    getField?: (row: T, key: string) => string | number | undefined;
    cursor?: string | null;
    limit?: number;
  },
): { items: T[]; nextCursor: string | null; total: number } {
  let out = rows.filter((r) => ownerOf(r) === sessionUserId);
  const allowedFilters = opts?.allowedFilters ?? [];
  if (opts?.filter && opts.getField) {
    for (const [k, v] of Object.entries(opts.filter)) {
      if (v === undefined || v === "") continue;
      if (!allowedFilters.includes(k)) continue;
      out = out.filter((r) => opts.getField!(r, k) === v);
    }
  }
  const sort = opts?.sort && opts.allowedSorts?.includes(opts.sort) ? opts.sort : "newest";
  if (sort === "oldest") out = [...out].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  else out = [...out].sort((a, b) => String(b.id).localeCompare(String(a.id)));
  const cur = decodeCursor(opts?.cursor);
  if (cur) {
    out = out.filter((r) => {
      const created = typeof (r as T & { createdAt?: number }).createdAt === "number" ? (r as T & { createdAt: number }).createdAt : 0;
      return created < cur.createdAt || (created === cur.createdAt && r.id < cur.id);
    });
  }
  const limit = clampLimit(opts?.limit);
  const page = out.slice(0, limit);
  const last = page[page.length - 1] as (T & { createdAt?: number }) | undefined;
  const nextCursor =
    out.length > page.length && last
      ? encodeCursor(typeof last.createdAt === "number" ? last.createdAt : 0, last.id)
      : null;
  return { items: page, nextCursor, total: out.length };
}
