"use client";

import { useCallback, useEffect, useState } from "react";
import { Camera, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { HeaderOverflowButton, NixoAiHeaderButton, OverflowRow } from "@/components/nixo-header-tools";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatRecentCallWhen } from "@/lib/call-copy";
import { publicAvatarFor } from "@/lib/public-assets";
import { AdPrefsDesk } from "@/components/ad-prefs-desk";
import type { StoryItem } from "@/components/story-viewer";

export type UpdatesStoryRing = {
  ownerId: string;
  name: string;
  username: string | null;
  muted: boolean;
  viewedAll: boolean;
  status: { preset: string; text: string } | null;
  items: StoryItem[];
};

export type UpdatesChannel = {
  id: string;
  name: string;
  username: string | null;
  color: string;
  photoDataUrl?: string | null;
  lastPreview?: string;
  lastPostAt?: number;
  unreadCount?: number;
  myRole?: string | null;
  subscribed?: boolean;
  description?: string;
};

type DiscoverChannel = {
  id: string;
  name: string;
  username: string | null;
  color: string;
  subscriberCount: number;
  verified?: boolean;
  subscribed?: boolean;
};

function previewOf(ring: UpdatesStoryRing) {
  const last = ring.items.at(-1);
  if (!last) return { bg: "#134e4a", src: "", text: "Status" };
  const src = last.mediaUrl || last.media || "";
  return { bg: last.bg || "#134e4a", src, text: last.body || last.caption || ring.name };
}

