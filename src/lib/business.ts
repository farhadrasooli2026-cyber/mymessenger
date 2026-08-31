import "server-only";
import { z } from "zod";
import { hmacIdentifier, randomId } from "@/lib/crypto-utils";
import { hitRateLimit } from "@/lib/rate-limit";
import { decodeDataUrl, saveUserPhoto } from "@/lib/photo-files";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { StoreData } from "@/lib/store";
import { normalizeUsername } from "@/lib/username";
import { runAiEngine } from "@/lib/ai-engine";
import { createStory } from "@/lib/stories";
import {
  ALL_BIZ_PERMS,
  DEFAULT_HOURS,
  emptyStaffPerms,
  ownerPerms,
  type BizPermKey,
  type BizPerms,
  type BusinessCategory,
  type BusinessRecord,
  type BusinessStaff,
  type BizCart,
  type BizMessage,
  type BizOrder,
  type BizProduct,
  type BizQuickReply,
  type BizThread,
  type DayHours,
  type InboxLabel,
  type OrderStatus,
} from "@/lib/business-types";

export const createBusinessSchema = z.object({
  name: z.string().trim().min(2).max(60),
  username: z.string().min(3).max(24),
  category: z.string().min(2).max(24),
  description: z.string().trim().min(8).max(800),
  website: z.string().max(200).optional().default(""),
  phone: z.string().max(40).optional().default(""),
  email: z.string().max(80).optional().default(""),
  address: z.string().max(200).optional().default(""),
  lat: z.number().min(-90).max(90).optional().nullable(),
  lng: z.number().min(-180).max(180).optional().nullable(),
  hours: z.array(z.object({ day: z.number(), closed: z.boolean(), open: z.string(), close: z.string() })).optional(),
  photoDataUrl: z.string().max(1_400_000).optional(),
  welcome: z.string().max(280).optional(),
  away: z.string().max(280).optional(),
  autoReply: z.string().max(280).optional(),
});

function taken(data: StoreData, username: string, exceptBiz?: string) {
  if (data.users.some((u) => u.username === username)) return true;
  if ((data.bots ?? []).some((b) => b.username === username && b.status !== "deleted")) return true;
  return (data.businesses ?? []).some((b) => b.username === username && b.id !== exceptBiz);
}

export function isOpenNow(hours: DayHours[], at = new Date()) {
  const row = hours.find((h) => h.day === at.getDay()) ?? { day: at.getDay(), closed: true, open: "09:00", close: "18:00" };
  if (row.closed) return false;
  const [oh, om] = row.open.split(":").map(Number);
  const [ch, cm] = row.close.split(":").map(Number);
  const mins = at.getHours() * 60 + at.getMinutes();
  return mins >= oh * 60 + om && mins < ch * 60 + cm;
}

export function mapUrl(b: BusinessRecord) {
  if (b.lat != null && b.lng != null) {
    return `https://www.openstreetmap.org/?mlat=${b.lat}&mlon=${b.lng}#map=16/${b.lat}/${b.lng}`;
  }
  if (b.address.trim()) return `https://www.openstreetmap.org/search?query=${encodeURIComponent(b.address)}`;
  return null;
}

function staffOf(data: StoreData, businessId: string, userId: string): BusinessStaff | undefined {
  return (data.bizStaff ?? []).find((s) => s.businessId === businessId && s.userId === userId);
}

export function can(data: StoreData, businessId: string, userId: string, perm: BizPermKey) {
  const biz = (data.businesses ?? []).find((b) => b.id === businessId);
  if (!biz) return false;
  if (biz.ownerUserId === userId) return true;
  const s = staffOf(data, businessId, userId);
  return Boolean(s?.perms[perm]);
}

export function publicBusiness(b: BusinessRecord, extra?: { products?: number }) {
  return {
    id: b.id,
    name: b.name,
    username: b.username,
    category: b.category,
    description: b.description,
    website: b.website,
    phone: b.phone,
    email: b.email,
    address: b.address,
    hours: b.hours,
    open: isOpenNow(b.hours),
    logoUrl: b.logoKind === "upload" ? `/api/media/photo/${b.id}` : null,
    verified: b.verified,
    verification: b.verification,
    mapUrl: mapUrl(b),
    botId: b.botId,
    channelId: b.channelId,
    createdAt: b.createdAt,
    productCount: extra?.products,
    welcome: b.welcome,
    away: b.away,
    autoReply: b.autoReply,
  };
}

