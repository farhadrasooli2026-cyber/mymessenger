import "server-only";
import { readStoreSnapshot } from "@/lib/store";
import type { GroupRecord } from "@/lib/store";
import { GROUP_CATEGORIES } from "@/lib/group-types";

function liveCount(group: GroupRecord) {
  return group.members.filter((m) => !m.leftAt).length;
}

export function isPublicDiscoverableGroup(group: GroupRecord) {
  return !group.deletedAt && group.joinMode === "open" && group.searchVisible !== false;
}

export async function discoverGroups(
  userId: string,
  input?: { q?: string; category?: string; tag?: string },
) {
  const data = await readStoreSnapshot();
  const q = (input?.q ?? "").trim().toLowerCase();
  const category = input?.category?.trim().toLowerCase();
  const tag = input?.tag?.trim().toLowerCase();
  const mine = new Set(
    data.groups.filter((g) => g.members.some((m) => m.key === userId && !m.leftAt)).map((g) => g.id),
  );
  const hits = data.groups
    .filter(isPublicDiscoverableGroup)
    .filter((g) => !g.bans.some((b) => b.key === userId && (!b.until || b.until > Date.now())))
    .filter((g) => !category || g.category === category)
    .filter((g) => !tag || g.tags.some((t) => t.toLowerCase() === tag))
    .filter((g) => {
      if (q.length < 2) return true;
      const blob = `${g.name} ${g.username ?? ""} ${g.description} ${g.tags.join(" ")} ${g.category}`.toLowerCase();
      return blob.includes(q);
    })
    .map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description.slice(0, 180),
      username: g.username,
      color: g.color,
      category: g.category,
      tags: g.tags,
      memberCount: liveCount(g),
      joined: mine.has(g.id),
      visibility: "public" as const,
    }))
    .sort((a, b) => b.memberCount - a.memberCount)
    .slice(0, 40);
  return hits;
}

export async function recommendGroups(userId: string) {
  const data = await readStoreSnapshot();
  const mine = data.groups.filter((g) => !g.deletedAt && g.members.some((m) => m.key === userId && !m.leftAt));
  const mineIds = new Set(mine.map((g) => g.id));
  const cats = new Set(mine.map((g) => g.category).filter(Boolean));
  const tags = new Set(mine.flatMap((g) => g.tags));
  const hidden = new Set(data.users.find((u) => u.id === userId)?.searchHideIds ?? []);
  const scored = data.groups
    .filter(isPublicDiscoverableGroup)
    .filter((g) => !mineIds.has(g.id) && !hidden.has(g.id))
    .filter((g) => !g.bans.some((b) => b.key === userId && (!b.until || b.until > Date.now())))
    .map((g) => {
      let score = liveCount(g) / 8;
      if (cats.has(g.category)) score += 6;
      score += g.tags.filter((t) => tags.has(t)).length * 2;
      return {
        id: g.id,
        name: g.name,
        description: g.description.slice(0, 180),
        username: g.username,
        color: g.color,
        category: g.category,
        tags: g.tags,
        memberCount: liveCount(g),
        visibility: "public" as const,
        score,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
  return scored;
}

export function validCategory(value?: string) {
  if (!value) return "general";
  return (GROUP_CATEGORIES as readonly string[]).includes(value) ? value : "general";
}
