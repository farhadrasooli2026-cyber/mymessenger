import { json } from "@/lib/http";
import { docsIndex, getDoc, searchDocs } from "@/lib/docs-catalog";

/** Public docs index — no secrets, no user records. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  const slug = new URL(request.url).searchParams.get("slug");
  if (slug) {
    const page = getDoc(slug);
    if (!page) return json({ ok: false, error: "صفحه یافت نشد." }, 404);
    return json({ ok: true, page: { slug: page.slug, title: page.title, group: page.group, summary: page.summary, headings: page.headings } });
  }
  if (q.trim()) return json({ ok: true, version: docsIndex().version, pages: searchDocs(q) });
  return json({ ok: true, ...docsIndex() });
}
