import Link from "next/link";
import { notFound } from "next/navigation";
import { DOC_PAGES, docsIndex, getDoc } from "@/lib/docs-catalog";
import { DocArticle, DocsShell } from "@/components/docs-shell";

export function generateStaticParams() {
  return DOC_PAGES.map((p) => ({ slug: p.slug }));
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) notFound();
  const idx = docsIndex();
  return (
    <div className="min-h-dvh bg-[#071614] text-white">
      <header className="border-b border-white/10 px-4 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between text-sm">
          <Link href="/docs" className="text-amber-200">
            فهرست مستندات
          </Link>
          <span className="text-amber-100/60">v{idx.version}</span>
        </div>
      </header>
      <DocsShell items={idx.pages} active={slug} version={idx.version}>
        <DocArticle title={doc.title} headings={doc.headings} body={doc.body} owner={doc.owner} />
      </DocsShell>
    </div>
  );
}
