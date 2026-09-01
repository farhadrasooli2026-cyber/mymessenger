/** Shared search helpers — safe on client and server. No private data. */

const YE = /ي/g;
const KAF = /ك/g;
const DIAC = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;

export function foldText(raw: string) {
  return raw
    .normalize("NFKC")
    .replace(/\u0130/g, "i")
    .replace(/\u0131/g, "i")
    .replace(YE, "ی")
    .replace(KAF, "ک")
    .replace(DIAC, "")
    .replace(/ş/gi, "s")
    .replace(/ğ/gi, "g")
    .replace(/ç/gi, "c")
    .replace(/ö/gi, "o")
    .replace(/ü/gi, "u")
    .toLocaleLowerCase("en");
}

export function editDistance(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  if (Math.abs(a.length - b.length) > 2) return 9;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const next = a[i - 1] === b[j - 1] ? diag : Math.min(diag, prev[j], prev[j - 1]) + 1;
      diag = prev[j];
      prev[j] = next;
    }
  }
  return prev[b.length];
}

export function matchScore(haystack: string, needle: string) {
  const h = foldText(haystack);
  const n = foldText(needle);
  if (!n) return 0;
  if (h === n) return 100;
  if (h.startsWith(n) || h.split(/\s+/).some((w) => w === n)) return 86;
  if (h.includes(n)) return 64;
  const words = h.split(/[\s@/_-]+/).filter(Boolean);
  let best = 0;
  for (const w of words) {
    if (n.length >= 3 && w.startsWith(n)) best = Math.max(best, 72);
    if (n.length >= 4 && w.length >= 4 && editDistance(w.slice(0, n.length + 1), n) <= 1) best = Math.max(best, 48);
  }
  return best;
}

export function sanitizeSearchSnippet(text: string, max = 160) {
  return text
    .replace(/<\s*script[\s\S]*?>[\s\S]*?<\s*\/\s*script\s*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/javascript:/gi, "")
    .slice(0, max);
}

export function translitExpand(q: string) {
  const folded = foldText(q);
  const out = [q];
  if (/(nixo|nikso)/.test(folded)) out.push("نیکسو");
  if (/group/.test(folded)) out.push("گروه");
  if (/channel/.test(folded)) out.push("کانال");
  if (/(photo|fotograf)/.test(folded)) out.push("عکس");
  if (/video/.test(folded)) out.push("ویدیو");
  return [...new Set(out.filter(Boolean))];
}

export function blobMatches(blob: string, needle: string) {
  if (matchScore(blob, needle) >= 48) return true;
  return translitExpand(needle).some((v) => v !== needle && matchScore(blob, v) >= 48);
}

export function exactPhraseMatches(blob: string, phrase: string) {
  const n = foldText(phrase).trim();
  if (!n) return false;
  return foldText(blob).includes(n);
}

export function highlightText(text: string, needle: string) {
  const n = foldText(needle);
  if (!n || n.length < 2) return [{ t: text, hit: false }];
  const src = text;
  const folded = foldText(src);
  const idx = folded.indexOf(n);
  if (idx < 0) return [{ t: text, hit: false }];
  const before = src.slice(0, idx);
  const mid = src.slice(idx, idx + needle.length);
  const after = src.slice(idx + needle.length);
  return [
    ...(before ? [{ t: before, hit: false }] : []),
    { t: mid || src.slice(idx, idx + n.length), hit: true },
    ...(after ? [{ t: after, hit: false }] : []),
  ];
}

export const SEARCH_LEXICON = [
  "photo",
  "phone",
  "photography",
  "pdf",
  "zip",
  "doc",
  "invoice",
  "meeting",
  "nixo",
  "store",
  "group",
  "channel",
  "bot",
  "business",
  "product",
  "video",
  "voice",
  "file",
  "عکس",
  "تلفن",
  "عکاسی",
  "فاکتور",
  "جلسه",
  "فروشگاه",
  "گروه",
  "کانال",
  "ربات",
  "پیام",
  "محصول",
  "صوت",
  "ویدیو",
  "ملف",
  "صورة",
  "هاتف",
  "fotoğraf",
  "telefon",
  "fatura",
  "toplantı",
  "mağaza",
];

export function suggestTerms(q: string, extra: string[] = []) {
  const n = foldText(q);
  if (n.length < 2) return [];
  const pool = [...SEARCH_LEXICON, ...extra];
  const scored = pool
    .map((term) => ({ term, score: matchScore(term, n) }))
    .filter((x) => x.score >= 48)
    .sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of scored) {
    const key = foldText(row.term);
    if (seen.has(key) || key === n) continue;
    seen.add(key);
    out.push(row.term);
    if (out.length >= 8) break;
  }
  return out;
}

export function recencyBoost(at: number, now = Date.now()) {
  const days = Math.max(0, (now - at) / 86_400_000);
  return Math.max(0, 16 - Math.min(16, days / 7));
}
