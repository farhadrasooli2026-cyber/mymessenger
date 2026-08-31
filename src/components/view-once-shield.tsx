"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export function ViewOnceShield({
  active,
  threadId,
  messageId,
  className,
  children,
}: {
  active: boolean;
  threadId?: string;
  messageId?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const reported = useRef(false);

  useEffect(() => {
    if (!active || !threadId || !messageId) return;
    const notify = () => {
      if (reported.current) return;
      reported.current = true;
      void fetch(`/api/chats/${threadId}/messages/${messageId}/capture`, { method: "POST" });
    };
    const onVis = () => {
      if (document.hidden) notify();
    };
    const onCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      notify();
    };
    document.addEventListener("visibilitychange", onVis);
    document.addEventListener("copy", onCopy, true);
    window.addEventListener("blur", notify);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      document.removeEventListener("copy", onCopy, true);
      window.removeEventListener("blur", notify);
    };
  }, [active, threadId, messageId]);

  return (
    <div
      className={cn("select-none", className)}
      onContextMenu={active ? (e) => e.preventDefault() : undefined}
      onCopy={active ? (e) => e.preventDefault() : undefined}
      style={active ? { WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" } : undefined}
    >
      {children}
    </div>
  );
}
