import "server-only";
import { discoverGroups } from "@/lib/group-discovery";
import { listGroups } from "@/lib/groups";
import { listMyChannels, searchPublicChannels } from "@/lib/channels";
import { readStoreSnapshot } from "@/lib/store";

export async function spacesDashboard(userId: string) {
  const data = await readStoreSnapshot();
  const myGroups = data.groups.filter((g) => !g.deletedAt && g.members.some((m) => m.key === userId && !m.leftAt));
  const myChannels = data.pubChannels.filter(
    (c) =>
      !c.deletedAt &&
      (c.staff.some((s) => s.userId === userId) || c.subscribers.some((s) => s.userId === userId && !s.leftAt)),
  );
  const pendingGroup = myGroups.reduce(
    (n, g) => n + g.requests.filter((r) => r.status === "pending").length,
    0,
  );
  const pendingChannel = myChannels.reduce(
    (n, c) => n + (c.requests ?? []).filter((r) => r.status === "pending").length,
    0,
  );
  return {
    ok: true as const,
    groups: {
      mine: myGroups.length,
      owned: myGroups.filter((g) => g.ownerUserId === userId).length,
      public: data.groups.filter((g) => !g.deletedAt && g.joinMode === "open" && g.searchVisible !== false).length,
      pending: pendingGroup,
    },
    channels: {
      mine: myChannels.length,
      owned: myChannels.filter((c) => c.ownerUserId === userId).length,
      public: data.pubChannels.filter((c) => !c.deletedAt && c.visibility === "public" && c.status === "active").length,
      pending: pendingChannel,
    },
    note: "گروه و کانال خصوصی در Discovery نیستند. عضویت، دعوت، نقش و پیام سمت سرور کنترل می‌شود.",
  };
}

export async function searchSpaces(userId: string, opts: { q?: string; kind?: string; limit?: number }) {
  const q = (opts.q ?? "").trim();
  const kind = opts.kind ?? "all";
  const limit = Math.min(40, Math.max(1, opts.limit ?? 20));
  const publicGroups = kind === "channel" ? [] : await discoverGroups(userId, { q });
  const publicChannels = kind === "group" ? [] : q.length >= 2 ? await searchPublicChannels(q, userId) : [];
  const mineGroups = kind === "channel" ? [] : await listGroups(userId);
  const mineChannels = kind === "group" ? [] : await listMyChannels(userId);
  const needle = q.toLowerCase();
  const rows = [
    ...publicGroups.map((g) => ({
      id: g.id,
      kind: "group" as const,
      name: g.name,
      username: g.username,
      visibility: "public" as const,
      count: g.memberCount,
      mine: g.joined,
    })),
    ...mineGroups
      .filter((g) => !needle || g.name.toLowerCase().includes(needle) || (g.username ?? "").includes(needle))
      .map((g) => ({
        id: g.id,
        kind: "group" as const,
        name: g.name,
        username: g.username,
        visibility: g.visibility,
        count: g.memberCount,
        mine: true,
      })),
    ...publicChannels.map((c) => ({
      id: c.id,
      kind: "channel" as const,
      name: c.name,
      username: c.username,
      visibility: "public" as const,
      count: c.subscriberCount,
      mine: c.subscribed,
    })),
    ...mineChannels
      .filter((c) => !needle || c.name.toLowerCase().includes(needle) || (c.username ?? "").includes(needle))
      .map((c) => ({
        id: c.id,
        kind: "channel" as const,
        name: c.name,
        username: c.username,
        visibility: c.visibility,
        count: c.subscriberCount,
        mine: true,
      })),
  ];
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    const k = `${r.kind}:${r.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { ok: true as const, items: unique.slice(0, limit) };
}
