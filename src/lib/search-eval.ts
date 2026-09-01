/** Controlled public-only ranking eval. Never stores private queries or snippets. */

import type { SearchHit } from "@/lib/search-types";
import { suggestTerms } from "@/lib/search-match";

export const SEARCH_EVAL_VERSION = 1;

export type SearchEvalCase = {
  id: string;
  q: string;
  kind: "channels" | "messages" | "users";
  expectPublicTitleIncludes?: string;
  forbidTitleIncludes?: string[];
};

export const SEARCH_EVAL_CASES: SearchEvalCase[] = [
  {
    id: "public-channel-keyword",
    q: "نکسو",
    kind: "channels",
    forbidTitleIncludes: ["خصوصی", "مخفی", "داخلی"],
  },
  {
    id: "boolean-and",
    q: "سلام AND کانال",
    kind: "messages",
  },
];

export const SEARCH_SUGGEST_EVAL = [
  { q: "nixo", expect: ["nixo"] },
  { q: "phot", expect: ["photo"] },
  { q: "گرو", expect: ["گروه"] },
] as const;

export function scoreSuggestEval(extra: string[] = []) {
  const rows = SEARCH_SUGGEST_EVAL.map((c) => {
    const got = suggestTerms(c.q, extra).map((s) => s.toLocaleLowerCase("en"));
    const hit = c.expect.filter((e) => got.some((g) => g.includes(e.toLocaleLowerCase("en")))).length;
    return { q: c.q, recall: c.expect.length ? hit / c.expect.length : 1 };
  });
  const recall = rows.reduce((n, r) => n + r.recall, 0) / Math.max(1, rows.length);
  return { recall, rows };
}

export function scoreEvalHits(hits: SearchHit[], forbidTitleIncludes: string[] = []) {
  const leaked = hits.filter((h) =>
    forbidTitleIncludes.some((n) => `${h.title} ${h.preview}`.includes(n)),
  ).length;
  const allowed = hits.length - leaked;
  return {
    hits: hits.length,
    leaked,
    allowed,
    precision: hits.length === 0 ? 1 : allowed / hits.length,
  };
}
