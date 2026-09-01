import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import {
  clearSearchHistory,
  evaluateSearchQuality,
  exportSearchHistory,
  getSearchHistory,
  globalSearch,
  hideSearchRecommendation,
  rebuildSearchIndex,
  reindexSearchScope,
  removeSearchHistoryItem,
  searchHealth,
  setSearchPersonalize,
  tombstoneSearchDoc,
} from "@/lib/search";
import { SEARCH_KINDS, type SearchKind } from "@/lib/search-types";
import { SEARCH_FEEDS, SEARCH_RANKINGS, SEARCH_SORTS, type SearchFeed, type SearchHasFilter, type SearchRanking, type SearchSort } from "@/lib/search-query";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  if (url.searchParams.get("health") === "1") {
    return json(await searchHealth());
  }
  if (url.searchParams.get("eval") === "1") {
    const result = await evaluateSearchQuality(user.id);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (url.searchParams.get("history") === "1") {
    const history = await getSearchHistory(user.id);
    return json({ ok: true, history });
  }
  if (url.searchParams.get("export") === "1") {
    const result = await exportSearchHistory(user.id);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  const kindRaw = url.searchParams.get("kind") ?? "all";
  const kind = (SEARCH_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as SearchKind) : "all";
  if (url.searchParams.get("suggest") === "1") {
    const { suggestSearch } = await import("@/lib/search");
    const result = await suggestSearch(user.id, url.searchParams.get("q") ?? "");
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  const sortRaw = url.searchParams.get("sort") ?? "relevance";
  const sort = (SEARCH_SORTS as readonly string[]).includes(sortRaw) ? (sortRaw as SearchSort) : "relevance";
  const feedRaw = url.searchParams.get("feed") ?? "";
  const feed = (SEARCH_FEEDS as readonly string[]).includes(feedRaw) ? (feedRaw as SearchFeed) : undefined;
  const rankingRaw = url.searchParams.get("ranking") ?? "";
  const ranking = (SEARCH_RANKINGS as readonly string[]).includes(rankingRaw) ? (rankingRaw as SearchRanking) : undefined;
  const hasRaw = url.searchParams.get("has") ?? "";
  const hasOk = (
    ["link", "file", "media", "image", "video", "audio", "mention", "hashtag", "document"] as const
  ).includes(hasRaw as SearchHasFilter);
  const result = await globalSearch(user.id, {
    q: url.searchParams.get("q") ?? "",
    kind,
    from: url.searchParams.get("from") ?? undefined,
    fromDate: url.searchParams.get("fromDate") ? Number(url.searchParams.get("fromDate")) : undefined,
    toDate: url.searchParams.get("toDate") ? Number(url.searchParams.get("toDate")) : undefined,
    minSize: url.searchParams.get("minSize") ? Number(url.searchParams.get("minSize")) : undefined,
    maxSize: url.searchParams.get("maxSize") ? Number(url.searchParams.get("maxSize")) : undefined,
    has: hasOk ? (hasRaw as SearchHasFilter) : undefined,
    offset: url.searchParams.get("offset") ? Number(url.searchParams.get("offset")) : 0,
    limit: url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined,
    minPrice: url.searchParams.get("minPrice") ? Number(url.searchParams.get("minPrice")) : undefined,
    maxPrice: url.searchParams.get("maxPrice") ? Number(url.searchParams.get("maxPrice")) : undefined,
    category: url.searchParams.get("category") ?? undefined,
    chatId: url.searchParams.get("chatId") ?? undefined,
    groupId: url.searchParams.get("groupId") ?? undefined,
    channelId: url.searchParams.get("channelId") ?? undefined,
    fileType: url.searchParams.get("fileType") ?? undefined,
    exact: url.searchParams.get("exact") === "1",
    semantic: url.searchParams.get("semantic") === "1",
    ranking,
    sort,
    feed,
    cursor: url.searchParams.get("cursor") ?? undefined,
    recordHistory: url.searchParams.get("historyWrite") !== "0",
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return json(result);
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as {
    action?: string;
    id?: string;
    scope?: string;
    personalize?: boolean;
    reason?: string;
  } | null;
  if (body?.action === "rebuild") {
    const result = await rebuildSearchIndex(user.id);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body?.action === "reindex_scope") {
    const result = await reindexSearchScope(user.id, String(body.scope ?? body.id ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body?.action === "tombstone") {
    const result = await tombstoneSearchDoc(user.id, String(body.id ?? ""), String(body.reason ?? "ops"));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body?.action === "personalize") {
    const result = await setSearchPersonalize(user.id, body.personalize !== false);
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  if (body?.action === "hide") {
    const result = await hideSearchRecommendation(user.id, String(body.id ?? ""));
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
  return jsonError("عملیات ناشناخته است.", 400);
}

export async function DELETE(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  const item = url.searchParams.get("item");
  if (item) {
    const result = await removeSearchHistoryItem(user.id, item);
    if (!result.ok) return jsonError(result.error, result.status);
    return json({ ok: true, history: result.history });
  }
  const result = await clearSearchHistory(user.id);
  if (!result.ok) return jsonError(result.error, result.status);
  return json({ ok: true });
}