function customerPublic(data: StoreData, customerId: string) {
  const u = data.users.find((x) => x.id === customerId);
  return { id: customerId, displayName: u?.displayName || u?.username || "مشتری", username: u?.username ?? null };
}

export async function createBusiness(userId: string, input: z.infer<typeof createBusinessSchema>) {
  const username = normalizeUsername(input.username);
  if (!username) return { ok: false as const, status: 400, error: "نام کاربری کسب‌وکار معتبر نیست." };
  if (input.website && input.website.trim() && !/^https:\/\//i.test(input.website.trim())) {
    return { ok: false as const, status: 400, error: "Website باید با https:// شروع شود." };
  }
  let photo: Buffer | null = null;
  if (input.photoDataUrl) {
    photo = decodeDataUrl(input.photoDataUrl);
    if (!photo) return { ok: false as const, status: 400, error: "لوگو معتبر نیست." };
  }
  const id = randomId();
  const created = await mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId && u.status === "active");
    if (!user) return { ok: false as const, status: 401, error: "حساب فعال نیست." };
    if ((data.businesses ?? []).some((b) => b.ownerUserId === userId)) {
      return { ok: false as const, status: 409, error: "همین حساب قبلاً Business شده است. حساب جدا لازم نیست." };
    }
    if (taken(data, username)) return { ok: false as const, status: 409, error: "این @username گرفته شده." };
    const cats = ["restaurant", "clothing", "electronics", "education", "technology", "beauty", "travel", "services", "other"];
    if (!cats.includes(input.category)) return { ok: false as const, status: 400, error: "دسته‌بندی معتبر نیست." };
    const biz: BusinessRecord = {
      id,
      ownerUserId: userId,
      name: input.name.trim(),
      username,
      category: input.category as BusinessCategory,
      description: input.description.trim(),
      website: (input.website ?? "").trim(),
      phone: (input.phone ?? "").trim(),
      email: (input.email ?? "").trim(),
      address: (input.address ?? "").trim(),
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      hours: input.hours?.length === 7 ? input.hours : DEFAULT_HOURS,
      logoKind: photo ? "upload" : "default",
      welcome: input.welcome?.trim() || "سلام، به کسب‌وکار نیکسو خوش آمدید.",
      away: input.away?.trim() || "الان خارج از ساعت کاری هستیم. پیام‌تان می‌ماند.",
      autoReply: input.autoReply?.trim() || "پیام شما دریافت شد. در اولین فرصت پاسخ می‌دهیم.",
      botId: null,
      channelId: null,
      verified: false,
      verification: "none",
      verificationHash: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      views: 0,
    };
    data.businesses ??= [];
    data.bizStaff ??= [];
    data.businesses.push(biz);
    data.bizStaff.push({
      businessId: id,
      userId,
      role: "owner",
      perms: ownerPerms(),
      name: user.displayName || user.username || "مالک",
    });
    return { ok: true as const, business: publicBusiness(biz) };
  });
  if (created.ok && photo) await saveUserPhoto(id, photo);
  return created;
}

export async function listBusinesses(q = "", category?: string) {
  const data = await readStoreSnapshot();
  const n = q.replace(/^@/, "").toLowerCase();
  return (data.businesses ?? [])
    .filter((b) => !n || `${b.name} ${b.username} ${b.description}`.toLowerCase().includes(n))
    .filter((b) => !category || b.category === category)
    .map((b) => publicBusiness(b, { products: (data.bizProducts ?? []).filter((p) => p.businessId === b.id).length }));
}

export async function getBusiness(idOrUser: string, viewerId?: string | null) {
  const data = await readStoreSnapshot();
  const b = (data.businesses ?? []).find((x) => x.id === idOrUser || x.username === idOrUser.replace(/^@/, "") || x.ownerUserId === idOrUser);
  if (!b) return null;
  if (viewerId && viewerId !== b.ownerUserId) {
    await mutateStore((d) => {
      const row = d.businesses.find((x) => x.id === b.id);
      if (row) row.views += 1;
    });
  }
  const products = (data.bizProducts ?? []).filter((p) => p.businessId === b.id);
  const mine = viewerId ? staffOf(data, b.id, viewerId) : undefined;
  return {
    business: publicBusiness(b, { products: products.length }),
    products: products.map(publicProduct),
    isStaff: Boolean(mine),
    role: mine?.role ?? null,
    perms: mine?.perms ?? null,
  };
}

