"use client";

import { useEffect, useId, useState } from "react";
import { A11Y_SHORTCUTS } from "@/lib/a11y/shortcuts";
import { useA11y } from "@/components/a11y-provider";

export function ShortcutHelp() {
  const { prefs } = useA11y();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!prefs.keyboardShortcuts) return;
      if (e.key === "/" && e.altKey && e.shiftKey) {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape" && open) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, prefs.keyboardShortcuts]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/70 p-4" role="presentation" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="max-h-[80dvh] w-full max-w-md overflow-auto rounded-2xl bg-[#102824] p-5 text-emerald-50"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="text-lg font-semibold">
          میانبرهای صفحه‌کلید
        </h2>
        <p id={descId} className="mt-1 text-xs text-emerald-100/70">
          میانبرها با کلیدهای استاندارد مرورگر تداخل ندارند. در فیلد متن فقط Escape و Ctrl+Enter فعال‌اند.
        </p>
        <table className="mt-4 w-full text-start text-sm">
          <thead>
            <tr>
              <th scope="col" className="pb-2">
                میانبر
              </th>
              <th scope="col" className="pb-2">
                کار
              </th>
            </tr>
          </thead>
          <tbody>
            {A11Y_SHORTCUTS.map((s) => (
              <tr key={s.id}>
                <td className="py-1 font-mono text-amber-200">{s.combo}</td>
                <td className="py-1">{s.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="mt-4 min-h-11 rounded-lg bg-amber-300 px-4 text-sm text-[#102824]" onClick={() => setOpen(false)}>
          بستن
        </button>
      </div>
    </div>
  );
}
