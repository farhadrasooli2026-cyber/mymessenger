/** Catalog of NIXO primary-store collections. Blobs live on disk; this table is metadata only. */

export type DbOwner = "user" | "system" | "ops" | "shared-public";
export type DbLifecycle = "hot" | "soft-delete" | "ttl" | "archive" | "purge-on-account";

export type DbCollection = {
  name: string;
  pk: string;
  ownerField?: string;
  unique?: string[];
  fks?: { field: string; collection: string; onDelete: "cascade-owner" | "restrict" | "set-null" }[];
  service: string;
  owner: DbOwner;
  lifecycle: DbLifecycle;
  notes: string;
};

export const DB_COLLECTIONS: DbCollection[] = [
  { name: "users", pk: "id", unique: ["username"], service: "identity", owner: "user", lifecycle: "purge-on-account", notes: "پروفایل جدا از رمز/OTP؛ شناسه و وضعیت حساب." },
  { name: "challenges", pk: "id", service: "auth", owner: "system", lifecycle: "ttl", notes: "OTP هش‌شده؛ متن کد ذخیره نمی‌شود." },
  { name: "devices", pk: "id", ownerField: "userId", service: "session", owner: "user", lifecycle: "purge-on-account", notes: "نشست دستگاه؛ کوکی HttpOnly جداست." },
  { name: "threads", pk: "id", ownerField: "ownerUserId", service: "chat", owner: "user", lifecycle: "purge-on-account", notes: "هر کاربر اینباکس خودش را دارد." },
  { name: "messages", pk: "id", ownerField: "ownerUserId", fks: [{ field: "threadId", collection: "threads", onDelete: "cascade-owner" }], service: "chat", owner: "user", lifecycle: "ttl", notes: "ciphertext E2EE؛ متن خام نیست." },
  { name: "groups", pk: "id", service: "groups", owner: "shared-public", lifecycle: "soft-delete", notes: "عضویت سمت سرور." },
  { name: "groupMessages", pk: "id", fks: [{ field: "groupId", collection: "groups", onDelete: "cascade-owner" }], service: "groups", owner: "shared-public", lifecycle: "soft-delete", notes: "ciphertext گروه." },
  { name: "pubChannels", pk: "id", unique: ["username"], service: "channels", owner: "shared-public", lifecycle: "soft-delete", notes: "پست کانال روی سرور برای مشترک‌ها." },
  { name: "channelPosts", pk: "id", fks: [{ field: "channelId", collection: "pubChannels", onDelete: "cascade-owner" }], service: "channels", owner: "shared-public", lifecycle: "hot", notes: "فایل کانال متادیتا؛ بایت در پست." },
  { name: "follows", pk: "id", service: "contacts", owner: "user", lifecycle: "purge-on-account", notes: "رابطه Follow؛ هر یال متعلق به follower است." },
  { name: "notifications", pk: "id", ownerField: "userId", service: "notify", owner: "user", lifecycle: "ttl", notes: "بدون متن E2EE؛ Deep Link سمت سرور." },
  { name: "pushTokens", pk: "id", ownerField: "userId", service: "notify", owner: "user", lifecycle: "purge-on-account", notes: "توکن Push؛ endpoint کامل در API عمومی نیست." },
  { name: "pushJobs", pk: "id", ownerField: "userId", service: "notify", owner: "user", lifecycle: "ttl", notes: "صف Push با Retry و Idempotency." },
  { name: "galleryItems", pk: "id", ownerField: "ownerUserId", service: "media", owner: "user", lifecycle: "soft-delete", notes: "متادیتا؛ بایت در .data/gallery." },
  { name: "savedItems", pk: "id", ownerField: "ownerUserId", service: "saved", owner: "user", lifecycle: "soft-delete", notes: "صندوق ذخیرهٔ خصوصی." },
  { name: "inboxMetas", pk: "id", ownerField: "ownerUserId", service: "inbox", owner: "user", lifecycle: "purge-on-account", notes: "تنظیمات پوشه و mute." },
  { name: "audit", pk: "id", ownerField: "userId", service: "security", owner: "user", lifecycle: "ttl", notes: "بدون OTP/رمز." },
  { name: "backups", pk: "id", ownerField: "userId", service: "backup", owner: "user", lifecycle: "hot", notes: "پاکت رمزشدهٔ کاربر." },
  { name: "fileAccessLogs", pk: "id", ownerField: "userId", service: "media", owner: "user", lifecycle: "ttl", notes: "آمار دسترسی فایل." },
  { name: "mediaJobs", pk: "id", ownerField: "ownerUserId", service: "media", owner: "user", lifecycle: "ttl", notes: "صف پردازش." },
  { name: "searchIndex", pk: "gen", service: "search", owner: "system", lifecycle: "hot", notes: "ایندکس عمومی؛ محتوای خصوصی و E2EE وارد نمی‌شود." },
  { name: "searchDocs", pk: "id", service: "search", owner: "system", lifecycle: "hot", notes: "اسناد عمومی همگام با Store." },
];

export const SCHEMA_VERSION = 1;
export const QUERY_LIMIT_MAX = 80;
export const QUERY_TIMEOUT_MS = 8_000;
export const WRITER_POOL_SIZE = 1;
