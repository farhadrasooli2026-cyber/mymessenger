import "server-only";
import { decryptText, encryptText, hmacIdentifier, randomId } from "@/lib/crypto-utils";
import { normalizeEmail, normalizePhone } from "@/lib/identifiers";
import { hitRateLimit } from "@/lib/rate-limit";
import { bumpDiscoveryCaches, mutateStore, readStoreSnapshot } from "@/lib/store";
import type { ContactGroupKind, ContactRecord, FriendshipRecord, StoreData } from "@/lib/store";
import { audienceAllows, canFindByUsername, pairBlocked, setBlockedPeer } from "@/lib/privacy";
import { publicProfile } from "@/lib/profile";
import { normalizeUsername } from "@/lib/username";
import { openDm } from "@/lib/chat";
import { fileReport, reportCategorySchema } from "@/lib/safety";
import { emitNotification } from "@/lib/notify";
import { enqueueGraphEvent } from "@/lib/graph";
import { collate } from "@/lib/i18n/collate";

export const CONTACT_GROUPS: { id: ContactGroupKind; label: string }[] = [
  { id: "family", label: "خانواده" },
  { id: "friends", label: "دوستان" },
  { id: "work", label: "کار" },
  { id: "custom", label: "سفارشی" },
  { id: "", label: "بدون دسته" },
];

const PHOTO_MAX = 80_000;
const NOTES_MAX = 2_000;
const NAME_MAX = 80;
const REQUEST_TTL_MS = 14 * 24 * 60 * 60_000;
const SUGGESTION_CAP = 12;

function ensureArrays(data: StoreData) {
  data.contacts ??= [];
  data.contactInvites ??= [];
  data.contactRequests ??= [];
  data.contactLists ??= [];
  data.follows ??= [];
  data.friendships ??= [];
}

function bumpRel(data: StoreData, ...userIds: string[]) {
  for (const id of userIds) {
    const u = data.users.find((x) => x.id === id);
    if (u) u.relationshipRev = (u.relationshipRev ?? 0) + 1;
  }
}

function friendPair(a: string, b: string) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function upsertFriendship(data: StoreData, a: string, b: string): FriendshipRecord {
  ensureArrays(data);
  const pairKey = friendPair(a, b);
  const existing = data.friendships.find((f) => f.pairKey === pairKey);
  if (existing) return existing;
  const userA = a < b ? a : b;
  const userB = a < b ? b : a;
  const row: FriendshipRecord = { id: randomId(), pairKey, userA, userB, createdAt: Date.now() };
  data.friendships.push(row);
  return row;
}

function dropFriendship(data: StoreData, a: string, b: string) {
  const pairKey = friendPair(a, b);
  data.friendships = (data.friendships ?? []).filter((f) => f.pairKey !== pairKey);
}

function expireStaleRequests(data: StoreData) {
  const now = Date.now();
  for (const r of data.contactRequests ?? []) {
    const exp = r.expiresAt ?? r.createdAt + REQUEST_TTL_MS;
    if (r.status === "pending" && exp < now) {
      r.status = "expired";
      r.updatedAt = now;
    }
  }
}

function cleanupOrphans(data: StoreData) {
  const active = new Set(
    data.users.filter((u) => u.status === "active" && (u.accountStatus ?? "active") === "active").map((u) => u.id),
  );
  for (const u of data.users) {
    const before = u.friendIds?.length ?? 0;
    u.friendIds = (u.friendIds ?? []).filter((id) => active.has(id));
    if ((u.friendIds?.length ?? 0) !== before) u.relationshipRev = (u.relationshipRev ?? 0) + 1;
  }
  for (const c of data.contacts ?? []) {
    if (c.nixoUserId && !active.has(c.nixoUserId)) c.nixoUserId = null;
  }
  data.friendships = (data.friendships ?? []).filter((f) => active.has(f.userA) && active.has(f.userB));
  data.follows = (data.follows ?? []).filter((f) => active.has(f.followerId) && active.has(f.followeeId));
}

function canSeeFriendList(target: { id: string; privacyFriends?: string; friendIds?: string[] }, viewerId: string) {
  if (target.id === viewerId) return true;
  const vis = target.privacyFriends ?? "friends";
  if (vis === "nobody") return false;
  if (vis === "everyone") return true;
  return (target.friendIds ?? []).includes(viewerId);
}

function canSeeFriendCount(target: { id: string; privacyFriendCount?: string; friendIds?: string[] }, viewerId: string) {
  if (target.id === viewerId) return true;
  const vis = target.privacyFriendCount ?? "friends";
  if (vis === "nobody") return false;
  if (vis === "everyone") return true;
  return (target.friendIds ?? []).includes(viewerId);
}

function relationshipAudit(data: StoreData, userId: string, detail: string) {
  data.audit = [
    { id: `rel-${Date.now()}-${randomId().slice(0, 6)}`, userId, kind: "privacy" as const, createdAt: Date.now(), detail },
    ...(data.audit ?? []),
  ].slice(0, 400);
}

function notesOf(row: ContactRecord) {
  if (!row.notesCipher) return "";
  try {
    return decryptText(row.notesCipher).slice(0, NOTES_MAX);
  } catch {
    return row.notesCipher.slice(0, NOTES_MAX);
  }
}

function setNotes(row: ContactRecord, notes: string) {
  const t = notes.trim().slice(0, NOTES_MAX);
  row.notesCipher = t ? encryptText(t) : "";
}

function publicContact(row: ContactRecord) {
  return {
    id: row.id,
    nixoUserId: row.nixoUserId,
    name: row.name,
    phone: row.phone,
    email: row.email,
    username: row.username,
    notes: notesOf(row),
    custom: row.custom ?? {},
    labels: row.labels ?? [],
    group: row.group,
    favorite: row.favorite,
    localPhoto: row.localPhoto || "",
    source: row.source,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastContactedAt: row.lastContactedAt,
    deviceStamp: row.deviceStamp,
    mutedUntil: row.mutedUntil ?? null,
    nickname: row.nickname ?? null,
    notifyPreview: row.notifyPreview !== false,
    notifySound: row.notifySound !== false,
  };
}

function owned(data: StoreData, userId: string, contactId: string) {
  return data.contacts.find((c) => c.id === contactId && c.ownerUserId === userId) ?? null;
}

function linkNixoUser(data: StoreData, ownerId: string, phone: string, email: string, username: string) {
  const un = normalizeUsername(username);
  if (un) {
    const byName = data.users.find((u) => u.status === "active" && u.username === un && u.id !== ownerId);
    if (byName && !pairBlocked(data, ownerId, byName.id)) return byName.id;
  }
  const phoneN = normalizePhone(phone);
  const emailN = normalizeEmail(email);
  const needle = phoneN ?? emailN;
  if (!needle) return null;
  const hash = hmacIdentifier(needle);
  const found = data.users.find((u) => u.status === "active" && u.identifierHash === hash && u.id !== ownerId);
  if (!found || pairBlocked(data, ownerId, found.id)) return null;
  const vis = phoneN ? found.privacyFindPhone : found.privacyEmail;
  const allow = phoneN ? found.findPhoneAllowIds : found.emailAllowIds;
  if (!audienceAllows(vis, found.contactIds, allow, ownerId)) return null;
  return found.id;
}

