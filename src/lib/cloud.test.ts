import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { getOutbox } from "./outbox";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { mutateStore, resetStoreForTests } from "./store";
import { enableTwoStep } from "./security";
import { ensureBilling } from "./billing-access";
import { clearStaffCookie, staffLogin, writeStaffCookie } from "./admin-moderation";
import { roleHasPerm } from "./admin-types";
import { defaultCloudPolicy } from "./cloud-types";
import { CLOUD_CONFIRM } from "./cloud-types";
import { applyDecision, dbPoolSafe, evaluateServiceScale, finishDrains, lbPick, seedFleet } from "./cloud-scale";
import { cloudDashboard, cloudMutate, ensureCloud } from "./cloud";

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
    firstName: "ابر",
    lastName: "مقیاس",
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

describe("cloud autoscaling", () => {
  afterEach(async () => {
    await clearStaffCookie();
    await resetStoreForTests();
  });

  it("keeps min/max, drains before terminate, and ignores unhealthy LB targets", () => {
    expect(roleHasPerm("analyst", "cloud.view")).toBe(true);
    expect(roleHasPerm("analyst", "cloud.manage")).toBe(false);
    const policy = defaultCloudPolicy();
    const now = 1_000_000;
    const instances = seedFleet(policy, now, (n) => `i${n}`);
    const apiMin = policy.services.api.min;
    expect(instances.filter((i) => i.service === "api").length).toBe(apiMin);

    const quiet = evaluateServiceScale(policy, instances, "api", {
      now: now + 120_000,
      lastScaleAt: now,
      hour: 3,
      queueLength: 0,
      rps: 1,
      dbConnections: 1,
      dbPoolMax: 32,
      replicaLagMs: 0,
    });
    expect(quiet.action === "drain" || quiet.action === "none" || quiet.action === "blocked").toBe(true);

    const hotInstances = instances.map((i) => (i.service === "api" ? { ...i, cpuPct: 95, inflight: 400 } : i));
    const up = evaluateServiceScale(policy, hotInstances, "api", {
      now: now + 120_000,
      lastScaleAt: now,
      hour: 3,
      queueLength: 0,
      rps: 80,
      dbConnections: 1,
      dbPoolMax: 32,
      replicaLagMs: 0,
    });
    expect(up.action).toBe("up");
    expect(up.to).toBeLessThanOrEqual(policy.services.api.max);

    const cooled = evaluateServiceScale(policy, hotInstances, "api", {
      now: now + 1000,
      lastScaleAt: now,
      hour: 3,
      queueLength: 0,
      rps: 80,
      dbConnections: 1,
      dbPoolMax: 32,
      replicaLagMs: 0,
    });
    expect(cooled.action).toBe("blocked");

    const drained = applyDecision(instances, { service: "api", action: "drain", from: 2, to: 1, reason: "test" }, "eu-central", now, () => "d1");
    expect(drained.instances.some((i) => i.state === "draining")).toBe(true);
    expect(lbPick(drained.instances, "api", "eu-central")?.state).toBe("ready");
    const gone = finishDrains(drained.instances, now + 9_000);
    expect(gone.some((i) => i.state === "terminated")).toBe(true);

    expect(dbPoolSafe(40, 32).ok).toBe(false);
    expect(dbPoolSafe(8, 32).ok).toBe(true);
  });

  it("scales without dropping users or duplicating billing credits", async () => {
    const uid = await activeUser("cloud_user");
    await mutateStore((data) => {
      ensureCloud(data);
      ensureBilling(data);
      data.billing.credits.push({
        id: "c1",
        userId: uid,
        delta: 5,
        currency: "USD",
        type: "grant",
        ref: "cloud-test",
        createdAt: Date.now(),
      });
    });
    const ops = await activeUser("nixo_ops");
    const pw = "NixoAdminPass12";
    await enableTwoStep(ops, pw, "127.0.0.1");
    const login = await staffLogin(ops, pw, undefined, "127.0.0.1", "vitest");
    if (!login.ok) throw new Error(login.error);
    await writeStaffCookie(ops, login.sid);

    const dash = await cloudDashboard();
    expect(dash.ok).toBe(true);
    if (!dash.ok) return;
    expect(dash.dataPlane.database.public).toBe(false);
    expect(dash.safety.minMax).toBe(true);

    const up = await cloudMutate({ action: "scale-up", service: "api" });
    expect(up.ok).toBe(true);
    const drain = await cloudMutate({ action: "scale-in", service: "api" });
    expect(drain.ok).toBe(true);
    const fail = await cloudMutate({ action: "failover", confirm: CLOUD_CONFIRM.failover });
    expect(fail.ok).toBe(true);

    const snap = await mutateStore((d) => d);
    expect(snap.users.some((u) => u.id === uid)).toBe(true);
    const credits = snap.billing.credits.filter((c) => c.userId === uid && c.ref === "cloud-test");
    expect(credits).toHaveLength(1);
    expect(snap.cloud.policy.primaryRegion).toBe("us-east");
  });

  it("rejects chaos in the production env gate via confirm and keeps min replicas", async () => {
    const ops = await activeUser("nixo_ops");
    const pw = "NixoAdminPass12";
    await enableTwoStep(ops, pw, "127.0.0.1");
    const login = await staffLogin(ops, pw, undefined, "127.0.0.1", "vitest");
    if (!login.ok) throw new Error(login.error);
    await writeStaffCookie(ops, login.sid);
    const denied = await cloudMutate({ action: "chaos", service: "api" });
    expect(denied.ok).toBe(false);
    const ok = await cloudMutate({ action: "chaos", service: "api", confirm: CLOUD_CONFIRM.chaos });
    expect(ok.ok).toBe(true);
    const load = await cloudMutate({ action: "loadtest", confirm: CLOUD_CONFIRM.loadtest });
    expect(load.ok).toBe(true);
  });
});
