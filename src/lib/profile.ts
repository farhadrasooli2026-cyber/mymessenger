import "server-only";
import { z } from "zod";
import { config } from "@/lib/config";
import { randomId } from "@/lib/crypto-utils";
import { DEFAULT_AVATAR_SVG, svgDataUri } from "@/lib/default-avatar";
import { deleteUserPhoto, decodeDataUrl, saveUserPhoto, validateAvatarBuffer } from "@/lib/photo-files";
import { seedInbox } from "@/lib/chat";
import { bumpDiscoveryCaches, mutateStore, readStoreSnapshot } from "@/lib/store";
import type { UserRecord } from "@/lib/store";
import { normalizeUsername, usernameIssue } from "@/lib/username";
import { audienceAllows, canFindByUsername } from "@/lib/privacy";
import { hitRateLimit } from "@/lib/rate-limit";
import { appendAudit } from "@/lib/security";

export const visibilitySchema = z.enum(["everyone", "contacts", "friends", "nobody", "selected"]);

export const profileInputSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .refine((s) => !/[\u0000-\u001f]/.test(s), "نام نامعتبر است."),
  lastName: z
    .string()
    .trim()
    .max(40)
    .optional()
    .default("")
    .refine((s) => !/[\u0000-\u001f]/.test(s), "نام نامعتبر است."),
  username: z.string().min(3).max(24),
  bio: z.string().trim().max(140).optional().default(""),
  photo: z
    .object({
      kind: z.enum(["default", "upload", "catalog"]),
      catalogId: z.string().optional(),
      dataUrl: z.string().max(1_400_000).optional(),
    })
    .optional(),
  privacyPhoto: visibilitySchema.default("everyone"),
  privacyBio: visibilitySchema.default("everyone"),
  photoAllowIds: z.array(z.string()).max(200).optional().default([]),
  bioAllowIds: z.array(z.string()).max(200).optional().default([]),
});

export type ProfileInput = z.infer<typeof profileInputSchema>;

function fullName(first: string, last?: string) {
  return [first, last].filter(Boolean).join(" ").trim();
}