function addToContactIds(data: StoreData, ownerId: string, otherId: string | null) {
  if (!otherId || otherId === ownerId) return;
  const me = data.users.find((u) => u.id === ownerId);
  if (me && !me.contactIds.includes(otherId)) me.contactIds.push(otherId);
}

export async function listContacts(
  userId: string,
  opts: { q?: string; sort?: string; group?: string; favorites?: boolean; recently?: boolean; offset?: number; limit?: number; cursor?: string } = {},
) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    ensureArrays(data);
    expireStaleRequests(data);
    cleanupOrphans(data);
    const needle = (opts.q ?? "").trim().toLowerCase().replace(/^@/, "");
    let rows = data.contacts.filter((c) => c.ownerUserId === userId);
    if (opts.favorites) rows = rows.filter((c) => c.favorite);
    if (opts.group) rows = rows.filter((c) => c.group === opts.group);
    if (needle) {
      rows = rows.filter((c) => {
        const nick = (c.nickname ?? "").toLowerCase();
        const blob = `${c.name} ${nick} ${c.username} ${c.phone} ${c.email} ${c.labels.join(" ")} ${notesOf(c)}`.toLowerCase();
        return blob.includes(needle);
      });
    }
    const loc = me.prefs?.locale;
    if (opts.recently) {
      rows = rows.filter((c) => c.lastContactedAt > 0).sort((a, b) => b.lastContactedAt - a.lastContactedAt);
    } else if (opts.sort === "added") {
      rows.sort((a, b) => b.createdAt - a.createdAt);
    } else if (opts.sort === "contacted") {
      rows.sort((a, b) => b.lastContactedAt - a.lastContactedAt || b.updatedAt - a.updatedAt);
    } else if (opts.sort === "favorites") {
      rows.sort((a, b) => Number(b.favorite) - Number(a.favorite) || collate(a.name, b.name, loc));
    } else {
      rows.sort((a, b) => collate(a.nickname || a.name, b.nickname || b.name, loc));
    }
    const duplicates = findDuplicateIds(rows);
    const offset = Math.max(0, opts.offset ?? 0);
    const limit = Math.min(50, Math.max(1, opts.limit ?? 40));
    const start = opts.cursor ? Math.max(0, rows.findIndex((c) => c.id === opts.cursor) + 1) : offset;
    const page = rows.slice(start, start + limit);
    const last = page[page.length - 1];
    const pending = data.contactRequests.filter((r) => r.toUserId === userId && r.status === "pending");
    const outgoing = data.contactRequests.filter((r) => r.fromUserId === userId && r.status === "pending");
    const friends = (me.friendIds ?? [])
      .map((id) => data.users.find((u) => u.id === id && u.status === "active"))
      .filter(Boolean)
      .map((u) => publicProfile(u!, userId));
    const myInvites = data.contactInvites
      .filter((i) => i.ownerUserId === userId)
      .map((i) => ({
        id: i.id,
        token: i.token,
        maxUses: i.maxUses,
        uses: i.uses,
        expiresAt: i.expiresAt,
        revokedAt: i.revokedAt ?? null,
        path: `/join/invite/${i.token}`,
      }));
    return {
      ok: true as const,
      contacts: page.map(publicContact),
      hasMore: start + page.length < rows.length,
      nextOffset: start + page.length,
      nextCursor: start + page.length < rows.length && last ? last.id : null,
      total: rows.length,
      favorites: data.contacts.filter((c) => c.ownerUserId === userId && c.favorite).map(publicContact),
      recently: data.contacts
        .filter((c) => c.ownerUserId === userId && c.lastContactedAt > 0)
        .sort((a, b) => b.lastContactedAt - a.lastContactedAt)
        .slice(0, 20)
        .map(publicContact),
      labels: [...new Set(data.contacts.filter((c) => c.ownerUserId === userId).flatMap((c) => c.labels))],
      duplicates,
      requestsIn: pending.map((r) => requestView(data, r, userId)),
      requestsOut: outgoing.map((r) => requestView(data, r, userId)),
      friends,
      friendCount: friends.length,
      mutedPeerKeys: me.mutedPeerKeys ?? [],
      permission: me.contactOsPermission,
      syncEnabled: me.contactSyncEnabled,
      autoSync: Boolean(me.contactAutoSync),
      notifyJoin: me.contactNotifyJoin,
      syncStatus: me.contactSyncStatus ?? "idle",
      syncError: me.contactSyncError ?? "",
      lastSyncAt: me.contactLastSyncAt ?? 0,
      lists: (data.contactLists ?? []).filter((l) => l.ownerUserId === userId),
      invites: myInvites,
      relationshipRev: me.relationshipRev ?? 0,
    };
  });
}

function requestView(data: StoreData, r: StoreData["contactRequests"][number], viewerId: string) {
  const otherId = r.fromUserId === viewerId ? r.toUserId : r.fromUserId;
  const other = data.users.find((u) => u.id === otherId);
  return {
    id: r.id,
    fromUserId: r.fromUserId,
    toUserId: r.toUserId,
    status: r.status === "declined" ? "rejected" : r.status,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt ?? r.createdAt + REQUEST_TTL_MS,
    peer: other ? publicProfile(other, viewerId) : null,
  };
}

function findDuplicateIds(rows: ContactRecord[]) {
  const buckets = new Map<string, string[]>();
  for (const c of rows) {
    const keys = [c.phone && `p:${c.phone}`, c.email && `e:${c.email}`, c.username && `u:${c.username}`].filter(Boolean) as string[];
    for (const k of keys) {
      const list = buckets.get(k) ?? [];
      if (!list.includes(c.id)) list.push(c.id);
      buckets.set(k, list);
    }
  }
  return [...buckets.values()].filter((ids) => ids.length > 1);
}

export type ContactPatch = {
  id?: string;
  name?: string;
  phone?: string;
  email?: string;
  username?: string;
  notes?: string;
  custom?: Record<string, string>;
  labels?: string[];
  group?: ContactGroupKind;
  favorite?: boolean;
  localPhoto?: string;
  deviceStamp?: string;
  updatedAt?: number;
  force?: boolean;
  nickname?: string | null;
  mutedUntil?: number | null;
  notifyPreview?: boolean;
  notifySound?: boolean;
};

