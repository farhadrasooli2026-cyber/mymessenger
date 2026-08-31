import "server-only";
import { config } from "@/lib/config";
import { hmacIdentifier, hashOtp, newSalt, otpHashesEqual, randomId } from "@/lib/crypto-utils";
import { appendAudit } from "@/lib/security";
import { mutateStore, readStoreSnapshot } from "@/lib/store";
import type { BackupPrefs, EncryptedBackup } from "@/lib/store";

const MAX = config.maxBackupBytes;

function publicBackup(row: EncryptedBackup) {
  return {
    id: row.id,
    createdAt: row.createdAt,
    sizeBytes: row.sizeBytes,
    status: row.status,
    error: row.error,
    errorCode: row.errorCode,
    encryption: row.encryption,
    location: row.location,
    include: row.include,
    encrypted: true,
  };
}

export async function getBackupState(userId: string) {
  const data = await readStoreSnapshot();
  const user = data.users.find((u) => u.id === userId);
  if (!user) return null;
  const list = (data.backups ?? []).filter((b) => b.userId === userId).sort((a, b) => b.createdAt - a.createdAt);
  const latest = list[0] ?? null;
  return {
    prefs: user.backupPrefs ?? {
      auto: false,
      schedule: "weekly" as const,
      includePhotos: true,
      includeVideos: true,
      includeFiles: true,
      includeVoice: false,
    },
    hasPassword: Boolean(user.backupPasswordHash),
    hasRecovery: Boolean(user.backupRecoveryHash),
    latest: latest ? publicBackup(latest) : null,
    history: list.slice(0, 8).map(publicBackup),
  };
}

export async function saveBackupPrefs(userId: string, prefs: Partial<BackupPrefs>) {
  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "حساب یافت نشد.", status: 404 };
    const cur = user.backupPrefs ?? {
      auto: false,
      schedule: "weekly" as const,
      includePhotos: true,
      includeVideos: true,
      includeFiles: true,
      includeVoice: false,
    };
    user.backupPrefs = {
      auto: typeof prefs.auto === "boolean" ? prefs.auto : cur.auto,
      schedule:
        prefs.schedule === "daily" || prefs.schedule === "weekly" || prefs.schedule === "monthly"
          ? prefs.schedule
          : cur.schedule,
      includePhotos: typeof prefs.includePhotos === "boolean" ? prefs.includePhotos : cur.includePhotos,
      includeVideos: typeof prefs.includeVideos === "boolean" ? prefs.includeVideos : cur.includeVideos,
      includeFiles: typeof prefs.includeFiles === "boolean" ? prefs.includeFiles : cur.includeFiles,
      includeVoice: typeof prefs.includeVoice === "boolean" ? prefs.includeVoice : cur.includeVoice,
    };
    return { ok: true as const, prefs: user.backupPrefs };
  });
}

export async function enableBackupSecrets(userId: string, password: string, recoveryKey: string, ip: string) {
  if (password.trim().length < 10) {
    return { ok: false as const, error: "رمز پشتیبان باید حداقل ۱۰ نویسه باشد و فقط نزد شما بماند.", status: 400 };
  }
  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (!user) return { ok: false as const, error: "حساب یافت نشد.", status: 404 };
    const salt = newSalt();
    user.backupPasswordSalt = salt;
    user.backupPasswordHash = hashOtp(password, salt);
    user.backupRecoveryHash = hashOtp(recoveryKey.toUpperCase(), "nixo-backup-recovery");
    appendAudit(data, userId, "backup", { ip, detail: "رمز و کلید بازیابی پشتیبان به‌صورت هش ذخیره شد" });
    return { ok: true as const };
  });
}

function secretMatches(
  user: { backupPasswordHash?: string; backupPasswordSalt?: string; backupRecoveryHash?: string },
  secret: string,
) {
  if (
    user.backupPasswordHash &&
    user.backupPasswordSalt &&
    otpHashesEqual(user.backupPasswordHash, hashOtp(secret, user.backupPasswordSalt))
  ) {
    return true;
  }
  if (
    user.backupRecoveryHash &&
    otpHashesEqual(user.backupRecoveryHash, hashOtp(secret.trim().toUpperCase(), "nixo-backup-recovery"))
  ) {
    return true;
  }
  return false;
}