function publicProduct(p: BizProduct) {
  return {
    id: p.id,
    kind: p.kind,
    name: p.name,
    description: p.description,
    price: p.price,
    currency: p.currency,
    stock: p.stock,
    available: p.stock === null || p.stock > 0,
    category: p.category,
    code: p.code,
    photoUrl: p.photoKind === "upload" ? `/api/media/photo/${p.id}` : null,
  };
}

export async function mineBusiness(userId: string) {
  const data = await readStoreSnapshot();
  const staff = (data.bizStaff ?? []).filter((s) => s.userId === userId);
  return staff.map((s) => {
    const b = data.businesses.find((x) => x.id === s.businessId)!;
    return { ...publicBusiness(b), role: s.role, perms: s.perms };
  });
}

export async function updateBusiness(userId: string, businessId: string, patch: Partial<BusinessRecord>) {
  return mutateStore((data) => {
    if (!can(data, businessId, userId, "manageProfile")) return { ok: false as const, status: 403, error: "اجازهٔ پروفایل نداری." };
    const b = data.businesses.find((x) => x.id === businessId);
    if (!b) return { ok: false as const, status: 404, error: "کسب‌وکار نیست." };
    if (typeof patch.name === "string") b.name = patch.name.slice(0, 60);
    if (typeof patch.description === "string") b.description = patch.description.slice(0, 800);
    if (typeof patch.website === "string") {
      if (patch.website && !/^https:\/\//i.test(patch.website)) return { ok: false as const, status: 400, error: "Website باید HTTPS باشد." };
      b.website = patch.website;
    }
    if (typeof patch.phone === "string") b.phone = patch.phone.slice(0, 40);
    if (typeof patch.email === "string") b.email = patch.email.slice(0, 80);
    if (typeof patch.address === "string") b.address = patch.address.slice(0, 200);
    if (typeof patch.category === "string") b.category = patch.category as BusinessCategory;
    if (Array.isArray(patch.hours) && patch.hours.length === 7) b.hours = patch.hours;
    if (typeof patch.welcome === "string") b.welcome = patch.welcome.slice(0, 280);
    if (typeof patch.away === "string") b.away = patch.away.slice(0, 280);
    if (typeof patch.autoReply === "string") b.autoReply = patch.autoReply.slice(0, 280);
    if (typeof patch.lat === "number") b.lat = patch.lat;
    if (typeof patch.lng === "number") b.lng = patch.lng;
    if (typeof patch.username === "string") {
      const u = normalizeUsername(patch.username);
      if (!u) return { ok: false as const, status: 400, error: "نام کاربری معتبر نیست." };
      if (taken(data, u, businessId)) return { ok: false as const, status: 409, error: "این @username گرفته شده." };
      b.username = u;
    }
    if (patch.verified === true) return { ok: false as const, status: 403, error: "نشان تأیید با پرداخت یا فرانت جعل نمی‌شود." };
    b.updatedAt = Date.now();
    return { ok: true as const, business: publicBusiness(b) };
  });
}

export async function upsertProduct(
  userId: string,
  businessId: string,
  input: { id?: string; kind: "product" | "service"; name: string; description: string; price: number; currency?: string; stock?: number | null; category?: string; code?: string; photoDataUrl?: string },
) {
  let photo: Buffer | null = null;
  if (input.photoDataUrl) {
    photo = decodeDataUrl(input.photoDataUrl);
    if (!photo) return { ok: false as const, status: 400, error: "عکس محصول معتبر نیست." };
  }
  const pid = input.id || randomId();
  const result = await mutateStore((data) => {
    if (!can(data, businessId, userId, "manageProducts")) return { ok: false as const, status: 403, error: "اجازهٔ محصول نداری." };
    data.bizProducts ??= [];
    let p = data.bizProducts.find((x) => x.id === pid && x.businessId === businessId);
    if (!p) {
      p = {
        id: pid,
        businessId,
        kind: input.kind,
        name: input.name.slice(0, 80),
        description: input.description.slice(0, 800),
        price: Math.max(0, input.price),
        currency: (input.currency || "USD").slice(0, 8),
        stock: input.kind === "service" ? null : (input.stock ?? 0),
        category: (input.category || "general").slice(0, 40),
        code: (input.code || pid.slice(0, 8)).slice(0, 24),
        photoKind: photo ? "upload" : "default",
        views: 0,
        createdAt: Date.now(),
      };
      data.bizProducts.push(p);
    } else {
      p.name = input.name.slice(0, 80);
      p.description = input.description.slice(0, 800);
      p.price = Math.max(0, input.price);
      if (input.stock !== undefined) p.stock = input.stock;
      if (photo) p.photoKind = "upload";
    }
    return { ok: true as const, product: publicProduct(p) };
  });
  if (result.ok && photo) await saveUserPhoto(pid, photo);
  return result;
}

export async function searchProducts(businessId: string, q = "", kind?: string) {
  const data = await readStoreSnapshot();
  const n = q.toLowerCase();
  return (data.bizProducts ?? [])
    .filter((p) => p.businessId === businessId)
    .filter((p) => !kind || p.kind === kind)
    .filter((p) => !n || `${p.name} ${p.description} ${p.code} ${p.category}`.toLowerCase().includes(n))
    .map(publicProduct);
}

export async function viewProduct(businessId: string, productId: string) {
  return mutateStore((data) => {
    const p = (data.bizProducts ?? []).find((x) => x.id === productId && x.businessId === businessId);
    if (!p) return { ok: false as const, status: 404, error: "محصول نیست." };
    p.views += 1;
    return { ok: true as const, product: publicProduct(p) };
  });
}

export async function addStaff(ownerId: string, businessId: string, username: string, perms: Partial<BizPerms>) {
  return mutateStore((data) => {
    const biz = data.businesses.find((b) => b.id === businessId);
    if (!biz || biz.ownerUserId !== ownerId) return { ok: false as const, status: 403, error: "فقط Owner ادمین می‌گذارد." };
    const u = data.users.find((x) => x.username === username.replace(/^@/, "") && x.status === "active");
    if (!u) return { ok: false as const, status: 404, error: "کاربر یافت نشد." };
    if (u.id === ownerId) return { ok: false as const, status: 400, error: "مالک از قبل ادمین است." };
    data.bizStaff ??= [];
    const next: BizPerms = { ...emptyStaffPerms(), ...perms, managePayments: Boolean(perms.managePayments) };
    const existing = data.bizStaff.find((s) => s.businessId === businessId && s.userId === u.id);
    if (existing) existing.perms = next;
    else data.bizStaff.push({ businessId, userId: u.id, role: "admin", perms: next, name: u.displayName || u.username || "ادمین" });
    return { ok: true as const };
  });
}

export async function setQuickReply(userId: string, businessId: string, command: string, text: string) {
  return mutateStore((data) => {
    if (!can(data, businessId, userId, "reply")) return { ok: false as const, status: 403, error: "اجازهٔ پاسخ نداری." };
    data.bizReplies ??= [];
    const cmd = command.replace(/^\//, "").toLowerCase().slice(0, 24);
    const row: BizQuickReply = { id: randomId(), businessId, command: cmd, text: text.slice(0, 400) };
    data.bizReplies = data.bizReplies.filter((r) => !(r.businessId === businessId && r.command === cmd));
    data.bizReplies.push(row);
    return { ok: true as const, reply: row };
  });
}

export async function customerMessage(customerId: string, businessId: string, text: string) {
  return mutateStore((data) => {
    const biz = data.businesses.find((b) => b.id === businessId);
    if (!biz) return { ok: false as const, status: 404, error: "کسب‌وکار نیست." };
    const flood = hitRateLimit(data, `bizmsg:${customerId}:${businessId}`, 20_000, 8);
    if (!flood.allowed) return { ok: false as const, status: 429, error: "پیام پیاپی محدود شد." };
    data.bizThreads ??= [];
    data.bizMessages ??= [];
    let thread = data.bizThreads.find((t) => t.businessId === businessId && t.customerId === customerId);
    const first = !thread;
    if (!thread) {
      thread = {
        id: randomId(),
        businessId,
        customerId,
        unread: true,
        important: false,
        archived: false,
        spam: false,
        label: "New Customer",
        updatedAt: Date.now(),
      };
      data.bizThreads.push(thread);
    }
    thread.unread = true;
    thread.archived = false;
    thread.updatedAt = Date.now();
    const msg: BizMessage = { id: randomId(), threadId: thread.id, from: "customer", text: text.slice(0, 2000), createdAt: Date.now() };
    data.bizMessages.push(msg);
    const replies: BizMessage[] = [];
    if (first && biz.welcome) {
      replies.push({ id: randomId(), threadId: thread.id, from: "business", text: biz.welcome, createdAt: Date.now() + 1 });
    }
    if (!isOpenNow(biz.hours) && biz.away) {
      replies.push({ id: randomId(), threadId: thread.id, from: "business", text: biz.away, createdAt: Date.now() + 2 });
    } else if (biz.autoReply) {
      replies.push({ id: randomId(), threadId: thread.id, from: "business", text: biz.autoReply, createdAt: Date.now() + 2 });
    }
    const cmd = text.trim().replace(/^\//, "").split(/\s+/)[0]?.toLowerCase();
    const qr = (data.bizReplies ?? []).find((r) => r.businessId === businessId && r.command === cmd);
    if (qr) replies.push({ id: randomId(), threadId: thread.id, from: "business", text: qr.text, createdAt: Date.now() + 3 });
    data.bizMessages.push(...replies);
    return { ok: true as const, threadId: thread.id };
  });
}

export async function staffReply(userId: string, threadId: string, text: string) {
  return mutateStore((data) => {
    const thread = (data.bizThreads ?? []).find((t) => t.id === threadId);
    if (!thread) return { ok: false as const, status: 404, error: "گفتگو نیست." };
    if (!can(data, thread.businessId, userId, "reply")) return { ok: false as const, status: 403, error: "اجازهٔ پاسخ نداری." };
    data.bizMessages.push({ id: randomId(), threadId, from: "business", text: text.slice(0, 2000), createdAt: Date.now() });
    thread.unread = false;
    thread.updatedAt = Date.now();
    thread.label = thread.label ?? "Support";
    return { ok: true as const };
  });
}

export async function inbox(userId: string, businessId: string, filter?: string) {
  const data = await readStoreSnapshot();
  if (!can(data, businessId, userId, "readMessages")) return { ok: false as const, status: 403, error: "اجازهٔ خواندن پیام نداری." };
  let threads = (data.bizThreads ?? []).filter((t) => t.businessId === businessId);
  if (filter === "unread") threads = threads.filter((t) => t.unread);
  if (filter === "read") threads = threads.filter((t) => !t.unread);
  if (filter === "important") threads = threads.filter((t) => t.important);
  if (filter === "archived") threads = threads.filter((t) => t.archived);
  if (filter === "spam") threads = threads.filter((t) => t.spam);
  if (filter === "customers") threads = threads.filter((t) => !t.archived && !t.spam);
  return {
    ok: true as const,
    threads: threads.sort((a, b) => b.updatedAt - a.updatedAt).map((t) => ({
      ...t,
      customer: customerPublic(data, t.customerId),
    })),
  };
}

export async function customerChat(customerId: string, businessId: string) {
  const data = await readStoreSnapshot();
  const thread = (data.bizThreads ?? []).find((t) => t.businessId === businessId && t.customerId === customerId);
  if (!thread) return { ok: true as const, thread: null, messages: [] as BizMessage[], customer: customerPublic(data, customerId) };
  const messages = (data.bizMessages ?? []).filter((m) => m.threadId === thread.id);
  return { ok: true as const, thread, messages, customer: customerPublic(data, customerId) };
}

export async function threadMessages(userId: string, threadId: string) {
  const data = await readStoreSnapshot();
  const thread = (data.bizThreads ?? []).find((t) => t.id === threadId);
  if (!thread) return { ok: false as const, status: 404, error: "گفتگو نیست." };
  const asCustomer = thread.customerId === userId;
  const asStaff = can(data, thread.businessId, userId, "readMessages");
  if (!asCustomer && !asStaff) return { ok: false as const, status: 403, error: "این صندوق مال تو نیست." };
  const messages = (data.bizMessages ?? []).filter((m) => m.threadId === threadId);
  return { ok: true as const, thread, customer: customerPublic(data, thread.customerId), messages };
}

export async function patchThread(userId: string, threadId: string, patch: Partial<Pick<BizThread, "important" | "archived" | "spam" | "label" | "unread">>) {
  return mutateStore((data) => {
    const thread = (data.bizThreads ?? []).find((t) => t.id === threadId);
    if (!thread) return { ok: false as const, status: 404, error: "گفتگو نیست." };
    if (!can(data, thread.businessId, userId, "manageCustomers") && !can(data, thread.businessId, userId, "readMessages")) {
      return { ok: false as const, status: 403, error: "اجازه نداری." };
    }
    if (typeof patch.important === "boolean") thread.important = patch.important;
    if (typeof patch.archived === "boolean") thread.archived = patch.archived;
    if (typeof patch.spam === "boolean") thread.spam = patch.spam;
    if (typeof patch.unread === "boolean") thread.unread = patch.unread;
    if (patch.label) thread.label = patch.label as InboxLabel;
    return { ok: true as const };
  });
}

export async function cartAdd(userId: string, businessId: string, productId: string, qty: number) {
  return mutateStore((data) => {
    const p = (data.bizProducts ?? []).find((x) => x.id === productId && x.businessId === businessId);
    if (!p) return { ok: false as const, status: 404, error: "محصول نیست." };
    if (p.stock !== null && p.stock < qty) return { ok: false as const, status: 400, error: "موجودی کافی نیست." };
    data.bizCarts ??= [];
    let cart = data.bizCarts.find((c) => c.userId === userId && c.businessId === businessId);
    if (!cart) {
      cart = { userId, businessId, items: [] };
      data.bizCarts.push(cart);
    }
    const row = cart.items.find((i) => i.productId === productId);
    if (row) row.qty += qty;
    else cart.items.push({ productId, qty });
    return { ok: true as const, cart: publicCart(data, cart) };
  });
}

function publicCart(data: StoreData, cart: BizCart) {
  const lines = cart.items.map((i) => {
    const p = (data.bizProducts ?? []).find((x) => x.id === i.productId);
    const price = p?.price ?? 0;
    return { productId: i.productId, name: p?.name ?? "?", qty: i.qty, price, line: price * i.qty, currency: p?.currency ?? "USD" };
  });
  return { businessId: cart.businessId, items: lines, total: lines.reduce((s, l) => s + l.line, 0) };
}

export async function getCart(userId: string, businessId: string) {
  const data = await readStoreSnapshot();
  const cart = (data.bizCarts ?? []).find((c) => c.userId === userId && c.businessId === businessId);
  if (!cart) return { businessId, items: [], total: 0 };
  return publicCart(data, cart);
}

export async function placeOrder(userId: string, businessId: string, delivery: string) {
  return mutateStore((data) => {
    const cart = (data.bizCarts ?? []).find((c) => c.userId === userId && c.businessId === businessId);
    if (!cart || cart.items.length === 0) return { ok: false as const, status: 400, error: "سبد خالی است." };
    const items: { productId: string; name: string; qty: number; price: number }[] = [];
    for (const i of cart.items) {
      const p = (data.bizProducts ?? []).find((x) => x.id === i.productId);
      if (!p) return { ok: false as const, status: 400, error: "محصول سبد دیگر موجود نیست." };
      if (p.stock !== null) p.stock = Math.max(0, p.stock - i.qty);
      items.push({ productId: p.id, name: p.name, qty: i.qty, price: p.price });
    }
    const total = items.reduce((s, i) => s + i.price * i.qty, 0);
    const order: BizOrder = {
      id: `ord_${randomId().slice(0, 10)}`,
      businessId,
      customerId: userId,
      items,
      total,
      currency: (data.bizProducts.find((p) => p.id === items[0]?.productId)?.currency ?? "USD"),
      status: "pending",
      delivery: delivery.slice(0, 200),
      createdAt: Date.now(),
    };
    data.bizOrders ??= [];
    data.bizOrders.unshift(order);
    cart.items = [];
    return { ok: true as const, order: publicOrder(data, order) };
  });
}

function publicOrder(data: StoreData, o: BizOrder) {
  return {
    ...o,
    customer: customerPublic(data, o.customerId),
  };
}

export async function setOrderStatus(userId: string, orderId: string, status: OrderStatus) {
  return mutateStore((data) => {
    const o = (data.bizOrders ?? []).find((x) => x.id === orderId);
    if (!o) return { ok: false as const, status: 404, error: "سفارش نیست." };
    if (!can(data, o.businessId, userId, "manageOrders")) return { ok: false as const, status: 403, error: "اجازهٔ سفارش نداری." };
    o.status = status;
    return { ok: true as const, order: publicOrder(data, o) };
  });
}

export async function listOrders(userId: string, businessId: string) {
  const data = await readStoreSnapshot();
  if (!can(data, businessId, userId, "manageOrders")) return { ok: false as const, status: 403, error: "اجازهٔ سفارش نداری." };
  return { ok: true as const, orders: (data.bizOrders ?? []).filter((o) => o.businessId === businessId).map((o) => publicOrder(data, o)) };
}

export async function myOrders(userId: string) {
  const data = await readStoreSnapshot();
  return (data.bizOrders ?? []).filter((o) => o.customerId === userId).map((o) => publicOrder(data, o));
}

export async function dashboard(userId: string, businessId: string) {
  const data = await readStoreSnapshot();
  const s = staffOf(data, businessId, userId);
  if (!s) return null;
  const b = data.businesses.find((x) => x.id === businessId);
  if (!b) return null;
  const stats = can(data, businessId, userId, "viewAnalytics")
    ? (await analytics(userId, businessId))
    : null;
  return {
    business: publicBusiness(b),
    role: s.role,
    perms: s.perms,
    staff: can(data, businessId, userId, "manageProfile")
      ? (data.bizStaff ?? []).filter((x) => x.businessId === businessId).map((x) => ({ userId: x.userId, role: x.role, name: x.name, perms: x.perms }))
      : [],
    products: can(data, businessId, userId, "manageProducts") ? (data.bizProducts ?? []).filter((p) => p.businessId === businessId).map(publicProduct) : [],
    replies: (data.bizReplies ?? []).filter((r) => r.businessId === businessId),
    stats: stats && stats.ok ? stats.stats : null,
  };
}

export async function analytics(userId: string, businessId: string) {
  const data = await readStoreSnapshot();
  if (!can(data, businessId, userId, "viewAnalytics")) return { ok: false as const, status: 403, error: "اجازهٔ آمار نداری." };
  const b = data.businesses.find((x) => x.id === businessId)!;
  const products = (data.bizProducts ?? []).filter((p) => p.businessId === businessId);
  const threads = (data.bizThreads ?? []).filter((t) => t.businessId === businessId);
  const orders = (data.bizOrders ?? []).filter((o) => o.businessId === businessId);
  const msgs = (data.bizMessages ?? []).filter((m) => threads.some((t) => t.id === m.threadId));
  return {
    ok: true as const,
    stats: {
      profileViews: b.views,
      messageCount: msgs.length,
      customerCount: threads.length,
      productViews: products.reduce((s, p) => s + p.views, 0),
      orders: orders.length,
      revenue: orders.filter((o) => o.status !== "cancelled").reduce((s, o) => s + o.total, 0),
      paymentNote: "پرداخت رسمی NIXO Pay هنوز فعال نیست. Invoice/Refund در بخش پرداخت می‌آید.",
    },
  };
}

export async function requestVerification(userId: string, businessId: string, documents: string) {
  return mutateStore((data) => {
    const b = data.businesses.find((x) => x.id === businessId);
    if (!b || b.ownerUserId !== userId) return { ok: false as const, status: 403, error: "فقط Owner درخواست تأیید می‌دهد." };
    if (documents.trim().length < 12) return { ok: false as const, status: 400, error: "مدارک/شناسهٔ ثبت را شرح بده. پرداخت جایگزین تأیید نیست." };
    b.verification = "pending";
    b.verified = false;
    b.verificationHash = hmacIdentifier(`biz-kyc:${documents.trim()}`);
    b.updatedAt = Date.now();
    return { ok: true as const, verification: b.verification };
  });
}

export async function nixoReviewVerification(businessId: string, approve: boolean) {
  return mutateStore((data) => {
    const b = data.businesses.find((x) => x.id === businessId);
    if (!b || b.verification !== "pending" || !b.verificationHash) {
      return { ok: false as const, status: 400, error: "درخواست معلقی نیست." };
    }
    const complete = b.description.length >= 8 && b.hours.length === 7 && Boolean(b.phone || b.email);
    if (approve && !complete) return { ok: false as const, status: 400, error: "پروفایل برای تأیید ناقص است." };
    b.verified = Boolean(approve && complete);
    b.verification = approve && complete ? "none" : "rejected";
    return { ok: true as const, verified: b.verified };
  });
}

export async function attachBot(userId: string, businessId: string, botId: string) {
  return mutateStore((data) => {
    const b = data.businesses.find((x) => x.id === businessId);
    if (!b || b.ownerUserId !== userId) return { ok: false as const, status: 403, error: "فقط Owner." };
    const bot = (data.bots ?? []).find((x) => x.id === botId && x.ownerUserId === userId && x.status === "active");
    if (!bot) return { ok: false as const, status: 404, error: "ربات مال تو نیست." };
    b.botId = botId;
    return { ok: true as const };
  });
}

export async function attachChannel(userId: string, businessId: string, channelId: string) {
  return mutateStore((data) => {
    const b = data.businesses.find((x) => x.id === businessId);
    if (!b || b.ownerUserId !== userId) return { ok: false as const, status: 403, error: "فقط Owner." };
    const ch = (data.pubChannels ?? []).find((c) => c.id === channelId && c.ownerUserId === userId && !c.deletedAt);
    if (!ch) return { ok: false as const, status: 404, error: "کانال مال تو نیست." };
    b.channelId = channelId;
    return { ok: true as const };
  });
}

export async function businessAi(userId: string, businessId: string, task: "reply" | "translate" | "summary" | "ad" | "product" | "faq", text: string) {
  const data = await readStoreSnapshot();
  if (!can(data, businessId, userId, "reply") && !can(data, businessId, userId, "manageProfile")) {
    return { ok: false as const, status: 403, error: "اجازهٔ AI کسب‌وکار نداری." };
  }
  const intent = task === "translate" ? "translate" : task === "summary" ? "summarize" : task === "ad" || task === "product" ? "write" : task === "faq" ? "chat" : "reply";
  const out = runAiEngine({ text, intent, topic: "business" });
  return { ok: true as const, text: out.text };
}

export async function payStub() {
  return { ok: false as const, status: 503, error: "Payment Request / Invoice / Refund از مسیر رسمی NIXO Pay خواهد بود و هنوز فعال نیست." };
}

export async function reportBusiness(userId: string, businessId: string, category: string, details: string) {
  return mutateStore((data) => {
    if (!(data.businesses ?? []).some((b) => b.id === businessId)) return { ok: false as const, status: 404, error: "کسب‌وکار نیست." };
    const limit = hitRateLimit(data, `report:${userId}`, 60 * 60_000, 8);
    if (!limit.allowed) return { ok: false as const, status: 429, error: "سقف گزارش." };
    data.reports.push({
      id: randomId(),
      reporterId: userId,
      targetKind: "business",
      targetKey: businessId,
      messageIds: [],
      category: category === "harassment" || category === "spam" ? category : "abuse",
      details: `${category}: ${details}`.slice(0, 500),
      createdAt: Date.now(),
    });
    return { ok: true as const };
  });
}

export async function publishBusinessStory(userId: string, businessId: string, body: string) {
  const data = await readStoreSnapshot();
  if (!can(data, businessId, userId, "manageProfile")) {
    return { ok: false as const, status: 403, error: "اجازهٔ استوری کسب‌وکار نداری." };
  }
  const b = data.businesses.find((x) => x.id === businessId);
  if (!b) return { ok: false as const, status: 404, error: "کسب‌وکار نیست." };
  const text = `${b.name} · ${body}`.slice(0, 400);
  return createStory(userId, { kind: "text", body: text, caption: "Business Story", visibility: "everyone" });
}

export { ALL_BIZ_PERMS };