export async function saveContact(userId: string, patch: ContactPatch) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    ensureArrays(data);
    const flood = hitRateLimit(data, `ctsave:${userId}`, 60_000, 40);
    if (!flood.allowed) return { ok: false as const, error: "ذخیره محدود شد.", status: 429 };
    const now = Date.now();
    const name = String(patch.name ?? "").trim().slice(0, NAME_MAX);
    if (patch.id) {
      const row = owned(data, userId, patch.id);
      if (!row) return { ok: false as const, error: "مخاطب یافت نشد.", status: 404 };
      if (!patch.force && typeof patch.updatedAt === "number" && patch.updatedAt < row.updatedAt) {
        return { ok: false as const, error: "تداخل همگام‌سازی. نسخهٔ جدیدتر روی دستگاه دیگر است.", status: 409, contact: publicContact(row) };
      }
      if (patch.name !== undefined) row.name = name || row.name;
      if (patch.phone !== undefined) row.phone = normalizePhone(patch.phone) ?? patch.phone.trim().slice(0, 32);
      if (patch.email !== undefined) row.email = normalizeEmail(patch.email) ?? patch.email.trim().slice(0, 80);
      if (patch.username !== undefined) row.username = (normalizeUsername(patch.username) ?? patch.username.replace(/^@/, "").trim().slice(0, 32)).toLowerCase();
      if (patch.notes !== undefined) setNotes(row, patch.notes);
      if (patch.custom && typeof patch.custom === "object") {
        row.custom = Object.fromEntries(
          Object.entries(patch.custom)
            .slice(0, 12)
            .map(([k, v]) => [String(k).slice(0, 40), String(v).slice(0, 200)]),
        );
      }
      if (Array.isArray(patch.labels)) row.labels = [...new Set(patch.labels.map((l) => String(l).trim().slice(0, 32)).filter(Boolean))].slice(0, 20);
      if (patch.group !== undefined) row.group = patch.group;
      if (typeof patch.favorite === "boolean") row.favorite = patch.favorite;
      if (patch.localPhoto !== undefined) row.localPhoto = patch.localPhoto.slice(0, PHOTO_MAX);
      if (patch.nickname !== undefined) row.nickname = patch.nickname ? String(patch.nickname).trim().slice(0, NAME_MAX) : null;
      if (patch.mutedUntil !== undefined) row.mutedUntil = typeof patch.mutedUntil === "number" ? patch.mutedUntil : null;
      if (typeof patch.notifyPreview === "boolean") row.notifyPreview = patch.notifyPreview;
      if (typeof patch.notifySound === "boolean") row.notifySound = patch.notifySound;
      row.updatedAt = now;
      row.deviceStamp = String(patch.deviceStamp ?? row.deviceStamp ?? "").slice(0, 80);
      row.nixoUserId = linkNixoUser(data, userId, row.phone, row.email, row.username);
      addToContactIds(data, userId, row.nixoUserId);
      bumpRel(data, userId);
      bumpDiscoveryCaches(data);
      return { ok: true as const, contact: publicContact(row) };
    }
    if (!name) return { ok: false as const, error: "نام مخاطب لازم است.", status: 400 };
    const phone = patch.phone ? (normalizePhone(patch.phone) ?? patch.phone.trim().slice(0, 32)) : "";
    const email = patch.email ? (normalizeEmail(patch.email) ?? patch.email.trim().slice(0, 80)) : "";
    const username = patch.username ? (normalizeUsername(patch.username) ?? patch.username.replace(/^@/, "").trim()).toLowerCase() : "";
    const linked = linkNixoUser(data, userId, phone, email, username);
    if (linked && !patch.force) {
      const existing = data.contacts.find((c) => c.ownerUserId === userId && c.nixoUserId === linked);
      if (existing) return { ok: true as const, contact: publicContact(existing), reused: true as const };
    }
    const row: ContactRecord = {
      id: randomId(),
      ownerUserId: userId,
      nixoUserId: linked,
      name,
      phone,
      email,
      username,
      notesCipher: "",
      custom: {},
      labels: Array.isArray(patch.labels) ? patch.labels.map(String).slice(0, 20) : [],
      group: patch.group ?? "",
      favorite: Boolean(patch.favorite),
      localPhoto: (patch.localPhoto ?? "").slice(0, PHOTO_MAX),
      source: "manual",
      createdAt: now,
      updatedAt: now,
      lastContactedAt: 0,
      deviceStamp: String(patch.deviceStamp ?? "").slice(0, 80),
      mutedUntil: typeof patch.mutedUntil === "number" ? patch.mutedUntil : null,
      matchHash: "",
      nickname: patch.nickname ? String(patch.nickname).trim().slice(0, NAME_MAX) : null,
      notifyPreview: patch.notifyPreview !== false,
      notifySound: patch.notifySound !== false,
    };
    if (patch.notes) setNotes(row, patch.notes);
    data.contacts.push(row);
    addToContactIds(data, userId, row.nixoUserId);
    bumpRel(data, userId);
    bumpDiscoveryCaches(data);
    return { ok: true as const, contact: publicContact(row) };
  });
}

export async function deleteContact(userId: string, contactId: string) {
  return mutateStore((data) => {
    const row = owned(data, userId, contactId);
    if (!row) return { ok: false as const, error: "مخاطب یافت نشد.", status: 404 };
    const linked = row.nixoUserId;
    data.contacts = data.contacts.filter((c) => c.id !== contactId);
    const me = data.users.find((u) => u.id === userId);
    if (me && linked && !data.contacts.some((c) => c.ownerUserId === userId && c.nixoUserId === linked)) {
      me.contactIds = me.contactIds.filter((id) => id !== linked);
    }
    bumpRel(data, userId);
    const still = data.users.find((u) => u.id === linked);
    bumpDiscoveryCaches(data);
    return { ok: true as const, accountKept: Boolean(still) };
  });
}

export async function mergeContacts(userId: string, keepId: string, dropId: string, confirm: boolean) {
  if (!confirm) return { ok: false as const, error: "ادغام نیاز به تأیید دارد.", status: 400 };
  return mutateStore((data) => {
    const keep = owned(data, userId, keepId);
    const drop = owned(data, userId, dropId);
    if (!keep || !drop) return { ok: false as const, error: "مخاطب یافت نشد.", status: 404 };
    keep.name = keep.name || drop.name;
    keep.phone = keep.phone || drop.phone;
    keep.email = keep.email || drop.email;
    keep.username = keep.username || drop.username;
    if (!notesOf(keep) && notesOf(drop)) setNotes(keep, notesOf(drop));
    keep.labels = [...new Set([...keep.labels, ...drop.labels])];
    keep.custom = { ...drop.custom, ...keep.custom };
    keep.favorite = keep.favorite || drop.favorite;
    keep.localPhoto = keep.localPhoto || drop.localPhoto;
    keep.nixoUserId = keep.nixoUserId || drop.nixoUserId;
    keep.lastContactedAt = Math.max(keep.lastContactedAt, drop.lastContactedAt);
    keep.updatedAt = Date.now();
    data.contacts = data.contacts.filter((c) => c.id !== drop.id);
    addToContactIds(data, userId, keep.nixoUserId);
    return { ok: true as const, contact: publicContact(keep) };
  });
}

