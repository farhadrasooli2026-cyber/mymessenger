"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal, Pause, Play, Share2, Trash2, Volume2, VolumeX, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { STORY_FILTERS, STORY_MUSIC } from "@/lib/story-types";
import { cn } from "@/lib/utils";

export type StoryItem = {
  id: string;
  ownerUserId: string;
  kind: "text" | "photo" | "video" | "audio" | "gif" | "sticker" | "location";
  body: string;
  caption: string;
  bg: string;
  font: string;
  align: "right" | "center" | "left";
  filter: string;
  rotate: number;
  zoom: number;
  overlay: string;
  textSize?: number;
  textX?: number;
  textY?: number;
  blur?: number;
  drawData?: string;
  stickers?: { emoji: string; x: number; y: number }[];
  location?: string;
  media: string;
  mediaUrl?: string;
  musicId: string | null;
  linkUrl: string;
  allowShare: boolean;
  allowReplies?: boolean;
  allowReactions?: boolean;
  shareUrl?: string;
  createdAt: number;
  expiresAt: number;
  expired?: boolean;
  viewed?: boolean;
  cropX?: number;
  cropY?: number;
  processStatus?: string;
};

const REACTS = ["❤️", "👍", "😂", "😮", "😢", "🔥"];
const REPORTS = [
  { id: "spam", label: "هرزنامه" },
  { id: "scam", label: "کلاهبرداری" },
  { id: "harassment", label: "آزار" },
  { id: "illegal", label: "محتوای غیرقانونی" },
  { id: "other", label: "سایر" },
] as const;

function StoryProgress({
  kind,
  paused,
  hold,
  index,
  ids,
  onAdvance,
}: {
  kind: StoryItem["kind"];
  paused: boolean;
  hold: { current: boolean };
  index: number;
  ids: string[];
  onAdvance: () => void;
}) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (paused) return;
    let elapsed = 0;
    let last = Date.now();
    const dur = kind === "video" || kind === "audio" ? 8000 : 5000;
    const t = window.setInterval(() => {
      const now = Date.now();
      if (!hold.current) elapsed += now - last;
      last = now;
      const p = Math.min(1, elapsed / dur);
      setProgress(p);
      if (p >= 1) {
        window.clearInterval(t);
        onAdvance();
      }
    }, 50);
    return () => window.clearInterval(t);
  }, [paused, kind, hold, onAdvance]);
  return (
    <div className="flex gap-1">
      {ids.map((id, i) => (
        <div key={id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/25">
          <div
            className="h-full bg-white"
            style={{ width: i < index ? "100%" : i === index ? `${progress * 100}%` : "0%" }}
          />
        </div>
      ))}
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid size-10 place-items-center rounded-full bg-black/35 text-white backdrop-blur-sm"
    >
      {children}
    </button>
  );
}

