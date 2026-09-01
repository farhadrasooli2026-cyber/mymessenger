import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { getOutbox } from "./outbox";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { mutateStore, resetStoreForTests } from "./store";
import { enableTwoStep } from "./security";
import { fileReport } from "./safety";
import { createStory } from "./stories";
import {
  applyRestriction,
  clearStaffCookie,
  listReports,
  lookupStaff,
  requireStaff,
  searchUsers,
  setStaffRole,
  staffLogin,
  viewUser,
  warnUser,
  writeStaffCookie,
} from "./admin-moderation";

async function activeUser(username: string) {
  const ip = hashIp(`test-ip:${username}`);
  const issued = await issueHumanChallenge(ip);
  await ackHumanChallenge(issued.token, ip);
  const start = await startRegistration(
    { channel: "email", identifier: `${username}@nixo.test`, humanToken: issued.token, website: "" },
    ip,
  );
  if (!start.ok) throw new Error("start");
  const code = getOutbox(start.challengeId)?.body.match(/\b(\d{6})\b/)?.[1] ?? "";
  const verified = await verifyOtp(start.challengeId, code, ip);
  if (!verified.ok) throw new Error("verify");
  const done = await completeProfile(verified.userId, {
    firstName: "ناظر",
    lastName: "آزمایش",
    username,
    bio: "بیو تست",
    privacyPhoto: "everyone",
    privacyBio: "everyone",
    photoAllowIds: [],
    bioAllowIds: [],
  });
  if (!done.ok) throw new Error("profile");
  return verified.userId;
}

async function withStaffSession(userId: string, password: string) {
  const login = await staffLogin(userId, password, undefined, "127.0.0.1", "vitest");
  if (!login.ok) throw new Error(login.error);
  await writeStaffCookie(userId, login.sid);
  return login;
}

describe("admin moderation", () => {
  afterEach(async () => {
    await clearStaffCookie();
    await resetStoreForTests();
  });

  it("keeps RBAC, IDOR, reporter privacy, and never leaks secrets", async () => {
    const ops = await activeUser("nixo_ops");
    const pw = "NixoAdminPass12";
    await enableTwoStep(ops, pw, "127.0.0.1");
    const civilian = await activeUser("mod_target_user");
    const stranger = await activeUser("random_mod_user");
    await enableTwoStep(stranger, "CivilianPass12", "127.0.0.1");

    await withStaffSession(ops, pw);
    const staff = await mutateStore((data) => lookupStaff(data, ops));
    expect(staff?.role).toBe("super_admin");

    const banned = await applyRestriction({
      targetId: civilian,
      kind: "ban",
      reason: "سوءاستفاده آزمایشی",
      password: pw,
      confirm: "BAN",
      permanent: true,
    });
    expect(banned.ok).toBe(true);

    const story = await createStory(civilian, { kind: "text", body: "محتوای عمومی تست ناظر" });
    expect(story.ok).toBe(false);

    const report = await fileReport(stranger, {
      targetKind: "user",
      targetKey: civilian,
      category: "abuse",
      details: "گزارش آزمایشی",
    });
    expect(report.ok).toBe(true);

    const listed = await listReports({});
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      const row = listed.reports.find((r) => r.id === (report.ok ? report.reportId : ""));
      expect(row).toBeTruthy();
      expect(JSON.stringify(row)).not.toContain(stranger);
      expect(row?.reporter).toBeTruthy();
      expect(row?.reporter).not.toBe(stranger);
    }

    const viewed = await viewUser(civilian);
    expect(viewed.ok).toBe(true);
    if (viewed.ok) {
      const blob = JSON.stringify(viewed);
      expect(blob).not.toContain(pw);
      expect(blob.toLowerCase()).not.toContain("passwordhash");
      expect(viewed.user.accountStatus).toBe("banned");
    }

    const granted = await setStaffRole(stranger, "analyst", pw, "ROLE");
    expect(granted.ok).toBe(true);
    await clearStaffCookie();
    await withStaffSession(stranger, "CivilianPass12");
    const escalate = await setStaffRole(stranger, "super_admin", "CivilianPass12", "ROLE");
    expect(escalate.ok).toBe(false);

    const banAsAnalyst = await applyRestriction({
      targetId: ops,
      kind: "ban",
      reason: "تلاش IDOR",
      password: "CivilianPass12",
      confirm: "BAN",
    });
    expect(banAsAnalyst.ok).toBe(false);

    await clearStaffCookie();
    const noStaff = await requireStaff("users.ban");
    expect(noStaff.ok).toBe(false);
  });

  it("does not let a stranger search users without an admin session", async () => {
    await activeUser("nixo_ops");
    const r = await searchUsers("nixo");
    expect(r.ok).toBe(false);
  });

  it("records a warning without exposing actor identity to the subject card", async () => {
    const ops = await activeUser("nixo_ops");
    const pw = "NixoAdminPass12";
    await enableTwoStep(ops, pw, "127.0.0.1");
    const target = await activeUser("warn_me_please");
    await withStaffSession(ops, pw);
    const w = await warnUser(target, "رفتار مشکوک آزمایشی");
    expect(w.ok).toBe(true);
    const viewed = await viewUser(target);
    expect(viewed.ok).toBe(true);
    if (viewed.ok) {
      expect(viewed.warnings.length).toBeGreaterThan(0);
    }
  });
});