export async function ingestPhoneBook(
  userId: string,
  rows: { name?: string; phone?: string; email?: string }[],
  permission: "allow" | "limited" | "deny",
) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    ensureArrays(data);
    me.contactOsPermission = permission;
    if (permission === "deny") {
      return { ok: false as const, error: "بدون مجوز سیستم‌عامل به مخاطبین گوشی دسترسی نیست.", status: 403 };
    }
    if (!me.contactSyncEnabled) return { ok: false as const, error: "همگام‌سازی مخاطب خاموش است.", status: 403 };
    const flood = hitRateLimit(data, `ctsync:${userId}`, 60_000, 4);
    if (!flood.allowed) return { ok: false as const, error: "همگام‌سازی محدود شد.", status: 429 };
    const now = Date.now();
    const hashes: string[] = [];
    let imported = 0;
    const newMatches: { id: string; name: string }[] = [];
    for (const raw of rows.slice(0, 200)) {
      const phone = raw.phone ? normalizePhone(raw.phone) ?? "" : "";
      const email = raw.email ? normalizeEmail(raw.email) ?? "" : "";
      const name = String(raw.name ?? "").trim().slice(0, NAME_MAX) || phone || email || "مخاطب";
      if (!phone && !email) continue;
      if (phone) hashes.push(hmacIdentifier(phone));
      if (email) hashes.push(hmacIdentifier(email));
      let row = data.contacts.find(
        (c) => c.ownerUserId === userId && ((phone && c.phone === phone) || (email && c.email === email)),
      );
      if (!row) {
        row = {
          id: randomId(),
          ownerUserId: userId,
          nixoUserId: null,
          name,
          phone,
          email,
          username: "",
          notesCipher: "",
          custom: {},
          labels: [],
          group: "",
          favorite: false,
          localPhoto: "",
          source: "sync",
          createdAt: now,
          updatedAt: now,
          lastContactedAt: 0,
          deviceStamp: "os-sync",
          mutedUntil: null,
          matchHash: "",
          nickname: null,
          notifyPreview: true,
          notifySound: true,
        };
        data.contacts.push(row);
        imported += 1;
      } else {
        if (name && row.source === "sync") row.name = name;
        if (phone) row.phone = phone;
        if (email) row.email = email;
        row.updatedAt = now;
      }
      const prev = row.nixoUserId;
      row.nixoUserId = linkNixoUser(data, userId, row.phone, row.email, row.username);
      if (row.nixoUserId && row.nixoUserId !== prev) {
        addToContactIds(data, userId, row.nixoUserId);
        const u = data.users.find((x) => x.id === row.nixoUserId);
        newMatches.push({ id: row.nixoUserId, name: u?.displayName || row.name });
      }
    }
    me.syncedContactHashes = [...new Set([...me.syncedContactHashes, ...hashes])].slice(0, 400);
    if (me.contactNotifyJoin) {
      for (const m of newMatches) {
        emitNotification(data, {
          userId,
          category: "system",
          kind: "contact-joined",
          title: "مخاطبی به نیکسو پیوست",
          body: "یکی از مخاطبین ذخیره‌شده حساب نیکسو دارد.",
          sourceId: `join:${m.id}`,
          target: { type: "system", id: m.id, href: "/app/contacts" },
        });
      }
    }
    return { ok: true as const, imported, syncedCount: me.syncedContactHashes.length, matches: newMatches.length };
  });
}

export async function setPermission(userId: string, permission: "allow" | "deny" | "limited" | "unknown") {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    me.contactOsPermission = permission;
    if (permission === "deny") me.contactSyncEnabled = false;
    return { ok: true as const, permission: me.contactOsPermission, syncEnabled: me.contactSyncEnabled };
  });
}

export async function discover(userId: string, raw: string) {
  const { findByIdentifier } = await import("@/lib/privacy");
  return findByIdentifier(userId, raw);
}

export async function findUsername(userId: string, raw: string) {
  return mutateStore((data) => {
    const flood = hitRateLimit(data, `ctuser:${userId}`, 60_000, 30);
    if (!flood.allowed) return { ok: false as const, error: "جستجو محدود شد.", status: 429 };
    const username = normalizeUsername(raw);
    if (!username) return { ok: true as const, user: null };
    const found = data.users.find((u) => u.status === "active" && u.username === username);
    if (!found || found.id === userId) return { ok: true as const, user: null };
    if (!canFindByUsername(data, found, userId)) return { ok: true as const, user: null };
    return { ok: true as const, user: publicProfile(found, userId) };
  });
}

export async function viewPerson(viewerId: string, username: string) {
  const data = await readStoreSnapshot();
  const un = normalizeUsername(username);
  if (!un) return { ok: false as const, error: "نام کاربری معتبر نیست.", status: 400 };
  const target = data.users.find((u) => u.status === "active" && u.username === un);
  if (!target) return { ok: false as const, error: "پروفایل در دسترس نیست.", status: 404 };
  if (!canFindByUsername(data, target, viewerId)) {
    return { ok: false as const, error: "پروفایل در دسترس نیست.", status: 404 };
  }
  const profile = publicProfile(target, viewerId);
  const mutualGroups = (data.groups ?? [])
    .filter((g) => !g.deletedAt)
    .filter((g) => g.members.some((m) => m.key === viewerId && !m.leftAt) && g.members.some((m) => m.key === target.id && !m.leftAt))
    .map((g) => ({ id: g.id, name: g.name, color: g.color }));
  const mutualChannels = (data.pubChannels ?? [])
    .filter((ch) => !ch.deletedAt)
    .filter((ch) => {
      const a = ch.subscribers.some((s) => s.userId === viewerId && !s.leftAt) || ch.ownerUserId === viewerId;
      const b = ch.subscribers.some((s) => s.userId === target.id && !s.leftAt) || ch.ownerUserId === target.id;
      return a && b;
    })
    .map((ch) => ({ id: ch.id, name: ch.name, username: ch.username }));
  const thread = data.threads.find((t) => t.ownerUserId === viewerId && t.peerKey === target.id);
  const sharedMedia = thread
    ? data.messages.filter((m) => m.threadId === thread.id && (m.kind === "photo" || m.kind === "video" || m.kind === "file")).length
    : 0;
  const mine = data.contacts.find((c) => c.ownerUserId === viewerId && c.nixoUserId === target.id);
  const viewer = data.users.find((u) => u.id === viewerId);
  const friendship = (data.friendships ?? []).find(
    (f) => (f.userA === viewerId && f.userB === target.id) || (f.userA === target.id && f.userB === viewerId),
  );
  const follow = (data.follows ?? []).find((f) => f.followerId === viewerId && f.followeeId === target.id && f.status !== "blocked");
  const mutualFriendIds =
    viewer && canSeeFriendList(target, viewerId)
      ? (target.friendIds ?? []).filter((id) => (viewer.friendIds ?? []).includes(id) && id !== viewerId && id !== target.id && !pairBlocked(data, viewerId, id))
      : [];
  const mutualFriends = mutualFriendIds
    .slice(0, 8)
    .map((id) => data.users.find((u) => u.id === id && u.status === "active"))
    .filter(Boolean)
    .map((u) => ({ id: u!.id, username: u!.username ?? null, displayName: u!.displayName || u!.username || "کاربر" }));
  const friendCount = canSeeFriendCount(target, viewerId) ? (target.friendIds ?? []).filter((id) => data.users.some((u) => u.id === id && u.status === "active")).length : null;
  const localSafe = mine
    ? publicContact(mine)
    : null;
  return {
    ok: true as const,
    profile,
    mutualGroups,
    mutualChannels,
    mutualFriends,
    friendCount,
    friendshipId: friendship && (friendship.userA === viewerId || friendship.userB === viewerId) ? friendship.id : null,
    followId: follow?.id ?? null,
    sharedMedia,
    localContact: localSafe,
    qrPayload: { t: "nixo-contact", u: target.username },
    othersContactsHidden: true,
    friend: Boolean(viewer?.friendIds?.includes(target.id)),
    following: Boolean(follow),
    muted: Boolean(viewer?.mutedPeerKeys?.includes(target.id)),
    blocked: pairBlocked(data, viewerId, target.id),
  };
}

