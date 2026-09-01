/** Query parsing and abuse guards. Safe on client and server. Does not log the query. */

export const SEARCH_QUERY_MIN = 2;
export const SEARCH_QUERY_MAX = 200;
export const SEARCH_HIT_CAP = 400;
export const SEARCH_BUDGET_MS = 120;
export const SEARCH_OP_MAX = 8;

const ABUSE =
  /(\.\*){2,}|(\+\+)|(\*\*)|(\{\s*\d{3,}\s*,)|(\(\?[!<=:])|(\(\?P<)|(\\\d\{)|(\[\\w-\\W\]\+)|(\([^)]*[+*]\)[+*])|((a+){2,}\+)/i;

const INJECTION =
  /(\$where)|(\$gt\b)|(\$ne\b)|(\bunion\s+select\b)|(\bdrop\s+table\b)|(\binsert\s+into\b)|(;--)|(\/\*|\*\/)/i;

export const STOP_WORDS = new Set(
  [
    "the",
    "and",
    "for",
    "with",
    "from",
    "this",
    "that",
    "a",
    "an",
    "in",
    "of",
    "to",
    "و",
    "در",
    "از",
    "به",
    "با",
    "که",
    "این",
    "آن",
    "را",
    "یک",
    "ve",
    "ile",
    "bir",
    "bu",
    "da",
    "de",
  ].map((w) => w.toLocaleLowerCase("en")),
);

export function normalizeSearchQuery(raw: string) {
  return raw.replace(/\s+/g, " ").trim();
}

export function tokenizeSearch(text: string) {
  return text
    .split(/[\s,;|/\\]+/)
    .map((t) => t.replace(/^[#@]+/, "").replace(/[.,!?;:]+$/g, ""))
    .filter((t) => t.length >= 1);
}

export function withoutStopWords(tokens: string[]) {
  const kept = tokens.filter((t) => t.length >= 2 && !STOP_WORDS.has(t.toLocaleLowerCase("en")));
  return kept.length ? kept : tokens.filter((t) => t.length >= 1);
}

export function validateSearchQuery(raw: string): { ok: true; q: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "جستجو نامعتبر است." };
  if (raw.length > SEARCH_QUERY_MAX) return { ok: false, error: "جستجو خیلی طولانی است." };
  const ops = raw.match(/\b(?:from|in|after|before|has|minsize|maxsize|type):/gi) ?? [];
  if (ops.length > SEARCH_OP_MAX) return { ok: false, error: "جستجو خیلی پیچیده است." };
  if (ABUSE.test(raw) || INJECTION.test(raw) || /\/.+\/[gimsuy]*/.test(raw.trim())) {
    return { ok: false, error: "الگوی جستجو مجاز نیست." };
  }
  return { ok: true, q: normalizeSearchQuery(raw) };
}

export type SearchHasFilter = "link" | "file" | "media" | "image" | "video" | "audio";

export type ParsedSearchQuery = {
  needle: string;
  exact: string | null;
  hashtags: string[];
  mentions: string[];
  entityHint: { type: string; id: string } | null;
  from?: string;
  inId?: string;
  after?: number;
  before?: number;
  has?: SearchHasFilter;
  minSize?: number;
  maxSize?: number;
  typeHint?: string;
  tokens: string[];
};

export function needleOf(q: string) {
  return q.trim().replace(/^@/, "").toLowerCase();
}

export function extractHashtags(text: string) {
  const out: string[] = [];
  const re = /#([^\s#]{1,40})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push(normalizeHashtag(m[1]!));
  }
  return out.filter(Boolean);
}

export function normalizeHashtag(tag: string) {
  return tag
    .replace(/^#+/, "")
    .normalize("NFKC")
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .toLocaleLowerCase("en")
    .replace(/[.,!?;:]+$/g, "")
    .slice(0, 40);
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
    /(?:nixo:\/\/|nixo:)?(?:user|group|channel|community|chat|live|story)[:/]+([a-zA-Z0-9_-]{8,48})/i.exec(t) ||
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
          : lower.includes("story")
            ? "story"
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
  const cleaned = normalizeSearchQuery(raw);
  const quoted = cleaned.match(/"([^"]{1,120})"/);
  const exact = quoted?.[1]?.trim() || null;
  let rest = cleaned.replace(/"([^"]*)"/g, " ");
  const ops: {
    from?: string;
    inId?: string;
    after?: number;
    before?: number;
    has?: SearchHasFilter;
    minSize?: number;
    maxSize?: number;
    typeHint?: string;
  } = {};
  rest = rest.replace(/\b(from|in|after|before|has|minsize|maxsize|type):([^\s]+)/gi, (_, key: string, val: string) => {
    const k = key.toLowerCase();
    const v = val.replace(/^['"]|['"]$/g, "");
    if (k === "from") ops.from = v.replace(/^@/, "");
    else if (k === "in") ops.inId = v.replace(/^[@#]/, "");
    else if (k === "after") ops.after = parseSearchDate(v);
    else if (k === "before") ops.before = parseSearchDate(v);
    else if (k === "has") {
      const h = v.toLowerCase();
      if (h === "link" || h === "file" || h === "media" || h === "image" || h === "video" || h === "audio") ops.has = h;
    } else if (k === "minsize") ops.minSize = parseSize(v);
    else if (k === "maxsize") ops.maxSize = parseSize(v);
    else if (k === "type") ops.typeHint = v.replace(/^\./, "").toLowerCase();
    return " ";
  });
  const needle = needleOf(exact || rest || cleaned);
  const tokens = withoutStopWords(tokenizeSearch(needle));
  return {
    needle,
    exact,
    hashtags: extractHashtags(cleaned).map((h) => h.toLowerCase()),
    mentions: extractMentions(cleaned),
    entityHint: parseEntityHint(cleaned),
    from: ops.from,
    inId: ops.inId,
    after: ops.after,
    before: ops.before,
    has: ops.has,
    minSize: ops.minSize,
    maxSize: ops.maxSize,
    typeHint: ops.typeHint,
    tokens,
  };
}

function parseSearchDate(raw: string) {
  if (/^\d{10,13}$/.test(raw)) {
    const n = Number(raw);
    return n < 1e12 ? n * 1000 : n;
  }
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : undefined;
}

function parseSize(raw: string) {
  const m = /^(\d+(?:\.\d+)?)(kb|mb|b)?$/i.exec(raw);
  if (!m) return undefined;
  const n = Number(m[1]);
  const u = (m[2] || "b").toLowerCase();
  if (u === "mb") return Math.round(n * 1024 * 1024);
  if (u === "kb") return Math.round(n * 1024);
  return Math.round(n);
}

export const SEARCH_SORTS = ["relevance", "newest", "oldest", "popular"] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

export const SEARCH_FEEDS = ["discovery", "trending"] as const;
export type SearchFeed = (typeof SEARCH_FEEDS)[number];
