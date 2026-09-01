/** Controlled public-only ranking eval. Never stores private queries or snippets. */

import type { SearchHit } from "@/lib/search-types";

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
