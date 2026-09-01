"use client";

import { useEffect, useRef, type RefObject } from "react";

export function useFocusTrap(active: boolean, container: RefObject<HTMLElement | null>) {
  const last = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    last.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = container.current;
    const focusable = () =>
      root
        ? Array.from(
            root.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => !el.hasAttribute("aria-hidden") && el.tabIndex !== -1)
        : [];
    const first = focusable()[0];
    first?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") return;
      if (e.key !== "Tab" || !root) return;
      const items = focusable();
      if (!items.length) return;
      const head = items[0]!;
      const tail = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === head) {
        e.preventDefault();
        tail.focus();
      } else if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault();
        head.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      last.current?.focus();
    };
  }, [active, container]);
}

export function useEscape(active: boolean, onClose: () => void) {
  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, onClose]);
}
