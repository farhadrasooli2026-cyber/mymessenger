import "server-only";
import { decryptText, encryptText, hmacIdentifier, randomId } from "@/lib/crypto-utils";
import { normalizeEmail, normalizePhone } from "@/lib/identifiers";
import { hitRateLimit } from "@/lib/rate-limit";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { ContactGroupKind, ContactRecord, StoreData } from "@/lib/store";
import { audienceAllows, canFindByUsername, pairBlocked, setBlockedPeer } from "@/lib/privacy";
import { publicProfile } from "@/lib/profile";
import { normalizeUsername } from "@/lib/username";
import { openDm } from "@/lib/chat";
import { fileReport, reportCategorySchema } from "@/lib/safety";
import { emitNotification } from "@/lib/notify";

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

function ensureArrays(data: StoreData) {
  data.contacts ??= [];
  data.contactInvites ??= [];
  data.contactRequests ??= [];
  data.contactLists ??= [];
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
  opts: { q?: string; sort?: string; group?: string; favorites?: boolean; recently?: boolean } = {},
) {
  const data = await readStoreSnapshot();
  const me = data.users.find((u) => u.id === userId);
  if (!me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
  ensureArrays(data);
  const needle = (opts.q ?? "").trim().toLowerCase().replace(/^@/, "");
  let rows = data.contacts.filter((c) => c.ownerUserId === userId);
  if (opts.favorites) rows = rows.filter((c) => c.favorite);
  if (opts.group) rows = rows.filter((c) => c.group === opts.group);
  if (needle) {
    rows = rows.filter((c) => {
      const blob = `${c.name} ${c.username} ${c.phone} ${c.email} ${c.labels.join(" ")} ${notesOf(c)}`.toLowerCase();
      return blob.includes(needle);
    });
  }
  if (opts.recently) {
    rows = rows.filter((c) => c.lastContactedAt > 0).sort((a, b) => b.lastContactedAt - a.lastContactedAt);
  } else if (opts.sort === "added") {
    rows.sort((a, b) => b.createdAt - a.createdAt);
  } else if (opts.sort === "contacted") {
    rows.sort((a, b) => b.lastContactedAt - a.lastContactedAt || b.updatedAt - a.updatedAt);
  } else if (opts.sort === "favorites") {
    rows.sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name, "fa"));
  } else {
    rows.sort((a, b) => a.name.localeCompare(b.name, "fa"));
  }
  const duplicates = findDuplicateIds(rows);
  const pending = data.contactRequests.filter((r) => r.toUserId === userId && r.status === "pending");
  const outgoing = data.contactRequests.filter((r) => r.fromUserId === userId && r.status === "pending");
  return {
    ok: true as const,
    contacts: rows.map(publicContact),
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
    permission: me.contactOsPermission,
    syncEnabled: me.contactSyncEnabled,
    autoSync: Boolean(me.contactAutoSync),
    notifyJoin: me.contactNotifyJoin,
    syncStatus: me.contactSyncStatus ?? "idle",
    syncError: me.contactSyncError ?? "",
    lastSyncAt: me.contactLastSyncAt ?? 0,
    lists: (data.contactLists ?? []).filter((l) => l.ownerUserId === userId),
  };
}

function requestView(data: StoreData, r: StoreData["contactRequests"][number], viewerId: string) {
  const otherId = r.fromUserId === viewerId ? r.toUserId : r.fromUserId;
  const other = data.users.find((u) => u.id === otherId);
  return {
    id: r.id,
    fromUserId: r.fromUserId,
    toUserId: r.toUserId,
    status: r.status,
    createdAt: r.createdAt,
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
      row.updatedAt = now;
      row.deviceStamp = String(patch.deviceStamp ?? row.deviceStamp ?? "").slice(0, 80);
      row.nixoUserId = linkNixoUser(data, userId, row.phone, row.email, row.username);
      addToContactIds(data, userId, row.nixoUserId);
      return { ok: true as const, contact: publicContact(row) };
    }
    if (!name) return { ok: false as const, error: "نام مخاطب لازم است.", status: 400 };
    const phone = patch.phone ? (normalizePhone(patch.phone) ?? patch.phone.trim().slice(0, 32)) : "";
    const email = patch.email ? (normalizeEmail(patch.email) ?? patch.email.trim().slice(0, 80)) : "";
    const username = patch.username ? (normalizeUsername(patch.username) ?? patch.username.replace(/^@/, "").trim()).toLowerCase() : "";
    const row: ContactRecord = {
      id: randomId(),
      ownerUserId: userId,
      nixoUserId: linkNixoUser(data, userId, phone, email, username),
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
      mutedUntil: null,
      matchHash: "",
    };
    if (patch.notes) setNotes(row, patch.notes);
    data.contacts.push(row);
    addToContactIds(data, userId, row.nixoUserId);
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
    const still = data.users.find((u) => u.id === linked);
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
  return {
    ok: true as const,
    profile,
    mutualGroups,
    mutualChannels,
    sharedMedia,
    localContact: mine ? publicContact(mine) : null,
    qrPayload: { t: "nixo-contact", u: target.username },
    othersContactsHidden: true,
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
      expiresAt: ttlMs && ttlMs > 0 ? now + Math.min(ttlMs, 30 * 24 * 60 * 60_000) : null,
      createdAt: now,
    };
    data.contactInvites.push(invite);
    return { ok: true as const, invite: { token: invite.token, maxUses: invite.maxUses, expiresAt: invite.expiresAt, path: `/join/invite/${invite.token}` } };
  });
}

