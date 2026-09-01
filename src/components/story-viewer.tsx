"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { STORY_FILTERS, STORY_MUSIC } from "@/lib/story-types";

export type StoryItem = {
  id: string;
  ownerUserId: string;
  kind: "text" | "photo" | "video" | "gif" | "sticker" | "location";
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
    const dur = kind === "video" ? 8000 : 5000;
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
    <div className="flex gap-1 px-3 pt-3">
      {ids.map((id, i) => (
        <div key={id} className="h-1 flex-1 overflow-hidden rounded bg-white/20">
          <div
            className="h-full bg-amber-300"
            style={{ width: i < index ? "100%" : i === index ? `${progress * 100}%` : "0%" }}
          />
        </div>
      ))}
    </div>
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
  const [reply, setReply] = useState("");
  const [reportCat, setReportCat] = useState<(typeof REPORTS)[number]["id"]>("spam");
  const [viewers, setViewers] = useState<{ viewerName: string; viewedAt: number }[]>([]);
  const [analytics, setAnalytics] = useState<{ views: number; reach: number; reactions: number; replies: number; engagement: number } | null>(null);
  const hold = useRef(false);
  const swipe = useRef<number | null>(null);
  const story = items[index];
  const src = story?.mediaUrl || story?.media;
  const advance = useCallback(() => {
    setIndex((i) => {
      if (i + 1 >= items.length) {
        onClose();
        return i;
      }
      return i + 1;
    });
  }, [items.length, onClose]);

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

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black select-none">
      {items[index + 1]?.mediaUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={items[index + 1]!.mediaUrl} alt="" className="hidden" />
      ) : null}
      <StoryProgress
        key={story.id}
        kind={story.kind}
        paused={paused}
        hold={hold}
        index={index}
        ids={items.map((it) => it.id)}
        onAdvance={advance}
      />
      <div className="flex items-center justify-between px-4 py-2 text-sm text-white">
        <span>
          {ownerName}
          {story.viewed ? " · دیده شده" : " · ندیده"}
        </span>
        <button type="button" onClick={onClose}>
          خروج
        </button>
      </div>
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
            <video
              src={src}
              className="h-full w-full object-cover"
              autoPlay={!paused}
              muted={paused}
              playsInline
              style={{ filter: filterCss }}
            />
          )}
          {(story.kind === "text" || story.kind === "sticker" || story.kind === "location") && (
            <p
              className="grid h-full place-items-center px-8 leading-10 text-white"
              style={{ textAlign: story.align, fontSize: story.textSize ?? 24 }}
            >
              {story.kind === "location" ? `📍 ${story.location || story.body}` : story.body}
            </p>
          )}
          {story.overlay && (
            <p className="pointer-events-none absolute text-center text-5xl" style={{ left: `${story.textX ?? 50}%`, top: `${story.textY ?? 33}%`, transform: "translate(-50%, -50%)" }}>
              {story.overlay}
            </p>
          )}
          {(story.stickers ?? []).map((s, i) => (
            <span key={i} className="pointer-events-none absolute text-4xl" style={{ left: `${s.x}%`, top: `${s.y}%` }}>
              {s.emoji}
            </span>
          ))}
        </div>
      </div>
      <div
        className="space-y-2 bg-black/70 p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] text-white"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {story.caption && <p className="text-sm">{story.caption}</p>}
        {music && <p className="text-[11px] text-amber-200">♪ {music.label} · منبع مجاز نیکسو</p>}
        {story.linkUrl && (
          <a href={story.linkUrl} className="block text-xs text-sky-200 underline" target="_blank" rel="noreferrer">
            {story.linkUrl}
          </a>
        )}
        <div className="flex gap-2 text-lg">
          {REACTS.map((e) => (
            <button
              key={e}
              type="button"
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
        {!isOwner && story.allowReplies !== false && (
          <form
            className="flex gap-2"
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
            <Input value={reply} onChange={(e) => setReply(e.target.value)} placeholder="پاسخ خصوصی به استوری" className="h-9 bg-white/10" />
            <Button type="submit" size="sm" className="bg-amber-300 text-[#102824]">
              ارسال
            </Button>
          </form>
        )}
        {story.allowShare && (
          <button
            type="button"
            className="text-[11px] text-emerald-100/70"
            onClick={() => {
              void navigator.clipboard.writeText(`استوری ${ownerName}`);
              toast.message("اشتراک طبق اجازهٔ صاحب استوری. در این نسخه لینک محلی کپی می‌شود.");
            }}
          >
            اشتراک
          </button>
        )}
        {!isOwner && authorId && onMute && !authorId.startsWith("channel:") && (
          <button type="button" className="block text-[11px] text-emerald-100/70" onClick={() => onMute(!muted)}>
            {muted ? "Unmute استوری" : "Mute استوری این کاربر"}
          </button>
        )}
        {!isOwner && authorId && !authorId.startsWith("channel:") && (
          <button
            type="button"
            className="block text-[11px] text-rose-200"
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
            Block
          </button>
        )}
        {!isOwner && (
          <div className="flex items-center gap-2">
            <select
              className="rounded bg-white/10 px-2 py-1 text-[11px]"
              value={reportCat}
              onChange={(e) => setReportCat(e.target.value as typeof reportCat)}
            >
              {REPORTS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="text-[11px] text-rose-200"
              onClick={async () => {
                await fetch("/api/reports", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ targetKind: "story", targetKey: story.id, category: reportCat === "illegal" ? "other" : reportCat === "scam" ? "abuse" : reportCat }),
                });
                toast.message("گزارش ثبت شد.");
              }}
            >
              گزارش
            </button>
          </div>
        )}
        {isOwner && (
          <>
            {analytics && (
              <p className="text-[11px] text-emerald-100/70">
                آمار: {analytics.views} بازدید · {analytics.reach} reach · {analytics.reactions} واکنش · {analytics.replies} پاسخ · engagement {analytics.engagement}
              </p>
            )}
            <p className="text-[11px] text-emerald-100/70">
              بینندگان:{" "}
              {viewers.map((v) => `${v.viewerName} · ${new Date(v.viewedAt).toLocaleTimeString("fa-IR")}`).join("، ") ||
                "هنوز کسی ندیده"}
            </p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={async () => {
                if (!confirm("استوری حذف شود؟")) return;
                await fetch(`/api/stories/${story.id}`, { method: "DELETE" });
                onDeleted?.();
                onClose();
              }}
            >
              حذف استوری
            </Button>
            <p className="text-[10px] text-emerald-100/45">استوری منتشرشده ویرایش نمی‌شود. حذف کن و یکی جدید بساز.</p>
          </>
        )}
        <p className="text-[10px] text-emerald-100/40">
          نیکسو ادعا نمی‌کند عکس از صفحه با دستگاه دیگر را ۱۰۰٪ متوقف کند. در سیستم‌عامل‌هایی که اجازه بدهند، محدودیت‌های صفحه اعمال می‌شود.
        </p>
      </div>
    </div>
  );
}