export async function createInvite(userId: string, maxUses: number | null, ttlMs: number | null) {
  return mutateStore((data) => {
    const flood = hitRateLimit(data, `ctinv:${userId}`, 60 * 60_000, 12);
    if (!flood.allowed) return { ok: false as const, error: "ساخت دعوت محدود شد.", status: 429 };
    ensureArrays(data);
    const now = Date.now();
    const invite = {
      id: randomId(),
      token: randomId(),
      ownerUserId: userId,
      maxUses: maxUses && maxUses > 0 ? Math.min(50, Math.floor(maxUses)) : null,
      uses: 0,
      expiresAt: ttlMs && ttlMs > 0 ? now + Math.min(ttlMs, 30 * 24 * 60 * 60_000) : now + 7 * 24 * 60 * 60_000,
      createdAt: now,
      revokedAt: null as number | null,
    };
    data.contactInvites.push(invite);
    return { ok: true as const, invite: { id: invite.id, token: invite.token, maxUses: invite.maxUses, expiresAt: invite.expiresAt, path: `/join/invite/${invite.token}` } };
  });
}

export async function revokeInvite(userId: string, token: string) {
  return mutateStore((data) => {
    ensureArrays(data);
    const invite = data.contactInvites.find((i) => i.token === token && i.ownerUserId === userId);
    if (!invite) return { ok: false as const, error: "دعوت یافت نشد.", status: 404 };
    invite.revokedAt = Date.now();
    bumpRel(data, userId);
    relationshipAudit(data, userId, "qr-revoke");
    return { ok: true as const };
  });
}

export async function previewInvite(token: string) {
  const data = await readStoreSnapshot();
  const invite = data.contactInvites.find((i) => i.token === token);
  if (!invite) return { ok: false as const, error: "لینک دعوت نامعتبر است.", status: 404 };
  const now = Date.now();
  if (invite.revokedAt) return { ok: false as const, error: "لینک دعوت باطل شده است.", status: 410 };
  if (invite.expiresAt && invite.expiresAt < now) return { ok: false as const, error: "لینک دعوت منقضی شده است.", status: 410 };
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) return { ok: false as const, error: "سقف استفاده از لینک پر شده است.", status: 410 };
  const owner = data.users.find((u) => u.id === invite.ownerUserId);
  return {
    ok: true as const,
    inviter: owner ? { displayName: owner.displayName || owner.username || "کاربر نیکسو", username: owner.username } : { displayName: "کاربر نیکسو", username: null },
  };
}