export function publicProfile(user: UserRecord, viewerId?: string | null) {
  const own = viewerId === user.id;
  const blocked = Boolean(viewerId && viewerId !== user.id && (user.blockedPeerKeys.includes(viewerId)));
  const photoVisible = own || (!blocked && audienceAllows(user.privacyPhoto, user.contactIds, user.photoAllowIds, viewerId, user.friendIds));
  const bioVisible = own || (!blocked && audienceAllows(user.privacyBio, user.contactIds, user.bioAllowIds, viewerId, user.friendIds));
  const phoneVisible =
    own || (!blocked && user.channel === "phone" && audienceAllows(user.privacyPhone, user.contactIds, user.phoneAllowIds, viewerId, user.friendIds));
  const emailVisible =
    own || (!blocked && user.channel === "email" && audienceAllows(user.privacyEmail, user.contactIds, user.emailAllowIds, viewerId, user.friendIds));
  const lastSeenVisible =
    own || (!blocked && audienceAllows(user.privacyLastSeen, user.contactIds, user.lastSeenAllowIds, viewerId, user.friendIds));
  const onlineVisible =
    own || (!blocked && audienceAllows(user.privacyOnline, user.contactIds, user.onlineAllowIds, viewerId, user.friendIds));
  const statusLive = !user.statusExpiresAt || user.statusExpiresAt > Date.now();
  const statusVisible =
    own ||
    (!blocked &&
      statusLive &&
      audienceAllows(user.statusPrivacy, user.contactIds, user.statusAllowIds, viewerId, user.friendIds));
  return {
    id: user.id,
    status: user.status,
    channel: own || phoneVisible || emailVisible ? user.channel : undefined,
    identifierMasked: own || phoneVisible || emailVisible ? user.identifierMasked : undefined,
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
    displayName: fullName(user.firstName ?? user.displayName ?? "کاربر نیکسو", user.lastName),
    username: user.username ?? null,
    bio: bioVisible ? (user.bio ?? "") : "",
    bioHidden: !bioVisible,
    photoUrl: photoVisible ? photoUrlFor(user) : svgDataUri(DEFAULT_AVATAR_SVG),
    photoThumbUrl: photoVisible ? photoThumbUrlFor(user) : svgDataUri(DEFAULT_AVATAR_SVG),
    photoHidden: !photoVisible,
    photoKind: user.photo.kind,
    privacyPhoto: own ? user.privacyPhoto : undefined,
    privacyBio: own ? user.privacyBio : undefined,
    photoAllowIds: own ? user.photoAllowIds : undefined,
    bioAllowIds: own ? user.bioAllowIds : undefined,
    verifiedAt: user.verifiedAt ?? null,
    activatedAt: user.activatedAt ?? null,
    appearance: own ? (user.appearance ?? undefined) : undefined,
    cryptoPublicKey: own ? (user.cryptoPublicKey ?? null) : undefined,
    blockedPeerKeys: own ? user.blockedPeerKeys : undefined,
    callPrivacy: own ? (user.callPrivacy ?? "everyone") : undefined,
    hideCallOnLockScreen: own ? Boolean(user.hideCallOnLockScreen) : undefined,
    lowDataCalls: own ? Boolean(user.lowDataCalls) : undefined,
    lastSeenAt: lastSeenVisible ? user.lastSeenAt || null : null,
    online: onlineVisible && user.lastSeenAt > 0 && Date.now() - user.lastSeenAt < 90_000,
    readReceipts: user.readReceipts,
    verified: Boolean(user.officialVerified),
    statusPreset: statusVisible ? user.statusPreset : "",
    statusText: statusVisible ? (user.statusText ?? "") : "",
    statusExpiresAt: own ? user.statusExpiresAt : undefined,
    restrictForward: user.restrictForward,
    restrictSave: user.restrictSave,
    restrictShare: user.restrictShare,
    showTyping: own ? user.showTyping : undefined,
    accountStatus: own ? (user.accountStatus ?? "active") : undefined,
    deletionRequestedAt: own ? user.deletionRequestedAt : undefined,
    deletionFinalizeAt: own ? (user.deletionFinalizeAt ?? null) : undefined,
  };
}

function photoUrlFor(user: UserRecord): string {
  if (user.photo.kind === "catalog" && user.photo.catalogId) {
    return `/api/media/catalog/${user.photo.catalogId}`;
  }
  if (user.photo.kind === "upload") {
    return `/api/media/photo/${user.id}`;
  }
  return svgDataUri(DEFAULT_AVATAR_SVG);
}

function photoThumbUrlFor(user: UserRecord): string {
  if (user.photo.kind === "catalog" && user.photo.catalogId) {
    return `/api/media/catalog/${user.photo.catalogId}`;
  }
  if (user.photo.kind === "upload") {
    return `/api/media/photo/${user.id}?thumb=1`;
  }
  return svgDataUri(DEFAULT_AVATAR_SVG);
}

const PROFILE_FORBIDDEN = ["porn", "nazi", "terror", "http://", "https://"];

function moderateText(raw: string, kind: "name" | "bio") {
  const t = raw.trim();
  const lower = t.toLowerCase();
  if (PROFILE_FORBIDDEN.some((w) => lower.includes(w))) {
    return { ok: false as const, error: kind === "bio" ? "این بیو مجاز نیست." : "این نام مجاز نیست." };
  }
  return { ok: true as const, text: t };
}

