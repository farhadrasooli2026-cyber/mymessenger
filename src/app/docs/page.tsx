import Link from "next/link";
import { docsIndex } from "@/lib/docs-catalog";
import { DocsShell } from "@/components/docs-shell";

export default function DocsHomePage() {
  const idx = docsIndex();
  return (
    <div className="min-h-dvh bg-[#071614] text-white">
      <header className="border-b border-white/10 px-4 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between text-sm">
          <Link href="/" className="text-amber-200">
            نیکسو
          </Link>
          <span className="text-amber-100/60">مرجع Developer · v{idx.version}</span>
        </div>
      </header>
      <DocsShell items={idx.pages} version={idx.version}>
        <div className="max-w-3xl space-y-4 pt-2">
          <h1 className="text-2xl font-semibold">مستندات نیکسو</h1>
          <p className="text-sm leading-8 text-emerald-50/85">
            این مرجع با نسخهٔ فعلی اپ و API هم‌خوان است. Secret واقعی، رمز، توکن یا دادهٔ کاربر در این صفحات نیست. از فهرست یا جستجو استفاده کن.
          </p>
          <ul className="grid gap-3 sm:grid-cols-2">
            {idx.pages.map((p) => (
              <li key={p.slug} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <p className="text-[11px] text-amber-100/55">{p.group}</p>
                <Link href={`/docs/${p.slug}`} className="text-base font-medium text-amber-100">
                  {p.title}
                </Link>
                <p className="mt-1 text-xs text-emerald-100/70">{p.summary}</p>
              </li>
            ))}
          </ul>
        </div>
      </DocsShell>
    </div>
  );
}