export async function acceptInvite(userId: string, token: string) {
  return mutateStore((data) => {
    const flood = hitRateLimit(data, `ctacc:${userId}`, 60_000, 10);
    if (!flood.allowed) return { ok: false as const, error: "پذیرش دعوت محدود شد.", status: 429 };
    ensureArrays(data);
    const invite = data.contactInvites.find((i) => i.token === token);
    if (!invite) return { ok: false as const, error: "لینک دعوت نامعتبر است.", status: 404 };
    const now = Date.now();
    if (invite.revokedAt) return { ok: false as const, error: "لینک دعوت باطل شده است.", status: 410 };
    if (invite.expiresAt && invite.expiresAt < now) return { ok: false as const, error: "لینک دعوت منقضی شده است.", status: 410 };
    if (invite.maxUses !== null && invite.uses >= invite.maxUses) return { ok: false as const, error: "سقف استفاده از لینک پر شده است.", status: 410 };
    if (invite.ownerUserId === userId) return { ok: false as const, error: "نمی‌توانید دعوت خودتان را بپذیرید.", status: 400 };
    invite.uses += 1;
    const owner = data.users.find((u) => u.id === invite.ownerUserId);
    const me = data.users.find((u) => u.id === userId);
    if (!owner || !me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    if (pairBlocked(data, userId, owner.id)) return { ok: false as const, error: "ارتباط مسدود است.", status: 403 };
    addToContactIds(data, owner.id, me.id);
    addToContactIds(data, me.id, owner.id);
    const exists = data.contacts.find((c) => c.ownerUserId === userId && c.nixoUserId === owner.id);
    if (!exists) {
      data.contacts.push({
        id: randomId(),
        ownerUserId: userId,
        nixoUserId: owner.id,
        name: owner.displayName || owner.username || "دوست نیکسو",
        phone: "",
        email: "",
        username: owner.username ?? "",
        notesCipher: "",
        custom: {},
        labels: [],
        group: "friends",
        favorite: false,
        localPhoto: "",
        source: "invite",
        createdAt: now,
        updatedAt: now,
        lastContactedAt: 0,
        deviceStamp: "",
        mutedUntil: null,
        matchHash: "",
        nickname: null,
        notifyPreview: true,
        notifySound: true,
      });
    }
    return { ok: true as const, username: owner.username };
  });
}

export async function sendRequest(userId: string, targetId: string) {
  return mutateStore((data) => {
    const flood = hitRateLimit(data, `ctreq:${userId}`, 60 * 60_000, 20);
    if (!flood.allowed) return { ok: false as const, error: "درخواست ارتباط محدود شد.", status: 429 };
    if (userId === targetId) return { ok: false as const, error: "نامعتبر.", status: 400 };
    ensureArrays(data);
    expireStaleRequests(data);
    if (pairBlocked(data, userId, targetId)) return { ok: false as const, error: "ارتباط مسدود است.", status: 403 };
    const target = data.users.find((u) => u.id === targetId && u.status === "active" && (u.accountStatus ?? "active") === "active");
    if (!target) return { ok: false as const, error: "کاربر یافت نشد.", status: 404 };
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    if ((me.friendIds ?? []).includes(targetId) || (target.friendIds ?? []).includes(userId)) {
      const friendship = upsertFriendship(data, userId, targetId);
      return { ok: true as const, requestId: "friends", status: "accepted" as const, friendshipId: friendship.id };
    }
    const existing = data.contactRequests.find(
      (r) => r.status === "pending" && ((r.fromUserId === userId && r.toUserId === targetId) || (r.fromUserId === targetId && r.toUserId === userId)),
    );
    if (existing) return { ok: true as const, requestId: existing.id, status: existing.status };
    const spam = hitRateLimit(data, `ctreq-burst:${userId}`, 10 * 60_000, 8);
    if (!spam.allowed) {
      data.audit = [
        { id: `frq-${Date.now()}`, userId, kind: "suspicious" as const, createdAt: Date.now(), detail: "friend-request-spam" },
        ...(data.audit ?? []),
      ].slice(0, 400);
      return { ok: false as const, error: "درخواست ارتباط محدود شد.", status: 429 };
    }
    const now = Date.now();
    const row = {
      id: randomId(),
      fromUserId: userId,
      toUserId: targetId,
      status: "pending" as const,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + REQUEST_TTL_MS,
    };
    data.contactRequests.push(row);
    bumpRel(data, userId, targetId);
    emitNotification(data, {
      userId: targetId,
      category: "friends",
      kind: "friend-request",
      title: "درخواست دوستی",
      body: "یک کاربر نیکسو درخواست دوستی فرستاده است.",
      sourceId: `req:${row.id}`,
      eventId: `friend-request:${row.id}`,
      actorUserId: userId,
      target: { type: "system", id: row.id, href: "/app/contacts" },
    });
    return { ok: true as const, requestId: row.id, status: "pending" as const };
  });
}

export async function resolveRequest(userId: string, requestId: string, action: "accept" | "decline" | "block" | "report") {
  if (action === "report") {
    const data = await readStoreSnapshot();
    const req = data.contactRequests.find((r) => r.id === requestId && r.toUserId === userId);
    if (!req) return { ok: false as const, error: "درخواست یافت نشد.", status: 404 };
    const reported = await fileReport(userId, {
      targetKind: "user",
      targetKey: req.fromUserId,
      category: "spam",
      details: "گزارش از درخواست ارتباط",
    });
    if (!reported.ok) return reported;
  }
  return mutateStore((data) => {
    const req = data.contactRequests.find((r) => r.id === requestId && (r.toUserId === userId || r.fromUserId === userId));
    if (!req) return { ok: false as const, error: "درخواست یافت نشد.", status: 404 };
    if (action === "block") {
      if (req.toUserId !== userId) return { ok: false as const, error: "اجازه نیست.", status: 403 };
      req.status = "blocked";
      req.updatedAt = Date.now();
      const me = data.users.find((u) => u.id === userId);
      if (me && !me.blockedPeerKeys.includes(req.fromUserId)) me.blockedPeerKeys.push(req.fromUserId);
      dropFriendship(data, userId, req.fromUserId);
      data.follows = data.follows.filter(
        (f) => !((f.followerId === userId && f.followeeId === req.fromUserId) || (f.followerId === req.fromUserId && f.followeeId === userId)),
      );
      bumpRel(data, userId, req.fromUserId);
      relationshipAudit(data, userId, "friend-request-block");
      bumpDiscoveryCaches(data);
      enqueueGraphEvent(data, "friend-request-block", userId, req.fromUserId);
      return { ok: true as const };
    }
    if (action === "decline" || action === "report") {
      if (req.toUserId !== userId) return { ok: false as const, error: "اجازه نیست.", status: 403 };
      req.status = "rejected";
      req.updatedAt = Date.now();
      bumpRel(data, userId, req.fromUserId);
      return { ok: true as const };
    }
    if (req.toUserId !== userId) return { ok: false as const, error: "اجازه نیست.", status: 403 };
    expireStaleRequests(data);
    if (req.status !== "pending") return { ok: false as const, error: "این درخواست قابل پذیرش نیست.", status: 400 };
    req.status = "accepted";
    req.updatedAt = Date.now();
    addToContactIds(data, userId, req.fromUserId);
    addToContactIds(data, req.fromUserId, userId);
    const me = data.users.find((u) => u.id === userId);
    const other = data.users.find((u) => u.id === req.fromUserId);
    let friendshipId: string | null = null;
    if (me && other) {
      if (!me.friendIds.includes(other.id)) me.friendIds.push(other.id);
      if (!other.friendIds.includes(me.id)) other.friendIds.push(me.id);
      friendshipId = upsertFriendship(data, me.id, other.id).id;
    }
    bumpRel(data, userId, req.fromUserId);
    relationshipAudit(data, userId, "friend-accept");
    emitNotification(data, {
      userId: req.fromUserId,
      category: "friends",
      kind: "friend-accepted",
      title: "درخواست دوستی پذیرفته شد",
      body: "حالا در فهرست دوستان هستید.",
      sourceId: `reqok:${req.id}`,
      eventId: `friend-accepted:${req.id}`,
      actorUserId: userId,
      target: { type: "system", id: req.id, href: "/app/contacts" },
    });
    bumpDiscoveryCaches(data);
    enqueueGraphEvent(data, "friend-accept", userId, req.fromUserId);
    return { ok: true as const, friendshipId };
  });
}

export async function cancelRequest(userId: string, requestId: string) {
  return mutateStore((data) => {
    const req = data.contactRequests.find((r) => r.id === requestId);
    if (!req) return { ok: false as const, error: "درخواست یافت نشد.", status: 404 };
    if (req.fromUserId !== userId) return { ok: false as const, error: "اجازه نیست.", status: 403 };
    if (req.status !== "pending") return { ok: false as const, error: "این درخواست قابل لغو نیست.", status: 400 };
    req.status = "cancelled";
    req.updatedAt = Date.now();
    bumpRel(data, userId, req.toUserId);
    return { ok: true as const };
  });
}

export async function removeFriend(userId: string, peerId: string, friendshipId?: string) {
  return mutateStore((data) => {
    ensureArrays(data);
    if (friendshipId) {
      const row = data.friendships.find((f) => f.id === friendshipId);
      if (!row) return { ok: false as const, error: "دوستی یافت نشد.", status: 404 };
      if (row.userA !== userId && row.userB !== userId) return { ok: false as const, error: "اجازه نیست.", status: 403 };
      peerId = row.userA === userId ? row.userB : row.userA;
    }
    if (userId === peerId) return { ok: false as const, error: "نامعتبر.", status: 400 };
    const me = data.users.find((u) => u.id === userId);
    const other = data.users.find((u) => u.id === peerId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    me.friendIds = (me.friendIds ?? []).filter((id) => id !== peerId);
    if (other) other.friendIds = (other.friendIds ?? []).filter((id) => id !== userId);
    dropFriendship(data, userId, peerId);
    bumpRel(data, userId, peerId);
    relationshipAudit(data, userId, "unfriend");
    bumpDiscoveryCaches(data);
    enqueueGraphEvent(data, "unfriend", userId, peerId);
    return { ok: true as const, friendIds: me.friendIds };
  });
}

export async function followUser(userId: string, peerId: string) {
  return mutateStore((data) => {
    const flood = hitRateLimit(data, `follow:${userId}`, 60 * 60_000, 40);
    if (!flood.allowed) return { ok: false as const, error: "Follow محدود شد.", status: 429 };
    const burst = hitRateLimit(data, `follow-burst:${userId}`, 10 * 60_000, 15);
    if (!burst.allowed) {
      data.audit = [
        { id: `fol-${Date.now()}`, userId, kind: "suspicious" as const, createdAt: Date.now(), detail: "mass-follow" },
        ...(data.audit ?? []),
      ].slice(0, 400);
      return { ok: false as const, error: "Follow محدود شد.", status: 429 };
    }
    if (userId === peerId) return { ok: false as const, error: "نامعتبر.", status: 400 };
    ensureArrays(data);
    if (pairBlocked(data, userId, peerId)) return { ok: false as const, error: "ارتباط مسدود است.", status: 403 };
    const target = data.users.find((u) => u.id === peerId && u.status === "active");
    const me = data.users.find((u) => u.id === userId);
    if (!target || !me) return { ok: false as const, error: "کاربر یافت نشد.", status: 404 };
    if (!audienceAllows(target.privacyFollow ?? "everyone", target.contactIds, [], userId, target.friendIds)) {
      return { ok: false as const, error: "Follow برای تو مجاز نیست.", status: 403 };
    }
    const existing = data.follows.find((f) => f.followerId === userId && f.followeeId === peerId && f.status !== "blocked");
    if (existing) return { ok: true as const, followId: existing.id, reused: true as const };
    const row = { id: randomId(), followerId: userId, followeeId: peerId, createdAt: Date.now(), status: "active" as const };
    data.follows.push(row);
    bumpRel(data, userId, peerId);
    emitNotification(data, {
      userId: peerId,
      category: "system",
      kind: "follow",
      title: "دنبال‌کننده جدید",
      body: "یک کاربر نیکسو تو را Follow کرد.",
      sourceId: `fol:${row.id}`,
      eventId: `follow:${row.id}`,
      actorUserId: userId,
      target: { type: "system", id: row.id, href: "/app/contacts" },
    });
    bumpDiscoveryCaches(data);
    enqueueGraphEvent(data, "follow", userId, peerId);
    return { ok: true as const, followId: row.id };
  });
}

export async function unfollowUser(userId: string, peerId: string, followId?: string) {
  return mutateStore((data) => {
    ensureArrays(data);
    const flood = hitRateLimit(data, `unfollow:${userId}`, 60 * 60_000, 40);
    if (!flood.allowed) return { ok: false as const, error: "Unfollow محدود شد.", status: 429 };
    const burst = hitRateLimit(data, `unfollow-burst:${userId}`, 10 * 60_000, 20);
    if (!burst.allowed) {
      data.audit = [
        { id: `unf-${Date.now()}`, userId, kind: "suspicious" as const, createdAt: Date.now(), detail: "mass-unfollow" },
        ...(data.audit ?? []),
      ].slice(0, 400);
      return { ok: false as const, error: "Unfollow محدود شد.", status: 429 };
    }
    if (followId) {
      const row = data.follows.find((f) => f.id === followId);
      if (!row) return { ok: false as const, error: "Follow یافت نشد.", status: 404 };
      if (row.followerId !== userId) return { ok: false as const, error: "اجازه نیست.", status: 403 };
      peerId = row.followeeId;
    }
    const before = data.follows.length;
    data.follows = data.follows.filter((f) => !(f.followerId === userId && f.followeeId === peerId));
    if (data.follows.length === before) return { ok: false as const, error: "Follow یافت نشد.", status: 404 };
    bumpRel(data, userId, peerId);
    bumpDiscoveryCaches(data);
    enqueueGraphEvent(data, "unfollow", userId, peerId);
    return { ok: true as const };
  });
}

function graphPeople(data: StoreData, viewerId: string, ids: string[]) {
  return ids
    .map((id) => data.users.find((u) => u.id === id && u.status === "active"))
    .filter(Boolean)
    .filter((u) => !pairBlocked(data, viewerId, u!.id))
    .map((u) => publicProfile(u!, viewerId));
}

export async function listSocialGraph(
  viewerId: string,
  targetId: string,
  which: "followers" | "following" | "friends",
  opts: { offset?: number; limit?: number; cursor?: string } = {},
) {
  const data = await readStoreSnapshot();
  const target = data.users.find((u) => u.id === targetId && u.status === "active");
  if (!target) return { ok: false as const, error: "کاربر یافت نشد.", status: 404 as const };
  if (pairBlocked(data, viewerId, targetId) && viewerId !== targetId) {
    return { ok: false as const, error: "در دسترس نیست.", status: 404 as const };
  }
  const own = viewerId === targetId;
  const limit = Math.min(40, Math.max(1, opts.limit ?? 30));
  const offset = Math.max(0, opts.offset ?? 0);
  function page(ids: string[]) {
    const people = graphPeople(data, viewerId, ids);
    const start = opts.cursor ? Math.max(0, people.findIndex((p) => p.id === opts.cursor) + 1) : offset;
    const slice = people.slice(start, start + limit);
    const last = slice[slice.length - 1];
    return {
      people: slice,
      hasMore: start + slice.length < people.length,
      nextCursor: start + slice.length < people.length && last ? last.id : null,
      total: people.length,
    };
  }
  if (which === "friends") {
    if (!own && !canSeeFriendList(target, viewerId)) {
      const count = canSeeFriendCount(target, viewerId) ? (target.friendIds ?? []).length : null;
      return {
        ok: true as const,
        hidden: true as const,
        people: [] as ReturnType<typeof publicProfile>[],
        friendCount: count,
        hasMore: false,
        nextCursor: null,
        total: 0,
      };
    }
    const paged = page(target.friendIds ?? []);
    return { ok: true as const, hidden: false as const, ...paged, friendCount: paged.total };
  }
  if (which === "followers") {
    if (!own && target.hideFollowers) {
      return { ok: true as const, hidden: true as const, people: [] as ReturnType<typeof publicProfile>[], hasMore: false, nextCursor: null, total: 0 };
    }
    const ids = (data.follows ?? []).filter((f) => f.followeeId === targetId && f.status !== "blocked").map((f) => f.followerId);
    return { ok: true as const, hidden: false as const, ...page(ids) };
  }
  if (!own && target.hideFollowing) {
    return { ok: true as const, hidden: true as const, people: [] as ReturnType<typeof publicProfile>[], hasMore: false, nextCursor: null, total: 0 };
  }
  const ids = (data.follows ?? []).filter((f) => f.followerId === targetId && f.status !== "blocked").map((f) => f.followeeId);
  return { ok: true as const, hidden: false as const, ...page(ids) };
}

export async function muteUser(userId: string, peerId: string, muted: boolean) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    const key = peerId.trim();
    if (!key || key === userId) return { ok: false as const, error: "کاربر نامعتبر است.", status: 400 };
    if (muted) {
      if (!me.mutedPeerKeys.includes(key)) me.mutedPeerKeys.push(key);
      for (const c of data.contacts) {
        if (c.ownerUserId === userId && c.nixoUserId === key) c.mutedUntil = Date.now() + 10 * 365 * 24 * 60 * 60_000;
      }
    } else {
      me.mutedPeerKeys = me.mutedPeerKeys.filter((id) => id !== key);
      for (const c of data.contacts) {
        if (c.ownerUserId === userId && c.nixoUserId === key) c.mutedUntil = null;
      }
    }
    bumpRel(data, userId);
    bumpDiscoveryCaches(data);
    return { ok: true as const, mutedPeerKeys: me.mutedPeerKeys, blocked: me.blockedPeerKeys.includes(key) };
  });
}

