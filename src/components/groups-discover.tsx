"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Hit = {
  id: string;
  name: string;
  description: string;
  username: string | null;
  color: string;
  category?: string;
  tags?: string[];
  memberCount: number;
  joined?: boolean;
};

export function GroupsDiscover({
  onOpen,
  onClose,
}: {
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [recs, setRecs] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const [d, r] = await Promise.all([
        fetch(`/api/groups/discover?q=${encodeURIComponent(q)}`).then((x) => x.json()),
        fetch("/api/groups/discover?mode=recommend").then((x) => x.json()),
      ]);
      setHits(d.groups ?? []);
      setRecs(r.groups ?? []);
      setLoaded(true);
    } finally {
      setBusy(false);
    }
  }

  async function join(id: string) {
    const res = await fetch(`/api/groups/${id}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acceptRules: true }),
    });
    const data = await res.json();
    if (!res.ok) return;
    if (data.group?.id) onOpen(data.group.id);
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <div className="max-h-[80vh] w-full max-w-md overflow-auto rounded-3xl bg-[#102824] p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">کشف گروه‌های عمومی</h2>
        <p className="mt-1 text-xs text-emerald-100/60">فقط گروه‌های Public در این فهرست هستند. گروه خصوصی هرگز اینجا ظاهر نمی‌شود.</p>
        <div className="mt-3 flex gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو" className="h-9 bg-black/20" />
          <Button type="button" size="sm" variant="secondary" onClick={() => void load()} disabled={busy}>
            جستجو
          </Button>
        </div>
        {recs.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium">پیشنهاد برای تو</p>
            {recs.map((g) => (
              <GroupHit key={`r-${g.id}`} g={g} onJoin={join} onOpen={onOpen} />
            ))}
          </div>
        )}
        <div className="mt-4">
          <p className="text-xs font-medium">نتایج</p>
          {hits.length === 0 && loaded && <p className="mt-2 text-xs text-emerald-100/50">گروه عمومی مطابق جستجو نیست.</p>}
          {!loaded && <p className="mt-2 text-xs text-emerald-100/50">برای دیدن گروه‌های عمومی جستجو کن.</p>}
          {hits.map((g) => (
            <GroupHit key={g.id} g={g} onJoin={join} onOpen={onOpen} />
          ))}
        </div>
      </div>
    </div>
  );
}

function GroupHit({ g, onJoin, onOpen }: { g: Hit; onJoin: (id: string) => void; onOpen: (id: string) => void }) {
  return (
    <div className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm">
      <button type="button" className="text-right" onClick={() => (g.joined ? onOpen(g.id) : onJoin(g.id))}>
        <span className="block font-medium">{g.name}</span>
        <span className="block text-[11px] text-emerald-100/50">
          {g.category ?? "general"} · {g.memberCount} عضو{g.username ? ` · @${g.username}` : ""}
        </span>
      </button>
      <Button type="button" size="sm" variant="secondary" onClick={() => (g.joined ? onOpen(g.id) : onJoin(g.id))}>
        {g.joined ? "باز" : "پیوستن"}
      </Button>
    </div>
  );
}
