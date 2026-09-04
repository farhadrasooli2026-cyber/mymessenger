"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AD_TOPICS, defaultAdPrefs, readAdPrefs, writeAdPrefs, type NixoAdPrefs } from "@/lib/ad-prefs";
import { cn } from "@/lib/utils";

export function AdPrefsDesk({ onClose }: { onClose?: () => void }) {
  const [prefs, setPrefs] = useState<NixoAdPrefs>(defaultAdPrefs());

  useEffect(() => {
    setPrefs(readAdPrefs());
  }, []);

  function save(next: NixoAdPrefs) {
    setPrefs(next);
    writeAdPrefs(next);
    toast.success("Ad preferences saved on this device.");
  }

  return (
    <div className={onClose ? "fixed inset-0 z-50 grid place-items-end bg-black/70 p-4 sm:place-items-center" : "p-5"} onClick={onClose}>
      <div
        className={cn("w-full max-w-md rounded-3xl bg-[#102824] p-5 text-emerald-50", !onClose && "mx-auto")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-amber-200">Ad preferences</p>
            <h2 className="text-lg font-semibold">How NIXO shows ads</h2>
            <p className="mt-1 text-[12px] text-emerald-100/55">
              Ads never read private chat ciphertext. Choices stay on this device until you sign in on another browser.
            </p>
          </div>
          {onClose && (
            <Button type="button" variant="ghost" className="text-white" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
        <label className="mt-4 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={prefs.personalized}
            onChange={(e) => save({ ...prefs, personalized: e.target.checked })}
          />
          <span>
            <span className="block font-medium">Personalized ads</span>
            <span className="text-[12px] text-emerald-100/50">Use public profile topics, not private messages.</span>
          </span>
        </label>
        <label className="mt-3 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={prefs.activityBased}
            onChange={(e) => save({ ...prefs, activityBased: e.target.checked })}
          />
          <span>
            <span className="block font-medium">Activity-based ads</span>
            <span className="text-[12px] text-emerald-100/50">Public channel follows and Explore taps only.</span>
          </span>
        </label>
        <p className="mt-4 text-xs text-emerald-100/60">Topics you are willing to see</p>
        <div className="mt-2 flex flex-wrap gap-1">
          {AD_TOPICS.map((t) => {
            const on = prefs.topics.includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                className={cn("rounded-full px-3 py-1 text-xs", on ? "bg-amber-300 text-[#102824]" : "bg-white/10")}
                onClick={() =>
                  save({
                    ...prefs,
                    topics: on ? prefs.topics.filter((id) => id !== t.id) : [...prefs.topics, t.id],
                  })
                }
              >
                {t.en} · {t.fa}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
