"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Product = {
  id: string;
  kind: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  stock: number | null;
  available: boolean;
  category: string;
  code: string;
  photoUrl: string | null;
};

type Cart = { items: { productId: string; name: string; qty: number; price: number; line: number }[]; total: number };

export function ProductDetail({ businessId, productId }: { businessId: string; productId: string }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [qty, setQty] = useState(1);
  const [cart, setCart] = useState<Cart | null>(null);
  const [delivery, setDelivery] = useState("");
  const [missing, setMissing] = useState(false);

  function loadCart() {
    fetch(`/api/business?view=cart&businessId=${businessId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setCart(d.cart);
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    fetch("/api/business", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "viewProduct", businessId, productId }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) setMissing(true);
        else setProduct(d.product);
      })
      .catch(() => setMissing(true));
    fetch(`/api/business?view=cart&businessId=${businessId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setCart(d.cart);
      })
      .catch(() => undefined);
  }, [businessId, productId]);

  if (missing) {
    return (
      <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
        <p>محصول یافت نشد.</p>
      </main>
    );
  }
  if (!product) {
    return (
      <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
        <p className="text-sm text-emerald-100/60">بارگذاری محصول…</p>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="overflow-hidden rounded-2xl bg-white/10">
          {product.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.photoUrl} alt="" className="h-48 w-full object-cover" />
          ) : (
            <div className="flex h-32 items-center justify-center text-xs text-emerald-100/40">بدون عکس</div>
          )}
        </div>
        <h1 className="text-xl font-semibold">{product.name}</h1>
        <p className="text-sm leading-7">{product.description}</p>
        <p className="text-amber-200">
          {product.price} {product.currency} · {product.available ? "موجود" : "ناموجود"} · کد {product.code}
        </p>
        <p className="text-xs">گزینه: تعداد برای سفارش. رنگ/سایز در نسخهٔ بعدی کاتالوگ.</p>
        <div className="flex items-center gap-2">
          <Input className="w-20" type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value) || 1)} />
          <Button
            type="button"
            className="bg-amber-300 text-[#102824]"
            disabled={!product.available}
            onClick={() => {
              void fetch("/api/business", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "cart", businessId, productId, qty }),
              })
                .then((r) => r.json())
                .then((d) => {
                  if (!d.ok) toast.error(d.error);
                  else {
                    toast.success("به سبد اضافه شد.");
                    setCart(d.cart);
                  }
                });
            }}
          >
            Add to Cart
          </Button>
        </div>
        <section className="rounded-xl border border-white/10 p-3 text-sm">
          <h2 className="font-medium">سبد</h2>
          {!cart?.items.length && <p className="text-xs text-emerald-100/50">سبد خالی است.</p>}
          <ul className="mt-2 space-y-1 text-xs">
            {cart?.items.map((i) => (
              <li key={i.productId}>
                {i.name} × {i.qty} = {i.line}
              </li>
            ))}
          </ul>
          {cart && cart.items.length > 0 && <p className="mt-2">جمع: {cart.total}</p>}
          <Input className="mt-2" value={delivery} onChange={(e) => setDelivery(e.target.value)} placeholder="آدرس تحویل / توضیح سفارش" />
          <Button
            type="button"
            className="mt-2"
            onClick={() => {
              void fetch("/api/business", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "order", businessId, delivery }),
              })
                .then((r) => r.json())
                .then((d) => {
                  if (!d.ok) toast.error(d.error);
                  else {
                    toast.success(`سفارش ${d.order.id} با وضعیت Pending ثبت شد.`);
                    loadCart();
                  }
                });
            }}
          >
            ثبت سفارش
          </Button>
          <p className="mt-2 text-[11px] text-emerald-100/50">پرداخت Invoice/Refund وقتی NIXO Pay زنده شود به همین سفارش وصل می‌شود.</p>
        </section>
        <Link href={`/app/business/b/${businessId}`} className="text-xs text-amber-200">
          بازگشت به فروشگاه
        </Link>
      </div>
    </main>
  );
}
