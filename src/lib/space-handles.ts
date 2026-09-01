import "server-only";
import { usernameIssue } from "@/lib/username";
import type { StoreData } from "@/lib/store";

const HANDLE = /^[a-z][a-z0-9_]{2,23}$/;

export function claimSpaceHandle(
  data: StoreData,
  raw: string | null | undefined,
  except?: { groupId?: string; channelId?: string; userId?: string },
): { ok: true; username: string | null } | { ok: false; error: string; status: 400 | 409 } {
  if (raw == null || !String(raw).trim()) return { ok: true, username: null };
  const username = String(raw).trim().replace(/^@/, "").toLowerCase();
  if (!HANDLE.test(username)) {
    return { ok: false, error: "نام کاربری نامعتبر است.", status: 400 };
  }
  const issue = usernameIssue(username);
  if (issue === "reserved") {
    return { ok: false, error: "این نام رزرو شده است.", status: 400 };
  }
  if (issue === "invalid" && username.length <= 20) {
    return { ok: false, error: "نام کاربری نامعتبر است.", status: 400 };
  }
  if (data.users.some((u) => u.username === username && u.id !== except?.userId && u.status === "active")) {
    return { ok: false, error: "این نام کاربری گرفته شده است.", status: 409 };
  }
  if (data.groups.some((g) => g.username === username && !g.deletedAt && g.id !== except?.groupId)) {
    return { ok: false, error: "این نام کاربری گرفته شده است.", status: 409 };
  }
  if (data.pubChannels.some((c) => c.username === username && !c.deletedAt && c.id !== except?.channelId)) {
    return { ok: false, error: "این نام کاربری گرفته شده است.", status: 409 };
  }
  return { ok: true, username };
}
