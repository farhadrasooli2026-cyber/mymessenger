import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import {
  clearSearchHistory,
  exportSearchHistory,
  getSearchHistory,
  globalSearch,
  rebuildSearchIndex,
  removeSearchHistoryItem,
} from "@/lib/search";
import { SEARCH_KINDS, type SearchKind } from "@/lib/search-types";
import { SEARCH_FEEDS, SEARCH_SORTS, type SearchFeed, type SearchSort } from "@/lib/search-query";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
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
  const result = await globalSearch(user.id, {
    q: url.searchParams.get("q") ?? "",
    kind,
    from: url.searchParams.get("from") ?? undefined,
    fromDate: url.searchParams.get("fromDate") ? Number(url.searchParams.get("fromDate")) : undefined,
    toDate: url.searchParams.get("toDate") ? Number(url.searchParams.get("toDate")) : undefined,
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
    sort,
    feed,
    recordHistory: url.searchParams.get("historyWrite") !== "0",
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return json(result);
}

export async function POST(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  if (body?.action === "rebuild") {
    const result = await rebuildSearchIndex(user.id);
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
