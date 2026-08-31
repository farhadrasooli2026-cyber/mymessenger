import "server-only";
import { z } from "zod";
import { config } from "@/lib/config";
import { randomId } from "@/lib/crypto-utils";
import { DEFAULT_AVATAR_SVG, svgDataUri } from "@/lib/default-avatar";
import { deleteUserPhoto, decodeDataUrl, saveUserPhoto } from "@/lib/photo-files";
import type { Visibility } from "@/lib/profile-types";
import { seedInbox } from "@/lib/chat";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { UserRecord } from "@/lib/store";
import { normalizeUsername } from "@/lib/username";

export const visibilitySchema = z.enum(["everyone", "contacts", "nobody", "selected"]);

export const profileInputSchema = z.object({
  firstName: z.string().trim().min(1).max(40),
  lastName: z.string().trim().max(40).optional().default(""),
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
  const photoVisible = own || canSee(user.privacyPhoto, user.photoAllowIds, user.contactIds, viewerId);
  const bioVisible = own || canSee(user.privacyBio, user.bioAllowIds, user.contactIds, viewerId);
  return {
    id: user.id,
    status: user.status,
    channel: user.channel,
    identifierMasked: own ? user.identifierMasked : undefined,
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
    displayName: fullName(user.firstName ?? user.displayName ?? "کاربر نیکسو", user.lastName),
    username: user.username ?? null,
    bio: bioVisible ? (user.bio ?? "") : "",
    bioHidden: !bioVisible,
    photoUrl: photoVisible ? photoUrlFor(user) : svgDataUri(DEFAULT_AVATAR_SVG),
    photoHidden: !photoVisible,
    photoKind: user.photo.kind,
    privacyPhoto: own ? user.privacyPhoto : undefined,
    privacyBio: own ? user.privacyBio : undefined,
    photoAllowIds: own ? user.photoAllowIds : undefined,
    bioAllowIds: own ? user.bioAllowIds : undefined,
    verifiedAt: user.verifiedAt ?? null,
    activatedAt: user.activatedAt ?? null,
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

function canSee(
  visibility: Visibility,
  allowIds: string[],
  contactIds: string[],
  viewerId?: string | null,
): boolean {
  if (visibility === "everyone") return true;
  if (visibility === "nobody") return false;
  if (!viewerId) return false;
  if (visibility === "contacts") return contactIds.includes(viewerId);
  return allowIds.includes(viewerId);
}

export async function checkUsername(raw: string, selfId?: string) {
  const username = normalizeUsername(raw);
  if (!username) {
    return { ok: false as const, available: false, reason: "invalid" as const, username: null };
  }
  const data = await readStoreSnapshot();
  const taken = data.users.some((u) => u.username === username && u.id !== selfId);
  return { ok: true as const, available: !taken, username, reason: taken ? ("taken" as const) : ("free" as const) };
}

export async function completeProfile(userId: string, input: ProfileInput) {
  const usernameCheck = await checkUsername(input.username, userId);
  if (!usernameCheck.username || !usernameCheck.available) {
    return { ok: false as const, status: 409, error: "این نام کاربری در دسترس نیست." };
  }
  if (input.photo?.kind === "upload" && input.photo.dataUrl) {
    const buf = decodeDataUrl(input.photo.dataUrl);
    if (!buf) return { ok: false as const, status: 400, error: "فایل عکس معتبر نیست." };
    await saveUserPhoto(userId, buf);
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
    await saveUserPhoto(userId, buf);
  }
  if (input.photo?.kind === "default") {
    await deleteUserPhoto(userId);
  }

  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (!user || user.status !== "active") {
      return { ok: false as const, status: 401, error: "حساب فعال نیست." };
    }
    if (input.username && input.username !== user.username) {
      const next = normalizeUsername(input.username);
      if (!next) return { ok: false as const, status: 400, error: "نام کاربری معتبر نیست." };
      if (data.users.some((u) => u.username === next && u.id !== userId)) {
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
      user.usernameHistory.push({ from: user.username ?? "", to: next, at: now });
      user.username = next;
      user.usernameChangedAt = now;
    }
    if (input.firstName !== undefined) user.firstName = input.firstName.trim();
    if (input.lastName !== undefined) user.lastName = input.lastName.trim();
    if (input.bio !== undefined) user.bio = input.bio.trim();
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
  const data = await readStoreSnapshot();
  return data.users
    .filter((u) => u.status === "active" && u.username && u.username.includes(q) && u.id !== viewerId)
    .slice(0, 12)
    .map((u) => publicProfile(u, viewerId));
}

export async function addContact(userId: string, otherId: string) {
  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const };
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