export async function storeEncryptedBackup(
  userId: string,
  wrapped: { salt: string; nonce: string; ciphertext: string },
  include: EncryptedBackup["include"],
  ip: string,
) {
  const size = wrapped.ciphertext.length + wrapped.nonce.length + wrapped.salt.length;
  if (size < 24) {
    return { ok: false as const, error: "Backup Failed — داده خالی یا ناقص است.", status: 400, errorCode: "empty" as const };
  }
  if (size > MAX) {
    return {
      ok: false as const,
      error: "Backup Failed — Not Enough Storage. حجم پشتیبان از سقف نیکسو بیشتر است.",
      status: 413,
      errorCode: "storage" as const,
    };
  }
  return mutateStore((data) => {
    const user = data.users.find((u) => u.id === userId);
    if (!user) {
      return { ok: false as const, error: "Backup Failed — Permission Error.", status: 401, errorCode: "permission" as const };
    }
    if (!user.backupPasswordHash) {
      return { ok: false as const, error: "ابتدا رمز پشتیبان را تنظیم کنید.", status: 400, errorCode: "permission" as const };
    }
    const integrity = hmacIdentifier(`backup:${wrapped.ciphertext}:${wrapped.nonce}:${wrapped.salt}`);
    const row: EncryptedBackup = {
      id: randomId(),
      userId,
      createdAt: Date.now(),
      sizeBytes: size,
      status: "complete",
      integrity,
      salt: wrapped.salt,
      nonce: wrapped.nonce,
      ciphertext: wrapped.ciphertext,
      include,
      encryption: "aes-gcm-v1",
      location: "nixo-vault",
      version: 1,
    };
    const check = hmacIdentifier(`backup:${row.ciphertext}:${row.nonce}:${row.salt}`);
    if (check !== integrity || !row.ciphertext || !row.nonce || !row.salt) {
      row.status = "incomplete";
      row.error = "Backup Failed — فایل ناقص به‌عنوان پشتیبان معتبر ثبت نشد.";
      row.errorCode = "integrity";
    }
    data.backups = [row, ...(data.backups ?? []).filter((b) => b.userId !== userId)].slice(0, 40);
    appendAudit(data, userId, "backup", {
      ip,
      detail: row.status === "complete" ? "پشتیبان رمزشده ذخیره شد؛ سرور متن را ندارد" : row.error,
    });
    return { ok: true as const, backup: publicBackup(row) };
  });
}

export async function loadBackupForRestore(userId: string, secret: string) {
  const data = await readStoreSnapshot();
  const user = data.users.find((u) => u.id === userId);
  if (!user) return { ok: false as const, error: "Permission Error", status: 401 };
  if (!secretMatches(user, secret)) {
    return { ok: false as const, error: "رمز یا کلید بازیابی نادرست است.", status: 400 };
  }
  const row = (data.backups ?? [])
    .filter((b) => b.userId === userId && b.status === "complete")
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!row) return { ok: false as const, error: "پشتیبان کاملی یافت نشد.", status: 404 };
  const check = hmacIdentifier(`backup:${row.ciphertext}:${row.nonce}:${row.salt}`);
  if (check !== row.integrity) {
    return { ok: false as const, error: "پشتیبان دستکاری یا ناقص است و بازیابی نمی‌شود.", status: 409 };
  }
  return {
    ok: true as const,
    wrapped: { enc: "aes-gcm-v1" as const, salt: row.salt, nonce: row.nonce, ciphertext: row.ciphertext },
    include: row.include,
  };
}

export async function markRestored(userId: string, ip: string) {
  return mutateStore((data) => {
    appendAudit(data, userId, "restore", { ip, detail: "بازیابی پشتیبان روی دستگاه احرازشده" });
    return { ok: true as const };
  });
}

export async function deleteBackup(userId: string, ip: string) {
  return mutateStore((data) => {
    const before = (data.backups ?? []).length;
    data.backups = (data.backups ?? []).filter((b) => b.userId !== userId);
    if (data.backups.length === before) return { ok: false as const, error: "پشتیبان یافت نشد.", status: 404 };
    appendAudit(data, userId, "backup", { ip, detail: "پشتیبان حذف شد" });
    return { ok: true as const };
  });
}

export function nextAutoDue(lastAt: number | null, schedule: BackupPrefs["schedule"], now = Date.now()) {
  if (!lastAt) return true;
  const span = schedule === "daily" ? 86_400_000 : schedule === "weekly" ? 7 * 86_400_000 : 30 * 86_400_000;
  return now - lastAt >= span;
}
