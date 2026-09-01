import "server-only";
import { CALL_RECORDING_POLICY, listCalls } from "@/lib/calls";
import { appendCallEvent } from "@/lib/call-events";
import { callQualitySummary } from "@/lib/call-signal";
import { expireAbandonedGroupCalls, listGroupCalls } from "@/lib/group-calls";
import { iceHealth } from "@/lib/ice";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import { config } from "@/lib/config";

export type HistoryRow = {
  id: string;
  peerName: string;
  kind: string;
  direction: "in" | "out";
  status: string;
  createdAt: number;
  endedAt: number | null;
  durationMs: number;
  group?: boolean;
  participantCount?: number;
};

export async function sweepCallInfra() {
  return mutateStore((data) => {
    expireAbandonedGroupCalls(data);
    const now = Date.now();
    data.callSignals = (data.callSignals ?? []).filter((s) => now - s.createdAt < 10 * 60 * 1000).slice(-800);
    data.callQuality = (data.callQuality ?? []).filter((q) => now - q.at < 10 * 60 * 1000).slice(-400);
    data.callEvents = (data.callEvents ?? []).filter((e) => now - e.at < 7 * 24 * 60 * 60 * 1000).slice(-4000);
    return { ok: true as const };
  });
}

export async function searchCallHistory(
  userId: string,
  opts: { q?: string; filter?: string; cursor?: string; limit?: number },
) {
  const filter = opts.filter ?? "all";
  const q = (opts.q ?? "").trim().toLowerCase();
  const limit = Math.min(40, Math.max(1, opts.limit ?? 20));
  const cursorTs = opts.cursor ? Number(opts.cursor) : Number.POSITIVE_INFINITY;
  const ones = filter === "group" ? [] : await listCalls(userId, filter === "all" ? undefined : filter);
  const groups = filter && filter !== "all" && filter !== "group" && filter !== "incoming" && filter !== "outgoing" && filter !== "voice" && filter !== "video"
    ? []
    : await listGroupCalls(userId);
  let rows: HistoryRow[] = [
    ...ones.map((c) => ({
      id: c.id,
      peerName: c.peerName,
      kind: c.kind,
      direction: c.direction,
      status: c.status,
      createdAt: c.createdAt,
      endedAt: c.endedAt,
      durationMs: c.durationMs,
    })),
    ...groups
      .filter((g) => {
        if (filter === "incoming") return g.direction === "in";
        if (filter === "outgoing") return g.direction === "out";
        if (filter === "voice") return g.kind === "voice";
        if (filter === "video") return g.kind === "video";
        return true;
      })
      .map((g) => ({
        id: g.id,
        peerName: g.peerName,
        kind: g.kind,
        direction: g.direction,
        status: g.status,
        createdAt: g.createdAt,
        endedAt: g.endedAt,
        durationMs: g.durationMs,
        group: true,
        participantCount: g.participantCount,
      })),
  ];
  rows.sort((a, b) => b.createdAt - a.createdAt);
  if (Number.isFinite(cursorTs)) rows = rows.filter((r) => r.createdAt < cursorTs);
  if (q) rows = rows.filter((r) => r.peerName.toLowerCase().includes(q) || r.kind.includes(q) || r.status.includes(q));
  const page = rows.slice(0, limit);
  return {
    ok: true as const,
    calls: page,
    nextCursor: page.length === limit ? String(page[page.length - 1]?.createdAt ?? "") : null,
  };
}

export async function callCenterDashboard(userId: string) {
  await sweepCallInfra();
  const quality = await callQualitySummary(userId);
  const data = await readStoreSnapshot();
  const mine = (data.calls ?? []).filter((c) => c.ownerUserId === userId && !c.hiddenAt);
  const groups = (data.groupCalls ?? []).filter(
    (c) => c.participants.some((p) => p.userId === userId) && !(c.hiddenBy ?? []).includes(userId),
  );
  const durationMs = mine.reduce((s, c) => s + (c.durationMs ?? 0), 0);
  const failed = mine.filter((c) => c.endReason === "failed").length;
  const rooms = new Set(mine.map((c) => c.sessionId ?? c.id).concat(groups.map((g) => g.id)));
  const signals = (data.callSignals ?? []).filter((s) => rooms.has(s.callId));
  const events = (data.callEvents ?? []).filter((e) => e.userId === userId).slice(-24).reverse();
  return {
    ok: true as const,
    ice: iceHealth(),
    quality,
    counts: {
      total: mine.length + groups.length,
      missed: mine.filter((c) => c.status === "missed").length,
      failed,
      group: groups.length,
      live: mine.filter((c) => c.status === "ringing" || c.status === "active").length + groups.filter((g) => g.status !== "ended").length,
    },
    durationMs,
    failureRate: mine.length ? Math.round((failed / mine.length) * 100) : 0,
    video: {
      total: mine.filter((c) => c.kind === "video").length,
      fallbacks: (data.callEvents ?? []).filter((e) => e.userId === userId && e.kind === "voice_fallback").length,
      frozen: (data.callQuality ?? []).filter((q) => q.frozen && rooms.has(q.callId)).length,
    },
    signaling: { samples: signals.length, region: config.callRegion },
    recording: CALL_RECORDING_POLICY,
    events: events.map((e) => ({ kind: e.kind, at: e.at, callId: e.callId.slice(0, 8) })),
  };
}

export async function requestCallRecording(userId: string, callId: string) {
  return mutateStore((data) => {
    const mine = (data.calls ?? []).find((c) => c.id === callId && c.ownerUserId === userId);
    const group = (data.groupCalls ?? []).find((c) => c.id === callId && c.participants.some((p) => p.userId === userId));
    if (!mine && !group) return { ok: false as const, error: "تماس یافت نشد.", status: 404 as const };
    appendCallEvent(data, { userId, callId, kind: "recording_denied" });
    return { ok: false as const, error: CALL_RECORDING_POLICY, status: 403 as const };
  });
}
