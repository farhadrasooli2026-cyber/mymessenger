import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { getOutbox } from "./outbox";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { mutateStore, resetStoreForTests } from "./store";
import { enableTwoStep } from "./security";
import { clearStaffCookie, staffLogin, writeStaffCookie } from "./admin-moderation";
import { validateRuntimeConfig } from "./env-config";
import { flagAllows } from "./flags";
import { bumpPatch, parseSemver } from "./release";
import { DEPLOY_CONFIRM, defaultFlags } from "./deploy-types";
import {
  createStagingRelease,
  deployDashboard,
  promoteProduction,
  rollbackRelease,
  setFeatureFlag,
} from "./deploy";

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
    firstName: "انتشار",
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

describe("deployment devops", () => {
  afterEach(async () => {
    await clearStaffCookie();
    await resetStoreForTests();
  });

  it("keeps production gated, flags from replacing auth, and rollback session-safe", async () => {
    expect(parseSemver("0.1.0")).toEqual({ major: 0, minor: 1, patch: 0 });
    expect(bumpPatch("0.1.0")).toBe("0.1.1");
    const prevDemo = process.env.NIXO_DEMO_INBOX;
    const prevPepper = process.env.NIXO_PEPPER;
    process.env.NIXO_DEMO_INBOX = "true";
    process.env.NIXO_PEPPER = "nixo-dev-pepper-not-for-production-use";
    expect(validateRuntimeConfig("production").ok).toBe(false);
    process.env.NIXO_DEMO_INBOX = prevDemo;
    process.env.NIXO_PEPPER = prevPepper;

    expect(flagAllows(undefined, "missing_flag", { userId: "u1" })).toBe(true);
    expect(flagAllows([{ ...defaultFlags()[0], key: "x", kill: true, enabled: true, percent: 100, segment: "all", updatedAt: 0, updatedBy: null }], "x", { userId: "u1", staff: true })).toBe(false);
    expect(flagAllows([{ key: "x", enabled: true, percent: 0, segment: "percent", kill: false, updatedAt: 0, updatedBy: null }], "x", { userId: "u1" })).toBe(false);

    const denied = await deployDashboard();
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.status).toBe(401);

    const ops = await activeUser("nixo_ops");
    const pw = "NixoAdminPass12";
    await enableTwoStep(ops, pw, "127.0.0.1");
    const login = await staffLogin(ops, pw, undefined, "127.0.0.1", "vitest");
    if (!login.ok) throw new Error(login.error);
    await writeStaffCookie(ops, login.sid);

    const staging = await createStagingRelease({ notes: "cut 0.1.1", strategy: "rolling" });
    expect(staging.ok).toBe(true);
    if (!staging.ok) throw new Error("staging");

    const noPhrase = await promoteProduction({ password: pw, confirm: "nope" });
    expect(noPhrase.ok).toBe(false);

    const prod = await promoteProduction({ password: pw, confirm: DEPLOY_CONFIRM.production, strategy: "blue_green" });
    expect(prod.ok).toBe(true);
    if (!prod.ok) throw new Error("prod");

    const devicesBefore = await mutateStore((d) => d.devices.filter((x) => x.userId === ops && !x.revokedAt).length);
    const rb = await rollbackRelease({ password: pw, confirm: DEPLOY_CONFIRM.rollback });
    expect(rb.ok).toBe(true);
    if (!rb.ok) throw new Error("rb");
    expect(rb.sessionsPreserved).toBe(true);
    expect(rb.jobsPreserved).toBe(true);
    const devicesAfter = await mutateStore((d) => d.devices.filter((x) => x.userId === ops && !x.revokedAt).length);
    expect(devicesAfter).toBe(devicesBefore);

    const killed = await setFeatureFlag({ key: "shop_new_checkout", kill: true });
    expect(killed.ok).toBe(true);
    const flags = await mutateStore((d) => d.deploy.flags);
    expect(flagAllows(flags, "shop_new_checkout", { userId: ops })).toBe(false);

    const dash = await deployDashboard();
    expect(dash.ok).toBe(true);
    if (!dash.ok) throw new Error("dash");
    const blob = JSON.stringify(dash);
    expect(blob).not.toMatch(/NixoAdminPass12/);
    expect(blob.toLowerCase()).not.toContain("begin private key");
    expect(dash.privacy.secretsInPayload).toBe(false);
    expect(dash.config.every((c) => !("value" in c))).toBe(true);
  });
});