export async function clearMyContacts(userId: string) {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    data.contacts = (data.contacts ?? []).filter((c) => c.ownerUserId !== userId);
    me.contactIds = [];
    bumpDiscoveryCaches(data);
    return { ok: true as const };
  });
}

export async function suggestions(userId: string) {
  const data = await readStoreSnapshot();
  const me = data.users.find((u) => u.id === userId);
  if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
  const mine = new Set(
    data.contacts.filter((c) => c.ownerUserId === userId && c.nixoUserId).map((c) => c.nixoUserId as string),
  );
  const hidden = new Set([...(me.hideSuggestionIds ?? []), ...(me.notInterestedUserIds ?? []), ...(me.friendIds ?? [])]);
  const myFriends = new Set(me.friendIds ?? []);
  const myGroups = new Set(
    (data.groups ?? []).filter((g) => !g.deletedAt && g.members.some((m) => m.key === userId && !m.leftAt)).map((g) => g.id),
  );
  const scored: { id: string; username: string | null; displayName: string; reason: string; score: number }[] = [];
  for (const u of data.users) {
    if (u.id === userId || u.status !== "active") continue;
    if ((u.accountStatus ?? "active") !== "active") continue;
    if (mine.has(u.id) || me.contactIds.includes(u.id) || hidden.has(u.id)) continue;
    if (pairBlocked(data, userId, u.id)) continue;
    let score = 0;
    let reason = "";
    const mutual = (u.friendIds ?? []).filter((id) => myFriends.has(id)).length;
    if (mutual > 0 && canSeeFriendList(u, userId)) {
      score += Math.min(5, mutual) * 3;
      reason = "mutual-friends";
    }
    if (me.syncedContactHashes.includes(u.identifierHash) && audienceAllows(u.privacyFindPhone, u.contactIds, u.findPhoneAllowIds, userId)) {
      score += 8;
      reason = reason || "contacts";
    }
    const sharedGroup = (data.groups ?? []).some(
      (g) => !g.deletedAt && myGroups.has(g.id) && g.joinMode === "open" && g.members.some((m) => m.key === u.id && !m.leftAt),
    );
    if (sharedGroup) {
      score += 2;
      reason = reason || "mutual-groups";
    }
    const contacted = data.contacts.some((c) => c.ownerUserId === userId && c.nixoUserId === u.id && c.lastContactedAt > 0);
    if (contacted) {
      score += 1;
      reason = reason || "interaction";
    }
    if (score <= 0) continue;
    scored.push({
      id: u.id,
      username: u.username ?? null,
      displayName: u.displayName || u.username || "کاربر",
      reason,
      score,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return {
    ok: true as const,
    suggestions: scored.slice(0, SUGGESTION_CAP).map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      reason: row.reason,
    })),
  };
}

