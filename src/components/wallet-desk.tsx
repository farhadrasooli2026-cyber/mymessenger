"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Tx = { id: string; amount: number; currency: string; type: string; status: string; createdAt: number; note: string };

export function WalletDesk() {
  const [balances, setBalances] = useState<Record<string, number>>({ USD: 0, EUR: 0, TRY: 0 });
  const [txs, setTxs] = useState<Tx[]>([]);
  const [amount, setAmount] = useState("50");
  const [currency, setCurrency] = useState("USD");
  const [to, setTo] = useState("");
  const [fx, setFx] = useState("");

  function load() {
    fetch("/api/shop?view=wallet", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setBalances(d.wallet.balances ?? {});
          setTxs(d.txs ?? []);
          setFx(d.fxSource ?? "");
        }
      })
      .catch(() => undefined);
  }

  useEffect(() => {
    fetch("/api/shop?view=wallet", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setBalances(d.wallet.balances ?? {});
          setTxs(d.txs ?? []);
          setFx(d.fxSource ?? "");
        }
      })
      .catch(() => undefined);
  }, []);

  async function op(kind: "add" | "withdraw" | "transfer") {
    const res = await fetch("/api/shop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "wallet", op: kind, amount: Number(amount), currency, confirm: true, toUsername: to }),
    });
    const d = await res.json();
    if (!res.ok) toast.error(d.error);
    else {
      toast.success("ثبت شد (سندباکس).");
      load();
    }
  }

  return (
    <main className="min-h-dvh bg-[#071614] p-5 text-emerald-50">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-2">
          <NixoMark size={36} />
          <div>
            <p className="text-xs text-amber-200">NIXO Wallet</p>
            <h1 className="text-xl font-semibold">کیف پول سندباکس</h1>
          </div>
        </div>
        <p className="text-xs leading-6 text-emerald-100/60">
          این موجودی پول واقعی نیست. Add / Withdraw / Transfer / Payment فقط با نشست فعال و تأیید صریح انجام می‌شود. تبدیل ارز از جدول سندباکس نیکسو است نه بازار زنده.
        </p>
        <ul className="grid grid-cols-3 gap-2 text-center text-sm">
          {["USD", "EUR", "TRY"].map((c) => (
            <li key={c} className="rounded-xl border border-white/10 p-3">
              <p className="text-[11px] text-amber-200">{c}</p>
              <p>{balances[c] ?? 0}</p>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-emerald-100/45">{fx}</p>
        <div className="flex gap-2">
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} />
          <select className="rounded-lg bg-white/10 px-2" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option>USD</option>
            <option>EUR</option>
            <option>TRY</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void op("add")}>Add Money</Button>
          <Button type="button" variant="outline" onClick={() => void op("withdraw")}>Withdraw</Button>
        </div>
        <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="@username برای Transfer" />
        <Button type="button" variant="outline" onClick={() => void op("transfer")}>Transfer</Button>
        <h2 className="text-sm">تراکنش‌ها</h2>
        <ul className="space-y-1 text-xs">
          {txs.length === 0 && <li className="text-emerald-100/50">تراکنشی نیست.</li>}
          {txs.map((t) => (
            <li key={t.id} dir="ltr">
              {t.id} · {t.type} · {t.amount} {t.currency} · {t.status}
            </li>
          ))}
        </ul>
        <Link href="/app/orders" className="text-xs text-amber-200">Orders</Link>
      </div>
    </main>
  );
}
