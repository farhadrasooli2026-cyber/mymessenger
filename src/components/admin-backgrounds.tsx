"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NixoMark } from "@/components/nixo-mark";

type Category = { id: string; en: string; fa: string };
type Item = { id: string; categoryId: string; title: string; svg: string };

export function AdminBackgrounds() {
  const [authed, setAuthed] = useState(false);
  const [key, setKey] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [en, setEn] = useState("");
  const [fa, setFa] = useState("");
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");

  async function load() {
    const res = await fetch("/api/admin/backgrounds");
    if (!res.ok) {
      setAuthed(false);
      return;
    }
    const data = await res.json();
    setAuthed(true);
    setCategories(data.categories ?? []);
    setItems(data.items ?? []);
    setCategoryId((c) => c || data.categories?.[0]?.id || "");
  }

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/admin/backgrounds", { signal: ac.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setAuthed(true);
        setCategories(data.categories ?? []);
        setItems(data.items ?? []);
        setCategoryId((c) => c || data.categories?.[0]?.id || "");
      })
      .catch(() => undefined);
    return () => ac.abort();
  }, []);

  async function login() {
    const res = await fetch("/api/admin/backgrounds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", key }),
    });
    if (res.ok) await load();
  }

  return (
    <div className="min-h-dvh bg-[#071614] px-4 py-8 text-white">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="flex items-center gap-3">
          <NixoMark size={36} />
          <div>
            <p className="text-xs text-emerald-100/60">مدیر نیکسو</p>
            <p className="text-lg font-semibold">پس‌زمینه‌های آماده</p>
          </div>
        </header>
        {!authed ? (
          <div className="flex gap-2">
            <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="کلید مدیر" className="bg-black/20" />
            <Button className="bg-amber-300 text-[#102824]" onClick={login}>ورود</Button>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input value={en} onChange={(e) => setEn(e.target.value)} placeholder="English" className="bg-black/20" />
              <Input value={fa} onChange={(e) => setFa(e.target.value)} placeholder="فارسی" className="bg-black/20" />
              <Button
                onClick={async () => {
                  await fetch("/api/admin/backgrounds", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "add-category", en, fa }),
                  });
                  await load();
                }}
              >
                دسته جدید
              </Button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="h-9 rounded-lg bg-black/30 px-2 text-sm">
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.fa}</option>
                ))}
              </select>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="عنوان" className="bg-black/20" />
              <Button
                onClick={async () => {
                  await fetch("/api/admin/backgrounds", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "add-item", categoryId, title }),
                  });
                  await load();
                }}
              >
                افزودن
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {items.map((item) => (
                <article key={item.id} className="rounded-2xl border border-white/10 p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`data:image/svg+xml;utf8,${encodeURIComponent(item.svg)}`} alt="" className="aspect-video w-full rounded-xl" />
                  <p className="mt-2 text-sm">{item.title}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-red-200"
                    onClick={async () => {
                      await fetch("/api/admin/backgrounds", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "delete-item", id: item.id }),
                      });
                      await load();
                    }}
                  >
                    حذف
                  </Button>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
