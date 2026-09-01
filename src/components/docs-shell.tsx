"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import type { DocGroup } from "@/lib/docs-catalog";

export type DocNavItem = {
  slug: string;
  title: string;
  group: DocGroup;
  summary: string;
  tags: string[];
};

export function DocsShell({
  items,
  active,
  version,
  children,
}: {
  items: DocNavItem[];
  active?: string;
  version: string;
  children: React.ReactNode;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (n.length < 2) return items;
    return items.filter((p) => `${p.title} ${p.summary} ${p.tags.join(" ")} ${p.slug}`.toLowerCase().includes(n));
  }, [items, q]);
  const groups = useMemo(() => {
    const map = new Map<DocGroup, DocNavItem[]>();
    for (const p of filtered) {
      const arr = map.get(p.group) ?? [];
      arr.push(p);
      map.set(p.group, arr);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-6 px-4 py-6 lg:flex-row">
      <aside className="lg:w-72 lg:shrink-0">
        <p className="text-xs text-amber-100/60">مستندات نیکسو · v{version}</p>
        <Input className="mt-2" placeholder="جستجو در مستندات" value={q} onChange={(e) => setQ(e.target.value)} aria-label="جستجوی مستندات" />
        <nav className="mt-4 space-y-3 text-sm" aria-label="فهرست مستندات">
          {groups.map(([group, pages]) => (
            <details key={group} open className="rounded-xl border border-white/10 bg-white/5 p-3">
              <summary className="cursor-pointer font-medium">{group}</summary>
              <ul className="mt-2 space-y-1">
                {pages.map((p) => (
                  <li key={p.slug}>
                    <Link
                      href={`/docs/${p.slug}`}
                      className={active === p.slug ? "text-amber-200" : "text-emerald-100/80 hover:text-amber-100"}
                    >
                      {p.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          ))}
          {filtered.length === 0 && <p className="text-amber-100/60">نتیجه‌ای نیست.</p>}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function DocArticle({ title, headings, body, owner }: { title: string; headings: string[]; body: string; owner: string }) {
  const blocks = splitDocBody(body);
  return (
    <article className="max-w-3xl pb-16">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-1 text-xs text-amber-100/55">مالک: {owner}</p>
      {headings.length > 1 && (
        <nav className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3 text-sm" aria-label="فهرست مطالب">
          <p className="text-xs text-amber-100/60">فهرست</p>
          <ul className="mt-1 list-disc ps-5">
            {headings.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </nav>
      )}
      <div className="mt-6 space-y-3 text-sm leading-8 text-emerald-50/90">
        {blocks.map((b, i) =>
          b.type === "code" ? (
            <pre key={i} className="overflow-x-auto rounded-lg bg-black/40 p-3 text-xs text-amber-50">
              {b.text}
            </pre>
          ) : b.type === "h2" ? (
            <h2 key={i} className="pt-4 text-lg font-medium text-white">
              {b.text}
            </h2>
          ) : b.type === "li" ? (
            <p key={i} className="ps-3">
              • {b.text}
            </p>
          ) : (
            <p key={i} className="whitespace-pre-wrap">
              {b.text}
            </p>
          ),
        )}
      </div>
    </article>
  );
}

function splitDocBody(body: string): { type: "p" | "h2" | "li" | "code"; text: string }[] {
  const out: { type: "p" | "h2" | "li" | "code"; text: string }[] = [];
  const parts = body.split("```");
  parts.forEach((part, idx) => {
    if (idx % 2 === 1) {
      out.push({ type: "code", text: part.replace(/^\w*\n/, "") });
      return;
    }
    for (const line of part.split("\n")) {
      if (line.startsWith("## ")) out.push({ type: "h2", text: line.slice(3) });
      else if (line.startsWith("- ")) out.push({ type: "li", text: line.slice(2) });
      else if (line.trim()) out.push({ type: "p", text: line });
    }
  });
  return out;
}