export async function checkUsername(raw: string, selfId?: string) {
  return mutateStore((data) => {
    const now = Date.now();
    if (selfId) {
      const flood = hitRateLimit(data, `uname:${selfId}`, 60_000, 30, now);
      if (!flood.allowed) {
        return { ok: false as const, available: false, reason: "limited" as const, username: null, status: 429 };
      }
    }
    const issue = usernameIssue(raw);
    const username = raw.trim().replace(/^@/, "").toLowerCase();
    if (issue === "invalid") {
      return { ok: false as const, available: false, reason: "invalid" as const, username: null };
    }
    if (issue === "reserved") {
      return { ok: false as const, available: false, reason: "reserved" as const, username: null };
    }
    data.usernameHolds = (data.usernameHolds ?? []).filter((h) => h.until > now);
    if ((data.reservedUsernames ?? []).some((r) => r.toLowerCase() === username)) {
      return { ok: true as const, available: false, reason: "reserved" as const, username };
    }
    const held = data.usernameHolds.some((h) => h.username === username && h.fromUserId !== selfId);
    const takenUser = data.users.some((u) => u.username === username && u.id !== selfId && u.status === "active");
    const takenBot = (data.bots ?? []).some((b) => b.username === username && b.status !== "deleted");
    const takenBiz = (data.businesses ?? []).some((b) => b.username === username);
    const taken = held || takenUser || takenBot || takenBiz;
    return { ok: true as const, available: !taken, username, reason: taken ? ("taken" as const) : ("free" as const) };
  });
}

export async function completeProfile(userId: string, input: ProfileInput) {
  const usernameCheck = await checkUsername(input.username, userId);
  if (!usernameCheck.username || !usernameCheck.available) {
    return { ok: false as const, status: 409, error: "این نام کاربری در دسترس نیست." };
  }
  if (input.photo?.kind === "upload" && input.photo.dataUrl) {
    const buf = decodeDataUrl(input.photo.dataUrl);
    if (!buf) return { ok: false as const, status: 400, error: "فایل عکس معتبر نیست." };
    const check = validateAvatarBuffer(buf);
    if (!check.ok) return { ok: false as const, status: 400, error: check.error };
    const saved = await saveUserPhoto(userId, buf);
    if (!saved.ok) return { ok: false as const, status: 400, error: saved.error };
  }
  if (input.photo?.kind === "default") {
    await deleteUserPhoto(userId);
  }
  const now = Date.now();
  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, status: 401, error: "نشست ثبت‌نام معتبر نیست." };
    if (!user.verifiedAt) return { ok: false as const, status: 403, error: "ابتدا باید کد تأیید را وارد کنید." };
    if (input.photo?.kind === "catalog") {
      const item = data.catalogItems.find((i) => i.id === input.photo?.catalogId);
      if (!item) return { ok: false as const, status: 400, error: "عکس آماده یافت نشد." };
    }
    applyProfile(user, input, usernameCheck.username!, now, true);
    user.status = "active";
    user.activatedAt = now;
    seedInbox(data, user.id, now);
    return { ok: true as const, status: 200, user: publicProfile(user, userId) };
  });
}

