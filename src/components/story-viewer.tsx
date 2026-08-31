"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { STORY_FILTERS, STORY_MUSIC } from "@/lib/story-types";

export type StoryItem = {
  id: string;
  ownerUserId: string;
  kind: "text" | "photo" | "video";
  body: string;
  caption: string;
  bg: string;
  font: string;
  align: "right" | "center" | "left";
  filter: string;
  rotate: number;
  zoom: number;
  overlay: string;
  media: string;
  musicId: string | null;
  linkUrl: string;
  allowShare: boolean;
  createdAt: number;
  expiresAt: number;
  expired?: boolean;
};

const REACTS = ["❤️", "👍", "😂", "😮", "😢", "🔥"];
const REPORTS = [
  { id: "spam", label: "هرزنامه" },
  { id: "abuse", label: "کلاهبرداری / سوءاستفاده" },
  { id: "harassment", label: "آزار" },
  { id: "fake", label: "جعلی" },
  { id: "other", label: "محتوای غیرقانونی / سایر" },
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
    const started = Date.now();
    const dur = kind === "video" ? 8000 : 5000;
    const t = window.setInterval(() => {
      if (hold.current) return;
      const p = Math.min(1, (Date.now() - started) / dur);
      setProgress(p);
      if (p >= 1) {
        setProgress(1);
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
  const hold = useRef(false);
  const story = items[index];
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
    fetch(`/api/stories/${story.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "view" }),
    }).catch(() => undefined);
    if (isOwner) {
      fetch(`/api/stories/${story.id}`)
        .then((r) => r.json())
        .then((d) => setViewers(d.viewers ?? []))
        .catch(() => undefined);
    }
  }, [story, isOwner]);

  if (!story) return null;
  const filterCss = STORY_FILTERS.find((f) => f.id === story.filter)?.css ?? "none";
  const music = STORY_MUSIC.find((m) => m.id === story.musicId);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black select-none">
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
        <span>{ownerName}</span>
        <button type="button" onClick={onClose}>
          خروج
        </button>
      </div>
      <div
        className="relative min-h-0 flex-1"
        onPointerDown={() => {
          hold.current = true;
          setPaused(true);
        }}
        onPointerUp={() => {
          hold.current = false;
          setPaused(false);
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
          {story.kind === "photo" && story.media && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={story.media}
              alt=""
              className="h-full w-full object-cover"
              style={{ filter: filterCss, transform: `rotate(${story.rotate}deg) scale(${story.zoom})` }}
            />
          )}
          {story.kind === "video" && story.media && (
            <video
              src={story.media}
              className="h-full w-full object-cover"
              autoPlay={!paused}
              muted={paused}
              playsInline
              style={{ filter: filterCss }}
            />
          )}
          {story.kind === "text" && (
            <p className="grid h-full place-items-center px-8 text-2xl leading-10 text-white" style={{ textAlign: story.align }}>
              {story.body}
            </p>
          )}
          {story.overlay && (
            <p className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-5xl">{story.overlay}</p>
          )}
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
        {!isOwner && (
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
                  toast.success("پاسخ برای صاحب استوری ثبت شد (صندوق استوری، نه کلید چت خصوصی).");
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
        {!isOwner && authorId && onMute && (
          <button type="button" className="block text-[11px] text-emerald-100/70" onClick={() => onMute(!muted)}>
            {muted ? "خروج از بی‌صدا" : "بی‌صدا کردن استوری این کاربر"}
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
                  body: JSON.stringify({ targetKind: "story", targetKey: story.id, category: reportCat }),
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
