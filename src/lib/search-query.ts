/** Query parsing and abuse guards. Safe on client and server. Does not log the query. */

export const SEARCH_QUERY_MAX = 200;
export const SEARCH_HIT_CAP = 400;
export const SEARCH_BUDGET_MS = 120;

const ABUSE =
  /(\.\*){2,}|(\+\+)|(\*\*)|(\{\s*\d{3,}\s*,)|(\(\?[!<=:])|(\(\?P<)|(\\\d\{)|(\[\\w-\\W\]\+)|(\([^)]*[+*]\)[+*])|((a+){2,}\+)/i;

export function validateSearchQuery(raw: string): { ok: true; q: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "جستجو نامعتبر است." };
  if (raw.length > SEARCH_QUERY_MAX) return { ok: false, error: "جستجو خیلی طولانی است." };
  if (ABUSE.test(raw) || /\/.+\/[gimsuy]*/.test(raw.trim())) {
    return { ok: false, error: "الگوی جستجو مجاز نیست." };
  }
  return { ok: true, q: raw };
}

export type ParsedSearchQuery = {
  needle: string;
  exact: string | null;
  hashtags: string[];
  mentions: string[];
  entityHint: { type: string; id: string } | null;
};

export function needleOf(q: string) {
  return q.trim().replace(/^@/, "").toLowerCase();
}

export function extractHashtags(text: string) {
  const out: string[] = [];
  const re = /#([^\s#]{1,40})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push(m[1]!.replace(/[.,!?;:]+$/, ""));
  }
  return out;
}

export function extractMentions(text: string) {
  const out: string[] = [];
  const re = /@([a-zA-Z0-9_]{2,32})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push(m[1]!.toLowerCase());
  }
  return out;
}

export function parseEntityHint(raw: string): { type: string; id: string } | null {
  const t = raw.trim();
  const deep =
    /(?:nixo:\/\/|nixo:)?(?:user|group|channel|community|chat|live)[:/]+([a-zA-Z0-9_-]{8,48})/i.exec(t) ||
    /(?:^|\/)(?:c|g|u|ch|live)\/([a-zA-Z0-9_-]{8,48})(?:\/|$)/i.exec(t);
  if (deep) {
    const id = deep[1]!;
    const lower = t.toLowerCase();
    const type = lower.includes("group") || lower.includes("/g/")
      ? "group"
      : lower.includes("channel") || lower.includes("/c/") || lower.includes("/ch/")
        ? "channel"
        : lower.includes("community")
          ? "community"
          : lower.includes("live")
            ? "live"
            : lower.includes("chat")
              ? "chat"
              : lower.includes("user") || lower.includes("/u/")
                ? "user"
                : "unknown";
    return { type, id };
  }
  if (/^[a-zA-Z0-9_-]{16,48}$/.test(t) && !t.includes(" ")) {
    return { type: "unknown", id: t };
  }
  return null;
}

export function parseSearchQuery(raw: string): ParsedSearchQuery {
  const quoted = raw.match(/"([^"]{1,120})"/);
  const exact = quoted?.[1]?.trim() || null;
  const rest = raw.replace(/"([^"]*)"/g, " ").trim();
  const needle = needleOf(exact || rest || raw);
  return {
    needle,
    exact,
    hashtags: extractHashtags(raw).map((h) => h.toLowerCase()),
    mentions: extractMentions(raw),
    entityHint: parseEntityHint(raw),
  };
}

export const SEARCH_SORTS = ["relevance", "newest", "oldest", "popular"] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

export const SEARCH_FEEDS = ["discovery", "trending"] as const;
export type SearchFeed = (typeof SEARCH_FEEDS)[number];
