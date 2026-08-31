import { json, jsonError } from "@/lib/http";
import { requireActiveUser } from "@/lib/auth";
import { clearSearchHistory, getSearchHistory, globalSearch, removeSearchHistoryItem } from "@/lib/search";
import { SEARCH_KINDS, type SearchKind } from "@/lib/search-types";

export async function GET(request: Request) {
  const user = await requireActiveUser();
  if (!user) return jsonError("نشست فعال نیست.", 401);
  const url = new URL(request.url);
  if (url.searchParams.get("history") === "1") {
    const history = await getSearchHistory(user.id);
    return json({ ok: true, history });
  }
  const kindRaw = url.searchParams.get("kind") ?? "all";
  const kind = (SEARCH_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as SearchKind) : "all";
  if (url.searchParams.get("suggest") === "1") {
    const { suggestSearch } = await import("@/lib/search");
    const result = await suggestSearch(user.id, url.searchParams.get("q") ?? "");
    if (!result.ok) return jsonError(result.error, result.status);
    return json(result);
  }
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
  });
  if (!result.ok) return jsonError(result.error, result.status);
  return json(result);
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