export async function hideSuggestion(userId: string, peerId: string, mode: "hide" | "not-interested") {
  return mutateStore((data) => {
    const me = data.users.find((u) => u.id === userId);
    if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
    const id = peerId.trim();
    if (!id || id === userId) return { ok: false as const, error: "نامعتبر.", status: 400 };
    if (mode === "not-interested") {
      me.notInterestedUserIds = [id, ...(me.notInterestedUserIds ?? []).filter((x) => x !== id)].slice(0, 200);
    } else {
      me.hideSuggestionIds = [id, ...(me.hideSuggestionIds ?? []).filter((x) => x !== id)].slice(0, 200);
    }
    bumpRel(data, userId);
    return { ok: true as const, hideSuggestionIds: me.hideSuggestionIds, notInterestedUserIds: me.notInterestedUserIds };
  });
}

export async function exportMine(userId: string) {
  const listed = await listContacts(userId);
  if (!listed.ok) return listed;
  return {
    ok: true as const,
    exportedAt: Date.now(),
    contacts: listed.contacts.map((c) => ({
      name: c.nickname || c.name,
      phone: c.phone,
      email: c.email,
      username: c.username,
      notes: c.notes,
      labels: c.labels,
      group: c.group,
      custom: c.custom,
      nickname: c.nickname,
    })),
  };
}

export async function importMine(userId: string, rows: unknown[]) {
  let added = 0;
  for (const raw of rows.slice(0, 200)) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    const name = String(rec.name ?? rec.fn ?? "").trim();
    if (!name) continue;
    const saved = await saveContact(userId, {
      name,
      phone: String(rec.phone ?? rec.tel ?? ""),
      email: String(rec.email ?? ""),
      username: String(rec.username ?? ""),
      notes: String(rec.notes ?? ""),
    });
    if (saved.ok) added += 1;
  }
  return { ok: true as const, added };
}

export async function contactCard(userId: string, contactId: string, fields: string[]) {
  const data = await readStoreSnapshot();
  const row = owned(data, userId, contactId);
  if (!row) return { ok: false as const, error: "مخاطب یافت نشد.", status: 404 };
  const allow = new Set(fields);
  const card: Record<string, string> = { name: row.name };
  if (allow.has("phone")) card.phone = row.phone;
  if (allow.has("email")) card.email = row.email;
  if (allow.has("username")) card.username = row.username;
  return { ok: true as const, card, vcard: vcardOf(card) };
}

function vcardOf(card: Record<string, string>) {
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${card.name ?? ""}`];
  if (card.phone) lines.push(`TEL:${card.phone}`);
  if (card.email) lines.push(`EMAIL:${card.email}`);
  if (card.username) lines.push(`X-NIXO-USERNAME:${card.username}`);
  lines.push("END:VCARD");
  return lines.join("\n");
}

export async function touchContacted(userId: string, nixoUserId: string) {
  return mutateStore((data) => {
    const now = Date.now();
    for (const c of data.contacts) {
      if (c.ownerUserId === userId && c.nixoUserId === nixoUserId) c.lastContactedAt = now;
    }
    return { ok: true as const };
  });
}

export async function startChatFromContact(userId: string, contactId?: string, peerId?: string) {
  const data = await readStoreSnapshot();
  let target = peerId ?? "";
  if (contactId) {
    const row = owned(data, userId, contactId);
    if (!row) return { ok: false as const, error: "مخاطب یافت نشد.", status: 404 };
    if (!row.nixoUserId) return { ok: false as const, error: "این مخاطب هنوز حساب نیکسو ندارد.", status: 400 };
    target = row.nixoUserId;
  }
  const opened = await openDm(userId, target);
  if (!opened.ok) {
    if (opened.status === 403) {
      const req = await sendRequest(userId, target);
      if (req.ok) return { ok: false as const, error: "پیام مستقیم محدود است. درخواست ارتباط ارسال شد.", status: 403, requestId: req.requestId };
    }
    return opened;
  }
  await touchContacted(userId, target);
  return opened;
}

export async function blockPerson(userId: string, peerKey: string, blocked: boolean) {
  const result = await setBlockedPeer(userId, peerKey, blocked);
  if (result.ok) {
    await mutateStore((data) => {
      enqueueGraphEvent(data, blocked ? "block" : "unblock", userId, peerKey);
    });
  }
  return result;
}

export async function relationshipSync(userId: string) {
  const listed = await listContacts(userId);
  if (!listed.ok) return listed;
  const graphFriends = await listSocialGraph(userId, userId, "friends", { limit: 40 });
  const followers = await listSocialGraph(userId, userId, "followers", { limit: 40 });
  const following = await listSocialGraph(userId, userId, "following", { limit: 40 });
  const data = await readStoreSnapshot();
  const me = data.users.find((u) => u.id === userId);
  return {
    ok: true as const,
    relationshipRev: listed.relationshipRev,
    friendCount: listed.friendCount,
    friends: graphFriends.ok ? graphFriends.people : [],
    followers: followers.ok ? followers.people : [],
    following: following.ok ? following.people : [],
    blockedPeerKeys: me?.blockedPeerKeys ?? [],
    mutedPeerKeys: me?.mutedPeerKeys ?? [],
  };
}

export { reportCategorySchema };
