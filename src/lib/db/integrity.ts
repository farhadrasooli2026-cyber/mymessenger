import type { StoreData } from "@/lib/store";

export type IntegrityIssue = { code: string; detail: string; count: number };

export function collectIntegrityIssues(data: StoreData): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const userIds = new Set(data.users.map((u) => u.id));
  const threadKeys = new Set(data.threads.map((t) => `${t.ownerUserId}:${t.id}`));

  const orphanMessages = data.messages.filter((m) => !threadKeys.has(`${m.ownerUserId}:${m.threadId}`));
  if (orphanMessages.length) issues.push({ code: "orphan_message", detail: "پیام بدون نخ مالک", count: orphanMessages.length });

  const orphanThreads = data.threads.filter((t) => !userIds.has(t.ownerUserId));
  if (orphanThreads.length) issues.push({ code: "orphan_thread", detail: "نخ بدون کاربر", count: orphanThreads.length });

  const orphanContacts = (data.contacts ?? []).filter((c) => !userIds.has(c.ownerUserId));
  if (orphanContacts.length) issues.push({ code: "orphan_contact", detail: "مخاطب بدون مالک", count: orphanContacts.length });

  const seen = new Map<string, number>();
  for (const u of data.users) {
    if (!u.username) continue;
    seen.set(u.username, (seen.get(u.username) ?? 0) + 1);
  }
  const dup = [...seen.values()].filter((n) => n > 1).length;
  if (dup) issues.push({ code: "duplicate_username", detail: "username تکراری", count: dup });

  const groupIds = new Set((data.groups ?? []).map((g) => g.id));
  const orphanGm = (data.groupMessages ?? []).filter((m) => !groupIds.has(m.groupId));
  if (orphanGm.length) issues.push({ code: "orphan_group_message", detail: "پیام گروه بدون گروه", count: orphanGm.length });

  return issues;
}

/** Removes ownerless rows only. Never rewrites another user's records. */
export function repairOrphans(data: StoreData): { removed: number } {
  const userIds = new Set(data.users.map((u) => u.id));
  const threadKeys = new Set(data.threads.map((t) => `${t.ownerUserId}:${t.id}`));
  let removed = 0;
  const beforeM = data.messages.length;
  data.messages = data.messages.filter((m) => threadKeys.has(`${m.ownerUserId}:${m.threadId}`));
  removed += beforeM - data.messages.length;
  const beforeT = data.threads.length;
  data.threads = data.threads.filter((t) => userIds.has(t.ownerUserId));
  removed += beforeT - data.threads.length;
  const beforeC = (data.contacts ?? []).length;
  data.contacts = (data.contacts ?? []).filter((c) => userIds.has(c.ownerUserId));
  removed += beforeC - data.contacts.length;
  const groupIds = new Set((data.groups ?? []).map((g) => g.id));
  const beforeG = (data.groupMessages ?? []).length;
  data.groupMessages = (data.groupMessages ?? []).filter((m) => groupIds.has(m.groupId));
  removed += beforeG - data.groupMessages.length;
  return { removed };
}