export function UpdatesDesk({
  userId,
  rings,
  onAddStatus,
  onCamera,
  onTextStatus,
  onOpenRing,
  onOpenChannel,
  onCreateChannel,
}: {
  userId: string;
  rings: UpdatesStoryRing[];
  onAddStatus: () => void;
  onCamera: () => void;
  onTextStatus: () => void;
  onOpenRing: (ring: UpdatesStoryRing) => void;
  onOpenChannel: (id: string) => void;
  onCreateChannel: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [channels, setChannels] = useState<UpdatesChannel[] | null>(null);
  const [err, setErr] = useState("");
  const [explore, setExplore] = useState(false);
  const [discover, setDiscover] = useState<DiscoverChannel[] | null>(null);
  const [q, setQ] = useState("");
  const [privacy, setPrivacy] = useState(false);
  const [ads, setAds] = useState(false);

  const loadChannels = useCallback(async () => {
    const res = await fetch("/api/channels", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error ?? "Channels failed to load.");
      setChannels([]);
      return;
    }
    setErr("");
    setChannels(data.channels ?? []);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void loadChannels(), 0);
    return () => window.clearTimeout(t);
  }, [loadChannels]);

  async function loadExplore(query = "") {
    const url = query.trim().length >= 2 ? `/api/channels?q=${encodeURIComponent(query.trim())}` : "/api/channels?mode=discovery";
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Explore failed.");
      setDiscover([]);
      return;
    }
    setDiscover(data.channels ?? []);
  }

  async function follow(id: string) {
    const res = await fetch(`/api/channels/${id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "subscribe" }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? "Could not follow.");
      return;
    }
    toast.success("Following channel.");
    await loadExplore(q);
    await loadChannels();
  }

  function togglePick(id: string) {
    setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  }

  async function unsubscribePicked() {
    if (!picked.length) return;
    for (const id of picked) {
      const res = await fetch(`/api/channels/${id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unsubscribe" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Unsubscribe failed.");
      }
    }
    toast.success("Selected channels updated.");
    setPicked([]);
    setSelecting(false);
    await loadChannels();
  }

  async function deletePicked() {
    if (!picked.length) return;
    for (const id of picked) {
      const ch = channels?.find((c) => c.id === id);
      if (ch?.myRole !== "owner") {
        toast.error(`${ch?.name ?? "Channel"} can only be deleted by its owner.`);
        continue;
      }
      const res = await fetch(`/api/channels/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Delete failed.");
      }
    }
    setPicked([]);
    setSelecting(false);
    await loadChannels();
  }

  async function readAll() {
    setMenu(false);
    const res = await fetch("/api/inbox", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read-all" }),
    });
    if (!res.ok) toast.error("Read All failed.");
    else toast.success("All updates marked as read.");
    await loadChannels();
  }

  const mine = rings.find((r) => r.ownerId === userId);
  const others = rings.filter((r) => r.ownerId !== userId);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#071614] text-emerald-50" dir="ltr">
      <header className="flex items-center justify-between px-4 pb-1 pt-4">
        <div className="flex items-center gap-0.5">
          <HeaderOverflowButton open={menu} onToggle={() => setMenu((v) => !v)}>
            <OverflowRow
              onClick={() => {
                setSelecting(true);
                setMenu(false);
                setPicked([]);
              }}
            >
              Select
            </OverflowRow>
            <OverflowRow onClick={() => void readAll()}>Read All</OverflowRow>
            <OverflowRow
              onClick={() => {
                setMenu(false);
                onCreateChannel();
              }}
            >
              Create channel
            </OverflowRow>
            <OverflowRow
              onClick={() => {
                setMenu(false);
                setPrivacy(true);
              }}
            >
              Status privacy
            </OverflowRow>
            <OverflowRow
              onClick={() => {
                setMenu(false);
                setAds(true);
              }}
            >
              Ad preferences
            </OverflowRow>
          </HeaderOverflowButton>
          <NixoAiHeaderButton />
        </div>
        <h1 className="text-[28px] font-semibold tracking-tight">Updates</h1>
        <span className="w-10" />
      </header>

      {selecting && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-2xl bg-white/5 px-3 py-2 text-xs">
          <span className="flex-1">{picked.length} selected</span>
          <Button type="button" size="sm" variant="secondary" onClick={() => void unsubscribePicked()} disabled={!picked.length}>
            Unfollow
          </Button>
          <Button type="button" size="sm" variant="destructive" onClick={() => void deletePicked()} disabled={!picked.length}>
            Delete
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-white"
            onClick={() => {
              setSelecting(false);
              setPicked([]);
            }}
          >
            Cancel
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto pb-8">
        <section className="px-4 pt-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Status</h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="grid size-10 place-items-center rounded-full hover:bg-white/10"
                aria-label="Camera"
                onClick={onCamera}
              >
                <Camera className="size-5" />
              </button>
              <button
                type="button"
                className="grid size-10 place-items-center rounded-full hover:bg-white/10"
                aria-label="Text status"
                onClick={onTextStatus}
              >
                <Pencil className="size-5" />
              </button>
            </div>
          </div>
          <div className="-mx-4 mt-3 flex gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button type="button" className="w-[92px] shrink-0 text-left" onClick={onAddStatus}>
              <div className="relative h-[140px] overflow-hidden rounded-2xl bg-[#16332f]">
                <div className="grid h-full place-items-center text-emerald-100/40">
                  <Plus className="size-8" />
                </div>
                <span className="absolute bottom-2 start-2 grid size-7 place-items-center rounded-full bg-[#25d366] text-[#071614]">
                  <Plus className="size-4" />
                </span>
              </div>
              <p className="mt-1.5 truncate text-[12px] text-emerald-50">Add status</p>
            </button>
            {mine && mine.items.length > 0 && <StatusCard ring={mine} label="My status" onOpen={() => onOpenRing(mine)} />}
            {others.map((ring) => (
              <StatusCard key={ring.ownerId} ring={ring} label={ring.name} onOpen={() => onOpenRing(ring)} />
            ))}
            {rings.length === 0 && (
              <p className="self-center text-[12px] text-emerald-100/45">No contact statuses yet. Add yours from the camera or pencil.</p>
            )}
          </div>
        </section>

        <section className="mt-4 px-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Channels</h2>
            <button
              type="button"
              className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-emerald-50"
              onClick={() => {
                setExplore(true);
                void loadExplore();
              }}
            >
              Explore
            </button>
          </div>
          {err && <p className="mt-3 text-sm text-rose-200">{err}</p>}
          {channels === null && <p className="mt-4 text-sm text-emerald-100/50">Loading channels…</p>}
          {channels && channels.length === 0 && !err && (
            <div className="mt-4 rounded-2xl bg-white/5 p-4 text-sm text-emerald-100/70">
              <p>You are not following any channels yet.</p>
              <button
                type="button"
                className="mt-2 text-amber-200"
                onClick={() => {
                  setExplore(true);
                  void loadExplore();
                }}
              >
                Find public channels
              </button>
            </div>
          )}
          <ul className="mt-2">
            {(channels ?? []).map((ch) => {
              const unread = ch.unreadCount ?? 0;
              const selected = picked.includes(ch.id);
              return (
                <li key={ch.id}>
                  <button
                    type="button"
                    className={cn("flex w-full items-center gap-3 rounded-xl px-1 py-2.5 text-left hover:bg-white/5", selected && "bg-white/10")}
                    onClick={() => {
                      if (selecting) togglePick(ch.id);
                      else onOpenChannel(ch.id);
                    }}
                  >
                    {selecting && (
                      <span className={cn("grid size-5 place-items-center rounded-full border border-white/40", selected && "bg-[#25d366] border-[#25d366] text-[#071614]")}>
                        {selected ? "✓" : ""}
                      </span>
                    )}
                    <span
                      className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-full text-sm font-semibold text-[#071614]"
                      style={{ background: ch.color || "#34d399" }}
                    >
                      {ch.photoDataUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={ch.photoDataUrl} alt="" className="size-12 object-cover" />
                      ) : (
                        ch.name.slice(0, 1)
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={cn("truncate text-[15px]", unread > 0 && "font-semibold")}>{ch.name}</span>
                        <span className="shrink-0 text-[11px] text-emerald-100/45">
                          {ch.lastPostAt ? formatRecentCallWhen(ch.lastPostAt) : ""}
                        </span>
                      </span>
                      <span className="mt-0.5 line-clamp-1 text-[13px] text-emerald-100/55">
                        {ch.lastPreview || ch.description || (ch.username ? `@${ch.username}` : "No posts yet")}
                      </span>
                    </span>
                    {unread > 0 && !selecting && (
                      <span className="grid min-w-5 place-items-center rounded-full bg-[#25d366] px-1.5 text-[11px] font-semibold text-[#071614]">
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {explore && (
        <div className="fixed inset-0 z-40 bg-black/75 p-4" onClick={() => setExplore(false)}>
          <div className="mx-auto max-h-[90dvh] max-w-md overflow-auto rounded-3xl bg-[#102824] p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Explore channels</h3>
              <Button type="button" variant="ghost" className="text-white" onClick={() => setExplore(false)}>
                Close
              </Button>
            </div>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search public channels"
              className="mt-3 bg-black/20"
              onKeyDown={(e) => {
                if (e.key === "Enter") void loadExplore(q);
              }}
            />
            <Button type="button" className="mt-2 w-full bg-amber-300 text-[#102824]" onClick={() => void loadExplore(q)}>
              Search
            </Button>
            {discover === null && <p className="mt-3 text-sm text-emerald-100/50">Loading…</p>}
            <ul className="mt-3 space-y-1">
              {(discover ?? []).map((c) => (
                <li key={c.id} className="flex items-center gap-3 rounded-xl px-1 py-2">
                  <span className="grid size-11 place-items-center rounded-full text-sm font-semibold text-[#071614]" style={{ background: c.color }}>
                    {c.name.slice(0, 1)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {c.name} {c.verified ? "✓" : ""}
                    </span>
                    <span className="text-[12px] text-emerald-100/50">
                      {c.username ? `@${c.username}` : ""} · {c.subscriberCount} followers
                    </span>
                  </span>
                  <Button type="button" size="sm" variant="secondary" onClick={() => void follow(c.id)}>
                    Follow
                  </Button>
                </li>
              ))}
            </ul>
            {discover && discover.length === 0 && <p className="mt-3 text-sm text-emerald-100/50">No public channels match.</p>}
          </div>
        </div>
      )}

      {privacy && <StatusPrivacySheet onClose={() => setPrivacy(false)} />}
      {ads && (
        <div className="contents" onClick={() => setAds(false)}>
          <AdPrefsDesk onClose={() => setAds(false)} />
        </div>
      )}
    </div>
  );
}

function StatusCard({ ring, label, onOpen }: { ring: UpdatesStoryRing; label: string; onOpen: () => void }) {
  const preview = previewOf(ring);
  const unseen = !ring.viewedAll;
  return (
    <button type="button" className="w-[92px] shrink-0 text-left" onClick={onOpen}>
      <div
        className={cn("relative h-[140px] overflow-hidden rounded-2xl ring-2", unseen ? "ring-[#25d366]" : "ring-white/20")}
        style={{ background: preview.bg }}
      >
        {preview.src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.src} alt="" className="h-full w-full object-cover" />
        ) : (
          <p className="grid h-full place-items-center px-2 text-center text-[11px] leading-4">{preview.text}</p>
        )}
        <span
          className={cn(
            "absolute bottom-2 start-2 size-8 overflow-hidden rounded-full bg-[#16332f] ring-2",
            unseen ? "ring-[#25d366]" : "ring-white/30",
          )}
        >
          <span className="grid size-8 place-items-center overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={publicAvatarFor(ring.ownerId || ring.name)} alt="" className="size-8 object-cover" />
          </span>
        </span>
      </div>
      <p className="mt-1.5 truncate text-[12px]">{label}</p>
    </button>
  );
}

function StatusPrivacySheet({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<"everyone" | "exceptions" | "selected">("everyone");
  const [people, setPeople] = useState<{ id: string; name: string; username: string | null }[]>([]);
  const [hideFrom, setHideFrom] = useState<string[]>([]);
  const [allow, setAllow] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/stories?settings=1", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const s = d.settings;
        if (!s) return;
        setPeople(s.people ?? []);
        setHideFrom(s.defaultHideFromIds ?? []);
        setAllow(s.statusAllowIds ?? s.closeFriendIds ?? []);
        if ((s.defaultHideFromIds ?? []).length) setMode("exceptions");
        else if (s.defaultStoryPrivacy === "selected" || s.defaultStoryPrivacy === "closeFriends") setMode("selected");
        else setMode("everyone");
      })
      .catch(() => undefined);
  }, []);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "settings",
          defaultStoryPrivacy: mode === "selected" ? "selected" : "everyone",
          statusPrivacy: mode === "selected" ? "selected" : "everyone",
          defaultHideFromIds: mode === "exceptions" ? hideFrom : [],
          statusAllowIds: mode === "selected" ? allow : [],
          closeFriendIds: mode === "selected" ? allow : undefined,
        }),
      });
      if (!res.ok) toast.error("Could not save status privacy.");
      else {
        toast.success("Status privacy updated.");
        onClose();
      }
    } finally {
      setBusy(false);
    }
  }

  function toggle(list: string[], id: string) {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/70 p-4 sm:place-items-center" onClick={onClose}>
      <div className="max-h-[90dvh] w-full max-w-md overflow-auto rounded-3xl bg-[#102824] p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold">Status privacy</h3>
        <p className="mt-1 text-[12px] text-emerald-100/55">Who can see your status updates. Stories still respect per-post privacy in the composer.</p>
        {(
          [
            ["everyone", "My contacts", "Everyone in your NIXO contacts can view status."],
            ["exceptions", "My contacts except…", "Hide status from selected people."],
            ["selected", "Only share with…", "Only the people you pick can view status."],
          ] as const
        ).map(([id, title, hint]) => (
          <label key={id} className="mt-3 flex items-start gap-3 text-sm">
            <input type="radio" name="status-privacy" checked={mode === id} onChange={() => setMode(id)} className="mt-1" />
            <span>
              <span className="block font-medium">{title}</span>
              <span className="text-[12px] text-emerald-100/50">{hint}</span>
            </span>
          </label>
        ))}
        {mode === "exceptions" && (
          <div className="mt-3 max-h-40 overflow-auto text-xs">
            {people.map((p) => (
              <label key={p.id} className="mt-1 flex items-center gap-2">
                <input type="checkbox" checked={hideFrom.includes(p.id)} onChange={() => setHideFrom(toggle(hideFrom, p.id))} />
                {p.name}
              </label>
            ))}
            {people.length === 0 && <p className="text-emerald-100/40">No other accounts in this environment yet.</p>}
          </div>
        )}
        {mode === "selected" && (
          <div className="mt-3 max-h-40 overflow-auto text-xs">
            {people.map((p) => (
              <label key={p.id} className="mt-1 flex items-center gap-2">
                <input type="checkbox" checked={allow.includes(p.id)} onChange={() => setAllow(toggle(allow, p.id))} />
                {p.name}
              </label>
            ))}
            {people.length === 0 && <p className="text-emerald-100/40">No other accounts in this environment yet.</p>}
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <Button type="button" variant="ghost" className="flex-1 text-white" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" className="flex-1 bg-amber-300 text-[#102824]" disabled={busy} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
