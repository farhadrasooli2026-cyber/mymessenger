"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NixoMark } from "@/components/nixo-mark";

type Category = { id: string; en: string; fa: string; sort: number };
type Item = { id: string; categoryId: string; title: string; svg: string; sort: number };

export function AdminAvatars() {
  const [authed, setAuthed] = useState(false);
  const [key, setKey] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [en, setEn] = useState("");
  const [fa, setFa] = useState("");
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");

  async function load() {
    const res = await fetch("/api/admin/catalog");
    if (!res.ok) {
      setAuthed(false);
      return;
    }
    const data = await res.json();
    setAuthed(true);
    setCategories(data.categories ?? []);
    setItems(data.items ?? []);
    if (!categoryId && data.categories?.[0]) setCategoryId(data.categories[0].id);
  }

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/admin/catalog", { signal: ac.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setAuthed(true);
        setCategories(data.categories ?? []);
        setItems(data.items ?? []);
        setCategoryId((current) => current || data.categories?.[0]?.id || "");
      })
      .catch(() => undefined);
    return () => ac.abort();
  }, []);

  async function login() {
    const res = await fetch("/api/admin/catalog", {
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
            <p className="text-lg font-semibold">عکس‌های آماده پروفایل</p>
          </div>
        </header>
        {!authed ? (
          <div className="flex gap-2">
            <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="کلید مدیر" className="bg-black/20" />
            <Button className="bg-amber-300 text-[#102824]" onClick={login}>
              ورود
            </Button>
          </div>
        ) : (
          <>
            <section className="space-y-2 rounded-2xl border border-white/10 p-4">
              <p className="font-medium">دسته‌بندی جدید</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input value={en} onChange={(e) => setEn(e.target.value)} placeholder="English" className="bg-black/20" />
                <Input value={fa} onChange={(e) => setFa(e.target.value)} placeholder="فارسی" className="bg-black/20" />
                <Button
                  onClick={async () => {
                    await fetch("/api/admin/catalog", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "add-category", en, fa }),
                    });
                    await load();
                  }}
                >
                  ایجاد
                </Button>
              </div>
            </section>
            <section className="space-y-2 rounded-2xl border border-white/10 p-4">
              <p className="font-medium">عکس جدید</p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="h-9 rounded-lg bg-black/30 px-2 text-sm"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.fa}
                    </option>
                  ))}
                </select>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="عنوان" className="bg-black/20" />
                <Button
                  onClick={async () => {
                    await fetch("/api/admin/catalog", {
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
            </section>
            <div className="grid gap-3 sm:grid-cols-3">
              {items.map((item) => (
                <article key={item.id} className="rounded-2xl border border-white/10 p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`data:image/svg+xml;utf8,${encodeURIComponent(item.svg)}`} alt="" className="aspect-square w-full rounded-xl" />
                  <p className="mt-2 text-sm">{item.title}</p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-white"
                      onClick={async () => {
                        await fetch("/api/admin/catalog", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ action: "update-item", id: item.id, sort: item.sort - 1 }),
                        });
                        await load();
                      }}
                    >
                      جلو
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-200"
                      onClick={async () => {
                        await fetch("/api/admin/catalog", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ action: "delete-item", id: item.id }),
                        });
                        await load();
                      }}
                    >
                      حذف
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
