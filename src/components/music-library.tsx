"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { NixoMark } from "@/components/nixo-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMusic, type Playable } from "@/components/music-shell";
import { formatBytes } from "@/lib/media";
import { MUSIC_KIND_FA, type MusicKind } from "@/lib/music-types";

type Track = Playable & {
  kind: MusicKind;
  favorite?: boolean;
  size?: number;
  format?: string;
  licensed?: boolean;
};

const TABS: (MusicKind | "all")[] = ["all", "music", "song", "podcast", "voice", "file"];
const FILTERS = ["all", "songs", "albums", "artists", "playlists", "files", "voice", "favorites"] as const;

export function MusicLibrary() {
  const music = useMusic();
  const [kind, setKind] = useState<MusicKind | "all">("all");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Track[]>([]);
  const [catalog, setCatalog] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<{ id: string; name: string; trackIds: string[] }[]>([]);
  const [artists, setArtists] = useState<string[]>([]);
  const [albums, setAlbums] = useState<string[]>([]);
  const [stats, setStats] = useState<{ audio: number; music?: number; voice?: number; files?: number; cache: number; count: number } | null>(null);
  const [prefs, setPrefs] = useState<{ lastTrackId: string | null; lastPositionMs: number; recentlyPlayed: { id: string; catalog: boolean; at: number; title?: string }[] } | null>(null);
  const [plName, setPlName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [upBytes, setUpBytes] = useState({ sent: 0, total: 0 });
  const [dl, setDl] = useState<number | null>(null);
  const [dlBytes, setDlBytes] = useState({ got: 0, total: 0 });
  const [dlFail, setDlFail] = useState<Track | null>(null);
  const [voices, setVoices] = useState<{ id: string; peer: string; createdAt: number }[]>([]);
  const [cleanup, setCleanup] = useState<{ large: { id: string; title: string; size: number }[]; old: { id: string; title: string; size: number }[]; cacheBytes: number } | null>(null);
  const [detail, setDetail] = useState<Track | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abort = useRef(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ kind });
    if (q) params.set("q", q);
    if (filter === "favorites") params.set("filter", "favorites");
    const res = await fetch(`/api/music?${params}`, { cache: "no-store" });
    const data = await res.json();
    setItems(data.items ?? []);
    setCatalog(data.catalog ?? []);
    setPlaylists(data.playlists ?? []);
    setArtists(data.artists ?? []);
    setAlbums(data.albums ?? []);
    setStats(data.stats ?? null);
    setPrefs(data.prefs ?? null);
    setVoices(data.voices ?? []);
    setCleanup(data.cleanup ?? null);
  }, [kind, q, filter]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [load]);

  const library: Track[] = [...catalog, ...items];

  function queueOf(): Playable[] {
    return library.map((t) => t);
  }

  async function upload(files: FileList) {
    abort.current = false;
    const list = Array.from(files);
    const total = list.reduce((n, f) => n + f.size, 0);
    let sent = 0;
    setProgress(0);
    setUpBytes({ sent: 0, total });
    try {
      for (const file of list) {
        if (abort.current) break;
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => reject(new Error("read"));
          r.readAsDataURL(file);
        });
        let durationMs = 0;
        try {
          durationMs = await new Promise<number>((resolve) => {
            const a = document.createElement("audio");
            a.src = URL.createObjectURL(file);
            a.onloadedmetadata = () => resolve(Math.round((a.duration || 0) * 1000));
            a.onerror = () => resolve(0);
          });
        } catch {
          durationMs = 0;
        }
        const res = await fetch("/api/music", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: file.name, mime: file.type, dataUrl, kind, durationMs }),
        });
        const data = await res.json();
        if (!res.ok) toast.error(data.error ?? "آپلود نشد.");
        sent += file.size;
        setUpBytes({ sent, total });
        setProgress(total ? Math.round((sent / total) * 100) : 100);
      }
      await load();
    } catch {
      toast.error("آپلود شکست. Retry بزن.");
    } finally {
      setProgress(null);
    }
  }

  async function act(body: Record<string, unknown>) {
    const res = await fetch("/api/music", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) toast.error(data.error ?? "انجام نشد.");
    await load();
    setSelected([]);
  }

  async function download(t: Track) {
    if (!t.streamUrl) return;
    abort.current = false;
    setDl(0);
    setDlFail(null);
    setDlBytes({ got: 0, total: t.size ?? 0 });
    try {
      const res = await fetch(t.streamUrl, { cache: "no-store" });
      if (!res.ok) {
        toast.error("دانلود مجاز نیست.");
        setDlFail(t);
        setDl(null);
        return;
      }
      const total = Number(res.headers.get("content-length") || t.size || 0);
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let got = 0;
      if (reader) {
        for (;;) {
          if (abort.current) {
            await reader.cancel();
            break;
          }
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            got += value.byteLength;
            setDlBytes({ got, total });
            setDl(total ? Math.round((got / total) * 100) : 50);
          }
        }
      } else {
        const blob = await res.blob();
        chunks.push(new Uint8Array(await blob.arrayBuffer()));
        got = blob.size;
      }
      if (abort.current) return;
      const blob = new Blob(chunks as BlobPart[], { type: t.mime || "audio/wav" });
      try {
        const cache = await caches.open("nixo-audio");
        await cache.put(t.streamUrl, new Response(blob, { headers: { "Content-Type": blob.type } }));
      } catch {
        /* optional offline cache */
      }
      setDl(100);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${t.title}.${t.format || "audio"}`;
      a.click();
    } catch {
      setDlFail(t);
      toast.error("دانلود شکست. Retry بزن.");
    } finally {
      setDl(null);
    }
  }

  const filtered = library.filter((t) => {
    if (filter === "voice") return t.kind === "voice";
    if (filter === "files") return t.kind === "file";
    if (filter === "songs") return t.kind === "song" || t.kind === "music";
    if (filter === "favorites") return Boolean(t.favorite);
    return true;
  });

  const continueTrack = prefs?.lastTrackId
    ? library.find((t) => (prefs.lastTrackId?.startsWith("c:") ? t.catalog && t.id === prefs.lastTrackId.slice(2) : !t.catalog && t.id === prefs.lastTrackId))
    : null;

  return (
    <main className="min-h-dvh bg-[#071614] p-4 text-emerald-50">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <NixoMark size={36} />
            <div>
              <p className="text-xs text-amber-200">NIXO Music</p>
              <h1 className="text-xl font-semibold">کتابخانه صوت</h1>
            </div>
          </div>
          <Link href="/app/settings/audio" className="text-xs text-amber-200">Settings → Data & Storage → Audio</Link>
        </div>
        <p className="text-[11px] opacity-55">فهرست داخلی فقط صداهای اصل نیکسو با مجوز است. فایل خودت برای حساب خودت است و بدون نشست + توکن به دیگری داده نمی‌شود. موسیقی تجاری بدون مجوز اینجا نیست.</p>
        <div className="flex flex-wrap gap-1 text-[11px]">
          {TABS.map((t) => (
            <button key={t} type="button" className={`rounded-full px-2 py-1 ${kind === t ? "bg-amber-300 text-[#102824]" : "bg-white/10"}`} onClick={() => setKind(t)}>
              {t === "all" ? "همه" : MUSIC_KIND_FA[t]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1 text-[11px]">
          {FILTERS.map((f) => (
            <button key={f} type="button" className={`rounded-full px-2 py-1 ${filter === f ? "bg-white/20" : "bg-white/5"}`} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو آهنگ، هنرمند، آلبوم، فایل" className="h-9 max-w-md bg-black/20" />
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" className="bg-amber-300 text-[#102824]" onClick={() => fileRef.current?.click()}>Upload Audio</Button>
          <input ref={fileRef} type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac" multiple className="hidden" onChange={(e) => e.target.files && void upload(e.target.files)} />
        </div>
        {progress !== null && (
          <p className="text-xs">
            Uploading... {progress}% · {formatBytes(upBytes.sent)} از {formatBytes(upBytes.total)} · باقی {formatBytes(Math.max(0, upBytes.total - upBytes.sent))}
            <button type="button" className="text-rose-200" onClick={() => { abort.current = true; }}> Cancel</button>
            <button type="button" onClick={() => fileRef.current?.click()}> Retry</button>
          </p>
        )}
        {dl !== null && (
          <p className="text-xs">
            Downloading... {dl}% · {formatBytes(dlBytes.got)} از {formatBytes(dlBytes.total)} · باقی {formatBytes(Math.max(0, dlBytes.total - dlBytes.got))}
            <button type="button" className="text-rose-200" onClick={() => { abort.current = true; }}> Cancel</button>
          </p>
        )}
        {dlFail && (
          <button type="button" className="text-xs text-amber-200" onClick={() => void download(dlFail)}>Retry Download</button>
        )}
        {stats && (
          <p className="text-xs opacity-60">
            Storage: Music {formatBytes(stats.music ?? stats.audio)} · Voice {formatBytes(stats.voice ?? 0)} · Files {formatBytes(stats.files ?? 0)} · Cache {formatBytes(stats.cache)} · {stats.count} فایل
          </p>
        )}
        {cleanup && (cleanup.large.length > 0 || cleanup.old.length > 0 || cleanup.cacheBytes > 0) && (
          <section className="rounded-2xl bg-white/5 p-3 text-xs">
            <p className="font-medium">پیشنهاد پاک‌سازی</p>
            <p>Cache {formatBytes(cleanup.cacheBytes)}</p>
            {cleanup.large.slice(0, 3).map((f) => <p key={f.id}>حجیم: {f.title} · {formatBytes(f.size)}</p>)}
            {cleanup.old.slice(0, 3).map((f) => <p key={`o-${f.id}`}>قدیمی: {f.title}</p>)}
          </section>
        )}
        {continueTrack && (
          <button type="button" className="w-full rounded-2xl bg-white/10 p-3 text-right text-sm" onClick={() => music.play(continueTrack, queueOf(), { startMs: prefs?.lastPositionMs })}>
            Continue Listening · {continueTrack.title}
          </button>
        )}
        {filter === "artists" && (
          <div className="text-sm">{artists.map((a) => (
            <button key={a} type="button" className="block" onClick={() => setQ(a)}>{a}</button>
          ))}</div>
        )}
        {filter === "albums" && (
          <div className="text-sm">{albums.map((a) => (
            <button key={a} type="button" className="block" onClick={() => setQ(a)}>{a}</button>
          ))}</div>
        )}
        {voices.length > 0 && (filter === "voice" || filter === "all") && (
          <section className="rounded-2xl bg-white/5 p-3 text-xs">
            <h2 className="font-medium">Voice Messages چت (E2EE)</h2>
            <p className="opacity-55">فایل رمزشده فقط در گفتگو با کلید دستگاه باز می‌شود.</p>
            {voices.slice(0, 8).map((v) => (
              <p key={v.id}>{v.peer} · {new Date(v.createdAt).toLocaleDateString("fa-IR")}</p>
            ))}
          </section>
        )}
        <div className="flex flex-wrap gap-2">
          <Input value={plName} onChange={(e) => setPlName(e.target.value)} placeholder="Favorites / Workout" className="h-8 max-w-40 bg-black/20" />
          <Button type="button" size="sm" variant="secondary" onClick={() => void act({ action: "playlist", name: plName, trackIds: selected })}>Create Playlist</Button>
        </div>
        {filter === "playlists" || playlists.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {playlists.map((p) => (
              <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-xs">
                <button type="button" onClick={() => {
                  const tracks = p.trackIds.map((id) => items.find((t) => t.id === id)).filter(Boolean) as Track[];
                  if (tracks[0]) music.play(tracks[0], tracks);
                }}>{p.name} ({p.trackIds.length})</button>
                <button type="button" onClick={() => void act({ action: "playlist", id: p.id, name: p.name, trackIds: [...new Set([...p.trackIds, ...selected])] })}>+</button>
                <button type="button" onClick={() => void act({ action: "playlist", id: p.id, name: p.name, trackIds: p.trackIds.filter((id) => !selected.includes(id)) })}>−</button>
                <button type="button" onClick={() => {
                  const ids = [...p.trackIds];
                  if (ids.length < 2) return;
                  const last = ids.pop()!;
                  ids.unshift(last);
                  void act({ action: "playlist", id: p.id, name: p.name, trackIds: ids });
                }}>Reorder</button>
                <button type="button" onClick={() => plName && void act({ action: "playlist", id: p.id, name: plName, trackIds: p.trackIds })}>نام</button>
                <button type="button" className="text-rose-200" onClick={() => void act({ action: "playlist", id: p.id, name: p.name, delete: true })}>×</button>
              </span>
            ))}
          </div>
        ) : null}
        {prefs?.recentlyPlayed?.length ? (
          <p className="text-[11px] opacity-60">Recently Played: {prefs.recentlyPlayed.slice(0, 5).map((r) => r.title ?? r.id).join(" · ")}</p>
        ) : null}
        <ul className="space-y-1">
          {filtered.map((t) => (
            <li key={`${t.catalog}-${t.id}`} className={`flex items-center gap-2 rounded-2xl bg-white/5 px-3 py-2 ${selected.includes(t.id) ? "ring-1 ring-amber-300" : ""}`}>
              <input type="checkbox" checked={selected.includes(t.id)} onChange={() => setSelected((s) => s.includes(t.id) ? s.filter((x) => x !== t.id) : [...s, t.id])} disabled={t.catalog} />
              <button type="button" className="min-w-0 flex-1 text-right" onClick={() => music.play(t, queueOf())} onDoubleClick={() => setDetail(t)}>
                <p className="truncate text-sm">{t.title}</p>
                <p className="truncate text-[11px] opacity-55">{t.artist} · {t.album} · {t.format} {t.licensed ? "· مجاز نیکسو" : ""}</p>
              </button>
              {!t.catalog && (
                <button type="button" className="text-xs" onClick={() => void act({ action: "favorite", id: t.id })}>{t.favorite ? "♥" : "♡"}</button>
              )}
              <button type="button" className="text-[11px]" onClick={() => music.enqueue(t)}>+Q</button>
            </li>
          ))}
        </ul>
        {filtered.length === 0 && <p className="text-sm opacity-50">صوتی در این فیلتر نیست.</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={!selected.length} onClick={() => void act({ action: "delete", ids: selected })}>حذف</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => void act({ action: "clear-cache" })}>Clear Cache</Button>
        </div>
        <Link href="/app" className="text-sm text-amber-200">بازگشت</Link>
      </div>
      {detail && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" onClick={() => setDetail(null)}>
          <div className="w-full max-w-sm rounded-3xl bg-[#102824] p-4" onClick={(e) => e.stopPropagation()}>
            <p className="font-medium">{detail.title}</p>
            <p className="text-xs opacity-60">{detail.artist} · {detail.album}</p>
            <p className="mt-2 text-xs">مدت {Math.round((detail.durationMs || 0) / 1000)}s · {detail.format} · {formatBytes(detail.size ?? 0)} · {detail.kind}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" className="bg-amber-300 text-[#102824]" onClick={() => { music.play(detail, queueOf()); setDetail(null); }}>پخش</Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => void download(detail)}>Download</Button>
              <Button type="button" size="sm" variant="ghost" className="text-white" onClick={() => toast.message("ارسال از چت با دکمه نیکسو / فایل. محدودیت هدایت طبق سیاست صاحب است.")}>Share</Button>
              <Button type="button" size="sm" variant="ghost" className="text-white" onClick={() => void act({ action: "report", trackId: detail.catalog ? undefined : detail.id, catalogId: detail.catalog ? detail.id : undefined, reason: "copyright" })}>Report</Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