export async function previewInvite(token: string) {
  const data = await readStoreSnapshot();
  const invite = data.contactInvites.find((i) => i.token === token);
  if (!invite) return { ok: false as const, error: "لینک دعوت نامعتبر است.", status: 404 };
  const now = Date.now();
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
    if (invite.expiresAt && invite.expiresAt < now) return { ok: false as const, error: "لینک دعوت منقضی شده است.", status: 410 };
    if (invite.maxUses !== null && invite.uses >= invite.maxUses) return { ok: false as const, error: "سقف استفاده از لینک پر شده است.", status: 410 };
    if (invite.ownerUserId === userId) return { ok: false as const, error: "نمی‌توانید دعوت خودتان را بپذیرید.", status: 400 };
    invite.uses += 1;
    const owner = data.users.find((u) => u.id === invite.ownerUserId);
    const me = data.users.find((u) => u.id === userId);
    if (!owner || !me) return { ok: false as const, error: "حساب فعال نیست.", status: 401 };
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
    if (pairBlocked(data, userId, targetId)) return { ok: false as const, error: "ارتباط مسدود است.", status: 403 };
    const target = data.users.find((u) => u.id === targetId && u.status === "active");
    if (!target) return { ok: false as const, error: "کاربر یافت نشد.", status: 404 };
    const existing = data.contactRequests.find(
      (r) => r.status === "pending" && ((r.fromUserId === userId && r.toUserId === targetId) || (r.fromUserId === targetId && r.toUserId === userId)),
    );
    if (existing) return { ok: true as const, requestId: existing.id };
    const row = {
      id: randomId(),
      fromUserId: userId,
      toUserId: targetId,
      status: "pending" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    data.contactRequests.push(row);
    emitNotification(data, {
      userId: targetId,
      category: "system",
      kind: "contact-request",
      title: "درخواست ارتباط",
      body: "یک کاربر نیکسو می‌خواهد با تو ارتباط بگیرد.",
      sourceId: `req:${row.id}`,
      target: { type: "system", id: row.id, href: "/app/contacts" },
    });
    return { ok: true as const, requestId: row.id };
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
      req.status = "declined";
      req.updatedAt = Date.now();
      const me = data.users.find((u) => u.id === userId);
      if (me && !me.blockedPeerKeys.includes(req.fromUserId)) me.blockedPeerKeys.push(req.fromUserId);
      return { ok: true as const };
    }
    if (action === "decline" || action === "report") {
      if (req.toUserId !== userId) return { ok: false as const, error: "اجازه نیست.", status: 403 };
      req.status = "declined";
      req.updatedAt = Date.now();
      return { ok: true as const };
    }
    if (req.toUserId !== userId) return { ok: false as const, error: "اجازه نیست.", status: 403 };
    req.status = "accepted";
    req.updatedAt = Date.now();
    addToContactIds(data, userId, req.fromUserId);
    addToContactIds(data, req.fromUserId, userId);
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
  const suggested = data.users.filter((u) => {
    if (u.id === userId || u.status !== "active") return false;
    if (mine.has(u.id) || me.contactIds.includes(u.id)) return false;
    if (pairBlocked(data, userId, u.id)) return false;
    if (!me.syncedContactHashes.includes(u.identifierHash)) return false;
    return audienceAllows(u.privacyFindPhone, u.contactIds, u.findPhoneAllowIds, userId);
  });
  return {
    ok: true as const,
    suggestions: suggested.slice(0, 20).map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName || u.username || "کاربر",
    })),
  };
}

export async function exportMine(userId: string) {
  const listed = await listContacts(userId);
  if (!listed.ok) return listed;
  return {
    ok: true as const,
    exportedAt: Date.now(),
    contacts: listed.contacts.map((c) => ({
      name: c.name,
      phone: c.phone,
      email: c.email,
      username: c.username,
      notes: c.notes,
      labels: c.labels,
      group: c.group,
      custom: c.custom,
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
  if (!result.ok) return result;
  if (blocked) {
    await mutateStore((data) => {
      for (const r of data.contactRequests ?? []) {
        if (r.status === "pending" && ((r.fromUserId === userId && r.toUserId === peerKey) || (r.toUserId === userId && r.fromUserId === peerKey))) {
          r.status = "declined";
          r.updatedAt = Date.now();
        }
      }
      return true;
    });
  }
  return result;
}

export { reportCategorySchema };