export async function updateProfile(userId: string, input: Partial<ProfileInput> & { username?: string }) {
  const now = Date.now();
  if (input.photo?.kind === "upload" && input.photo.dataUrl) {
    const buf = decodeDataUrl(input.photo.dataUrl);
    if (!buf) return { ok: false as const, status: 400, error: "فایل عکس معتبر نیست." };
    const check = validateAvatarBuffer(buf);
    if (!check.ok) return { ok: false as const, status: 400, error: check.error };
    const saved = await saveUserPhoto(userId, buf);
    if (!saved.ok) return { ok: false as const, status: 400, error: saved.error };
  }
  if (input.photo?.kind === "default") {
    await deleteUserPhoto(userId);
  }

  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (!user || user.status !== "active") {
      return { ok: false as const, status: 401, error: "حساب فعال نیست." };
    }
    const flood = hitRateLimit(data, `prof:${userId}`, 60_000, 24, now);
    if (!flood.allowed) return { ok: false as const, status: 429, error: "ویرایش پروفایل محدود شد." };
    if (input.photo) {
      const av = hitRateLimit(data, `avatar:${userId}`, 60 * 60_000, 10, now);
      if (!av.allowed) return { ok: false as const, status: 429, error: "آپلود عکس محدود شد." };
    }
    if (input.username && input.username !== user.username) {
      const next = normalizeUsername(input.username);
      if (!next) return { ok: false as const, status: 400, error: "نام کاربری معتبر نیست." };
      data.usernameHolds = (data.usernameHolds ?? []).filter((h) => h.until > now);
      const reserved = (data.reservedUsernames ?? []).some((r) => r.toLowerCase() === next);
      const held = data.usernameHolds.some((h) => h.username === next && h.fromUserId !== userId);
      if (reserved || held) return { ok: false as const, status: 409, error: "این نام کاربری در دسترس نیست." };
      if (
        data.users.some((u) => u.username === next && u.id !== userId) ||
        (data.bots ?? []).some((b) => b.username === next && b.status !== "deleted") ||
        (data.businesses ?? []).some((b) => b.username === next)
      ) {
        return { ok: false as const, status: 409, error: "این نام کاربری گرفته شده است." };
      }
      const windowStart = now - 30 * 24 * 60 * 60 * 1000;
      const recent = user.usernameHistory.filter((h) => h.at >= windowStart).length;
      if (recent >= config.username.maxChangesPer30d) {
        return { ok: false as const, status: 429, error: "تعداد تغییر نام کاربری در این ماه به سقف رسیده است." };
      }
      if (user.usernameChangedAt && now - user.usernameChangedAt < config.username.changeCooldownMs) {
        return { ok: false as const, status: 429, error: "برای تغییر دوباره نام کاربری باید صبر کنید." };
      }
      if (user.username && config.username.releaseHoldMs > 0) {
        data.usernameHolds.push({ username: user.username, fromUserId: userId, until: now + config.username.releaseHoldMs });
      }
      user.usernameHistory.push({ from: user.username ?? "", to: next, at: now });
      user.username = next;
      user.usernameChangedAt = now;
      appendAudit(data, userId, "privacy", { detail: "تغییر نام کاربری" });
    }
    if (input.firstName !== undefined) {
      const name = moderateText(input.firstName, "name");
      if (!name.ok) return { ok: false as const, status: 400, error: name.error };
      user.firstName = name.text;
    }
    if (input.lastName !== undefined) {
      const name = moderateText(input.lastName, "name");
      if (!name.ok) return { ok: false as const, status: 400, error: name.error };
      user.lastName = name.text;
    }
    if (input.bio !== undefined) {
      const bio = moderateText(input.bio, "bio");
      if (!bio.ok) return { ok: false as const, status: 400, error: bio.error };
      user.bio = bio.text;
    }
    if (input.privacyPhoto) user.privacyPhoto = input.privacyPhoto;
    if (input.privacyBio) user.privacyBio = input.privacyBio;
    if (input.photoAllowIds) user.photoAllowIds = input.photoAllowIds;
    if (input.bioAllowIds) user.bioAllowIds = input.bioAllowIds;
    if (input.photo) {
      if (input.photo.kind === "catalog") {
        const item = data.catalogItems.find((i) => i.id === input.photo?.catalogId);
        if (!item) return { ok: false as const, status: 400, error: "عکس آماده یافت نشد." };
        user.photo = { kind: "catalog", catalogId: item.id };
      } else if (input.photo.kind === "upload") {
        user.photo = { kind: "upload" };
      } else {
        user.photo = { kind: "default" };
      }
    }
    user.displayName = fullName(user.firstName ?? "", user.lastName);
    bumpDiscoveryCaches(data);
    return { ok: true as const, status: 200, user: publicProfile(user, userId) };
  });
}

