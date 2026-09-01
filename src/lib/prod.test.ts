import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { getOutbox } from "./outbox";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { mutateStore, resetStoreForTests } from "./store";
import { enableTwoStep } from "./security";
import { clearStaffCookie, setStaffRole, staffLogin, writeStaffCookie } from "./admin-moderation";
import { DEPLOY_CONFIRM } from "./deploy-types";
import { createStagingRelease, promoteProduction } from "./deploy";
import { circuitAllow, circuitFailure, circuitSuccess, resetCircuitsForTests } from "./circuit";
import { PROD_CONFIRM } from "./prod-types";
import { evaluateReadiness, prodDashboard, prodMutate, runAndStoreSmoke, securityAudit } from "./prod";
import { stripSensitive } from "./safe-web";
import { roleHasPerm } from "./admin-types";
import { dbHealth } from "./db/health";

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
    firstName: "آمادگی",
    lastName: "آزمایش",
    username,
    bio: "بیو",
    privacyPhoto: "everyone",
    privacyBio: "everyone",
    photoAllowIds: [],
    bioAllowIds: [],
  });
  if (!done.ok) throw new Error("profile");
  return verified.userId;
}

describe("production readiness", () => {
  afterEach(async () => {
    await clearStaffCookie();
    await resetStoreForTests();
    resetCircuitsForTests();
  });

  it("scores smoke, blocks frozen production deploys, and keeps secrets out of the desk", async () => {
    expect(roleHasPerm("analyst", "prod.view")).toBe(true);
    expect(roleHasPerm("analyst", "prod.manage")).toBe(false);
    expect(securityAudit().items.every((i) => i.ok)).toBe(true);
    const redacted = stripSensitive({ password: "secret", visible: 1 }) as { password?: string; visible?: number };
    expect(redacted.password).toBeUndefined();
    expect(redacted.visible).toBe(1);

    circuitFailure("bi");
    circuitFailure("bi");
    expect(circuitAllow("bi")).toBe(true);
    for (let i = 0; i < 10; i += 1) circuitFailure("bi");
    expect(circuitAllow("bi")).toBe(false);
    circuitSuccess("bi");
    expect(circuitAllow("bi")).toBe(true);

    const health = await dbHealth();
    const snap = await mutateStore((d) => d);
    const ev = evaluateReadiness(snap, health);
    expect(ev.smoke.every((s) => s.ok)).toBe(true);
    expect(ev.score).toBeGreaterThanOrEqual(80);
    expect(ev.blocking).toHaveLength(0);

    const ops = await activeUser("nixo_ops");
    const pw = "NixoAdminPass12";
    await enableTwoStep(ops, pw, "127.0.0.1");
    const login = await staffLogin(ops, pw, undefined, "127.0.0.1", "vitest");
    if (!login.ok) throw new Error(login.error);
    await writeStaffCookie(ops, login.sid);

    const dash = await prodDashboard();
    expect(dash.ok).toBe(true);
    if (!dash.ok) throw new Error("dash");
    const blob = JSON.stringify(dash);
    expect(blob).not.toMatch(/NixoAdminPass12/);
    expect(blob).not.toContain("nixo-dev-pepper-not-for-production-use");

    const smoked = await runAndStoreSmoke();
    expect(smoked.ok).toBe(true);

    const freeze = await prodMutate({ action: "freeze", confirm: PROD_CONFIRM.freeze, reason: "حادثه آزمایشی" });
    expect(freeze.ok).toBe(true);

    const staging = await createStagingRelease({ notes: "gated" });
    expect(staging.ok).toBe(true);
    const blocked = await promoteProduction({ password: pw, confirm: DEPLOY_CONFIRM.production });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.status).toBe(423);

    const thaw = await prodMutate({ action: "thaw", confirm: PROD_CONFIRM.thaw });
    expect(thaw.ok).toBe(true);
    const prod = await promoteProduction({ password: pw, confirm: DEPLOY_CONFIRM.production });
    expect(prod.ok).toBe(true);

    const analyst = await activeUser("prod_analyst");
    await enableTwoStep(analyst, "CivilianPass12", "127.0.0.1");
    const grant = await setStaffRole(analyst, "analyst", pw, "ROLE");
    expect(grant.ok).toBe(true);
    await clearStaffCookie();
    const aLogin = await staffLogin(analyst, "CivilianPass12", undefined, "127.0.0.1", "vitest");
    if (!aLogin.ok) throw new Error(aLogin.error);
    await writeStaffCookie(analyst, aLogin.sid);
    const denied = await prodMutate({ action: "freeze", confirm: PROD_CONFIRM.freeze, reason: "x" });
    expect(denied.ok).toBe(false);
  });
});