export function StoryViewer({
  items,
  ownerName,
  isOwner,
  startIndex,
  muted,
  authorId,
  onMute,
  onClose,
  onDeleted,
}: {
  items: StoryItem[];
  ownerName: string;
  isOwner: boolean;
  startIndex?: number;
  muted?: boolean;
  authorId?: string;
  onMute?: (muted: boolean) => void;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const [index, setIndex] = useState(startIndex ?? 0);
  const [paused, setPaused] = useState(false);
  const [mediaMuted, setMediaMuted] = useState(false);
  const [reply, setReply] = useState("");
  const [reportCat, setReportCat] = useState<(typeof REPORTS)[number]["id"]>("spam");
  const [moreOpen, setMoreOpen] = useState(false);
  const [viewers, setViewers] = useState<{ viewerName: string; viewedAt: number }[]>([]);
  const [analytics, setAnalytics] = useState<{
    views: number;
    reach: number;
    reactions: number;
    replies: number;
    engagement: number;
    completionRate?: number;
  } | null>(null);
  const hold = useRef(false);
  const swipe = useRef<number | null>(null);
  const story = items[index];
  const src = story?.mediaUrl || story?.media;
  const advance = useCallback(() => {
    if (story && !story.ownerUserId.startsWith("channel:")) {
      void fetch(`/api/stories/${story.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "view", completed: true }),
      }).catch(() => undefined);
    }
    setIndex((i) => {
      if (i + 1 >= items.length) {
        onClose();
        return i;
      }
      return i + 1;
    });
  }, [items.length, onClose, story]);

  useEffect(() => {
    if (!story) return;
    if (story.ownerUserId.startsWith("channel:")) return;
    fetch(`/api/stories/${story.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "view" }),
    }).catch(() => undefined);
    if (isOwner) {
      fetch(`/api/stories/${story.id}`)
        .then((r) => r.json())
        .then((d) => {
          setViewers(d.viewers ?? []);
          setAnalytics(d.analytics ?? null);
        })
        .catch(() => undefined);
    }
  }, [story, isOwner]);

  if (!story) return null;
  const filterCss = STORY_FILTERS.find((f) => f.id === story.filter)?.css ?? "none";
  const music = STORY_MUSIC.find((m) => m.id === story.musicId);
  const overlaySize = Math.min(36, Math.max(16, story.textSize ?? 22));

  async function copyShare() {
    const link = story.shareUrl ? `${window.location.origin}${story.shareUrl}` : `${window.location.origin}/app?story=${story.id}`;
    void navigator.clipboard.writeText(link);
    toast.message("لینک با توکن امن کپی شد. باز کردن لینک حریم استوری را دور نمی‌زند.");
  }

  return (
    <div className="fixed inset-0 z-50 bg-black">
      {items[index + 1]?.mediaUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={items[index + 1]!.mediaUrl} alt="" className="hidden" />
      ) : null}

      <div className="mx-auto flex h-[100dvh] w-full max-w-[430px] flex-col">
        <div
          className="relative min-h-0 flex-1"
          onPointerDown={(e) => {
            hold.current = true;
            setPaused(true);
            swipe.current = e.clientX;
          }}
          onPointerUp={(e) => {
            hold.current = false;
            setPaused(false);
            if (swipe.current != null) {
              const dx = e.clientX - swipe.current;
              if (dx > 60) setIndex((i) => Math.max(0, i - 1));
              else if (dx < -60) {
                if (index + 1 >= items.length) onClose();
                else setIndex((i) => i + 1);
              }
            }
            swipe.current = null;
          }}
          onClick={(e) => {
            const x = e.clientX / window.innerWidth;
            if (x < 0.3) setIndex((i) => Math.max(0, i - 1));
            else if (x > 0.7) {
              if (index + 1 >= items.length) onClose();
              else setIndex((i) => i + 1);
            }
          }}
        >
          <div className="absolute inset-0 mx-auto aspect-[9/16] max-h-full w-full overflow-hidden bg-zinc-950 sm:rounded-none">
            <div className="absolute inset-0" style={{ background: story.bg }}>
              {(story.kind === "photo" || story.kind === "gif") && src && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt=""
                  className="h-full w-full object-cover"
                  style={{
                    filter: `${filterCss} blur(${story.blur ?? 0}px)`,
                    transform: `rotate(${story.rotate}deg) scale(${story.zoom})`,
                    objectPosition: `${story.cropX ?? 50}% ${story.cropY ?? 50}%`,
                  }}
                />
              )}
              {story.kind === "video" && src && (
                <video src={src} className="h-full w-full object-cover" autoPlay={!paused} muted={mediaMuted} playsInline style={{ filter: filterCss }} />
              )}
              {story.kind === "audio" && src && (
                <div className="grid h-full place-items-center px-8">
                  <audio src={src} autoPlay={!paused} muted={mediaMuted} controls className="w-full" />
                </div>
              )}
              {(story.kind === "text" || story.kind === "sticker" || story.kind === "location") && (
                <p
                  className="grid h-full place-items-center px-8 leading-relaxed text-white"
                  style={{ textAlign: story.align, fontSize: overlaySize }}
                >
                  {story.kind === "location" ? `📍 ${story.location || story.body}` : story.body}
                </p>
              )}
              {story.overlay && (
                <p
                  className="pointer-events-none absolute max-w-[80%] text-center leading-snug text-white drop-shadow"
                  style={{
                    left: `${story.textX ?? 50}%`,
                    top: `${story.textY ?? 33}%`,
                    transform: "translate(-50%, -50%)",
                    fontSize: overlaySize,
                  }}
                >
                  {story.overlay}
                </p>
              )}
              {(story.stickers ?? []).map((s, i) => (
                <span key={i} className="pointer-events-none absolute text-4xl" style={{ left: `${s.x}%`, top: `${s.y}%` }}>
                  {s.emoji}
                </span>
              ))}
            </div>
            <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/70 to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-black/75 to-transparent" />
          </div>

          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 px-3 pt-[max(0.6rem,env(safe-area-inset-top))]">
            <div className="pointer-events-auto">
              <StoryProgress key={story.id} kind={story.kind} paused={paused} hold={hold} index={index} ids={items.map((it) => it.id)} onAdvance={advance} />
              <div className="mt-3 flex items-center gap-2 text-white">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{ownerName}</p>
                  <p className="text-[11px] text-white/60">{story.viewed ? "دیده شده" : "جدید"}</p>
                </div>
                {(story.kind === "video" || story.kind === "audio") && (
                  <IconBtn label={mediaMuted ? "صدا روشن" : "بی‌صدا"} onClick={() => setMediaMuted((m) => !m)}>
                    {mediaMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
                  </IconBtn>
                )}
                <IconBtn label={paused ? "ادامه" : "توقف"} onClick={() => setPaused((p) => !p)}>
                  {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
                </IconBtn>
                <IconBtn label="خروج" onClick={onClose}>
                  <X className="size-4" />
                </IconBtn>
              </div>
            </div>
          </div>

          {(story.caption || music) && (
            <div className="pointer-events-none absolute inset-x-0 bottom-[7.5rem] z-10 px-4">
              {story.caption && <p className="text-[15px] leading-6 text-white drop-shadow">{story.caption}</p>}
              {music && <p className="mt-1 text-[11px] text-amber-200/90">♪ {music.label}</p>}
              {story.linkUrl && (
                <a href={story.linkUrl} className="pointer-events-auto mt-1 block truncate text-xs text-sky-200 underline" target="_blank" rel="noreferrer">
                  {story.linkUrl}
                </a>
              )}
            </div>
          )}
        </div>

        <div
          className="z-20 shrink-0 space-y-2 bg-black px-3 pb-[max(0.85rem,env(safe-area-inset-bottom))] pt-2 text-white"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {story.allowReactions !== false && (
            <div className="flex items-center justify-center gap-1">
              {REACTS.map((e) => (
                <button
                  key={e}
                  type="button"
                  className="grid size-10 place-items-center rounded-full text-base"
                  onClick={() =>
                    void fetch(`/api/stories/${story.id}`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "react", emoji: e }),
                    }).then((r) => {
                      if (r.ok) toast.success("واکنش برای صاحب استوری ارسال شد.");
                    })
                  }
                >
                  {e}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            {!isOwner && story.allowReplies !== false ? (
              <form
                className="flex min-w-0 flex-1 gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void fetch(`/api/stories/${story.id}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "reply", body: reply }),
                  }).then((r) => {
                    if (r.ok) {
                      toast.success("پاسخ در صندوق استوری صاحب ثبت شد و اعلان گفتگو می‌آید. متن داخل پاکت E2EE چت تزریق نمی‌شود.");
                      setReply("");
                    }
                  });
                }}
              >
                <Input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="پاسخ…" className="h-10 rounded-full border-white/10 bg-white/8" />
                <Button type="submit" size="sm" className="h-10 rounded-full bg-amber-300 px-4 text-[#102824]">
                  ارسال
                </Button>
              </form>
            ) : (
              <div className="min-w-0 flex-1" />
            )}
            {story.allowShare && (
              <IconBtn label="اشتراک" onClick={() => void copyShare()}>
                <Share2 className="size-4" />
              </IconBtn>
            )}
            {isOwner && (
              <IconBtn
                label="حذف"
                onClick={async () => {
                  if (!confirm("استوری حذف شود؟")) return;
                  await fetch(`/api/stories/${story.id}`, { method: "DELETE" });
                  onDeleted?.();
                  onClose();
                }}
              >
                <Trash2 className="size-4" />
              </IconBtn>
            )}
            <IconBtn label="بیشتر" onClick={() => setMoreOpen((v) => !v)}>
              <MoreHorizontal className="size-4" />
            </IconBtn>
          </div>

          {moreOpen && (
            <div className="space-y-2 rounded-2xl bg-white/8 p-3 text-sm">
              {!isOwner && authorId && onMute && !authorId.startsWith("channel:") && (
                <button type="button" className="block w-full py-2 text-start" onClick={() => onMute(!muted)}>
                  {muted ? "نمایش استوری‌های این کاربر" : "بی‌صدا کردن استوری این کاربر"}
                </button>
              )}
              {!isOwner && authorId && !authorId.startsWith("channel:") && (
                <button
                  type="button"
                  className="block w-full py-2 text-start text-rose-200"
                  onClick={async () => {
                    await fetch("/api/privacy", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "block", peerKey: authorId, blocked: true }),
                    });
                    toast.message("حساب مسدود شد. استوری‌های بعدی دیده نمی‌شوند.");
                    onClose();
                  }}
                >
                  مسدود کردن
                </button>
              )}
              {!isOwner && (
                <div className="flex items-center gap-2 pt-1">
                  <select className="h-10 flex-1 rounded-xl bg-black/40 px-2 text-xs" value={reportCat} onChange={(e) => setReportCat(e.target.value as typeof reportCat)}>
                    {REPORTS.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="text-xs text-rose-200"
                    onClick={async () => {
                      await fetch("/api/reports", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          targetKind: "story",
                          targetKey: story.id,
                          category: reportCat === "illegal" ? "other" : reportCat === "scam" ? "abuse" : reportCat,
                        }),
                      });
                      toast.message("گزارش ثبت شد.");
                    }}
                  >
                    گزارش
                  </button>
                </div>
              )}
              {isOwner && analytics && (
                <p className={cn("text-[11px] leading-5 text-white/65")}>
                  {analytics.views} بازدید · {analytics.reach} reach · {analytics.reactions} واکنش · {analytics.replies} پاسخ
                  {typeof analytics.completionRate === "number" ? ` · تکمیل ${analytics.completionRate}٪` : ""}
                </p>
              )}
              {isOwner && (
                <p className="text-[11px] leading-5 text-white/55">
                  بینندگان: {viewers.map((v) => `${v.viewerName} · ${new Date(v.viewedAt).toLocaleTimeString("fa-IR")}`).join("، ") || "هنوز کسی ندیده"}
                </p>
              )}
              {isOwner && story.expired && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  onClick={async () => {
                    const res = await fetch(`/api/stories/${story.id}`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "restore" }),
                    });
                    if (res.ok) {
                      toast.success("استوری از آرشیو بازیابی شد و دوباره ۲۴ ساعت زنده است.");
                      onDeleted?.();
                    } else toast.error("بازیابی ممکن نشد.");
                  }}
                >
                  بازیابی از آرشیو
                </Button>
              )}
              <p className="text-[10px] leading-4 text-white/35">نیکسو ادعا نمی‌کند عکس از صفحه با دستگاه دیگر را ۱۰۰٪ متوقف کند.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