function applyProfile(user: UserRecord, input: ProfileInput, username: string, now: number, initial: boolean) {
  user.firstName = input.firstName.trim();
  user.lastName = input.lastName?.trim() ?? "";
  user.displayName = fullName(user.firstName, user.lastName);
  if (initial || !user.username) {
    user.username = username;
    user.usernameChangedAt = now;
  }
  user.bio = input.bio?.trim() ?? "";
  user.privacyPhoto = input.privacyPhoto;
  user.privacyBio = input.privacyBio;
  user.photoAllowIds = input.photoAllowIds ?? [];
  user.bioAllowIds = input.bioAllowIds ?? [];
  if (input.photo?.kind === "catalog" && input.photo.catalogId) {
    user.photo = { kind: "catalog", catalogId: input.photo.catalogId };
  } else if (input.photo?.kind === "upload") {
    user.photo = { kind: "upload" };
  } else if (input.photo?.kind === "default") {
    user.photo = { kind: "default" };
  }
}

export async function searchUsers(query: string, viewerId: string) {
  const q = query.trim().replace(/^@/, "").toLowerCase();
  if (q.length < 2) return [];
  const allowList = q.length >= 3 || query.trim().startsWith("@");
  if (!allowList) return [];
  const data = await readStoreSnapshot();
  return data.users
    .filter((u) => {
      if (u.id === viewerId || !u.username) return false;
      if ((u.accountStatus ?? "active") !== "active") return false;
      if (!canFindByUsername(data, u, viewerId)) return false;
      return u.username.includes(q) || (u.displayName ?? "").toLowerCase().includes(q);
    })
    .slice(0, 12)
    .map((u) => publicProfile(u, viewerId));
}

export async function addContact(userId: string, otherId: string) {
  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId);
    const other = data.users.find((u) => u.id === otherId);
    if (!user || !other) return { ok: false as const, error: "کاربر یافت نشد." };
    if (user.blockedPeerKeys.includes(otherId) || other.blockedPeerKeys.includes(userId)) {
      return { ok: false as const, error: "تعامل با این شخص محدود شده است." };
    }
    if (!user.contactIds.includes(otherId) && otherId !== userId) user.contactIds.push(otherId);
    return { ok: true as const };
  });
}

export async function listCatalog() {
  const data = await readStoreSnapshot();
  return {
    categories: [...data.catalogCategories].sort((a, b) => a.sort - b.sort),
    items: [...data.catalogItems].sort((a, b) => a.sort - b.sort),
  };
}

export async function adminAddCategory(en: string, fa: string) {
  return mutateStore((data) => {
    const id = randomId().slice(0, 8);
    const sort = data.catalogCategories.reduce((m, c) => Math.max(m, c.sort), 0) + 1;
    data.catalogCategories.push({ id, en, fa, sort });
    return { ok: true as const, category: { id, en, fa, sort } };
  });
}

export async function adminAddItem(categoryId: string, title: string, svg: string) {
  return mutateStore((data) => {
    if (!data.catalogCategories.some((c) => c.id === categoryId)) {
      return { ok: false as const, error: "دسته‌بندی یافت نشد." };
    }
    const now = Date.now();
    const item = {
      id: randomId(),
      categoryId,
      title,
      svg,
      sort: data.catalogItems.filter((i) => i.categoryId === categoryId).length + 1,
      createdAt: now,
      updatedAt: now,
    };
    data.catalogItems.push(item);
    return { ok: true as const, item };
  });
}

export async function adminDeleteItem(id: string) {
  return mutateStore((data) => {
    data.catalogItems = data.catalogItems.filter((i) => i.id !== id);
    return { ok: true as const };
  });
}

export async function adminUpdateItem(id: string, patch: { title?: string; categoryId?: string; sort?: number; svg?: string }) {
  return mutateStore((data) => {
    const item = data.catalogItems.find((i) => i.id === id);
    if (!item) return { ok: false as const, error: "عکس یافت نشد." };
    if (patch.title) item.title = patch.title;
    if (patch.categoryId) item.categoryId = patch.categoryId;
    if (typeof patch.sort === "number") item.sort = patch.sort;
    if (patch.svg) item.svg = patch.svg;
    item.updatedAt = Date.now();
    return { ok: true as const, item };
  });
}

export async function getCatalogItem(id: string) {
  const data = await readStoreSnapshot();
  return data.catalogItems.find((i) => i.id === id) ?? null;
}
