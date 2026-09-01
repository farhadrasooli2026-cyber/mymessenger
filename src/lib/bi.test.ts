import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { getOutbox } from "./outbox";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { mutateStore, resetStoreForTests } from "./store";
import { enableTwoStep } from "./security";
import { experimentVariant, flushBiForTests, resetBiMemoryForTests, trackBi } from "./bi";
import { SENSITIVE_ANALYTICS_RE } from "./bi-types";
import { clearStaffCookie, lookupStaff, staffLogin, writeStaffCookie } from "./admin-moderation";

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

describe("analytics BI", () => {
  afterEach(async () => {
    resetBiMemoryForTests();
    await clearStaffCookie();
    await resetStoreForTests();
  });

  it("rejects secrets, respects opt-out, dedupes, and never puts userId in the dashboard", async () => {
    trackBi({ name: "ui.feature_open", source: "test", userId: "u1", consented: true, props: { password: "secret" }, nonce: "n-secret-1" });
    trackBi({ name: "ui.feature_open", source: "test", userId: "u1", consented: false, props: { feature: "chat" }, nonce: "n-optout" });
    trackBi({ name: "ui.feature_open", source: "test", userId: "u1", consented: true, props: { feature: "chat" }, nonce: "n-ok-1" });
    trackBi({ name: "ui.feature_open", source: "test", userId: "u1", consented: true, props: { feature: "chat" }, nonce: "n-ok-1" });
    trackBi({ name: "auth.login_fail", source: "test", nonce: "n-ess" });
    await flushBiForTests();

    const snap = await mutateStore((data) => data.bi);
    expect(snap.raw.some((e) => SENSITIVE_ANALYTICS_RE.test(JSON.stringify(e)))).toBe(false);
    expect(snap.raw.some((e) => e.nonce === "n-secret-1")).toBe(false);
    expect(snap.raw.filter((e) => e.nonce === "n-ok-1").length).toBe(1);
    expect(snap.raw.some((e) => e.name === "auth.login_fail")).toBe(true);
    expect(snap.pipeline.droppedConsent).toBeGreaterThan(0);
    expect(JSON.stringify(snap.raw)).not.toContain("u1");
    expect(snap.raw.every((e) => e.subject.length === 64)).toBe(true);

    const ops = await activeUser("nixo_ops");
    await flushBiForTests();
    await enableTwoStep(ops, "NixoAdminPass12", "127.0.0.1");
    const login = await staffLogin(ops, "NixoAdminPass12", undefined, "127.0.0.1", "vitest");
    if (!login.ok) throw new Error(login.error);
    await writeStaffCookie(ops, login.sid);
    const { biDashboard } = await import("./bi");
    const dash = await biDashboard({ range: "7d", compare: true });
    if (!dash.ok) throw new Error(dash.error);
    const blob = JSON.stringify(dash);
    expect(blob).not.toMatch(/refreshToken|BEGIN RSA/i);
    expect(blob).not.toContain("ciphertext");
    expect(blob).not.toContain(ops);
    expect(dash.privacy.storesPlaintextMessages).toBe(false);
    expect(dash.growth.current.newUsers).toBeGreaterThanOrEqual(1);
    expect(dash.product.funnel.registerStart).toBeGreaterThanOrEqual(1);
    expect(dash.definitions.length).toBeGreaterThan(5);
    expect(dash.access.canManage).toBe(true);

    const upsert = await (await import("./bi")).biMutate({ action: "experiment.upsert", key: "new_composer", percent: 40, metric: "engagement.dau" });
    if (!upsert.ok) throw new Error("upsert");
    const data = await mutateStore((d) => d);
    expect(experimentVariant(data.bi.experiments, ops, "new_composer")).toMatch(/control|treatment/);
    const rb = await (await import("./bi")).biMutate({ action: "experiment.rollback", key: "new_composer" });
    if (!rb.ok) throw new Error("rb");
    const after = await mutateStore((d) => d.bi.experiments.find((e) => e.key === "new_composer"));
    expect(after?.status).toBe("rolled_back");
    expect(experimentVariant(after ? [after] : [], ops, "new_composer")).toBeNull();

    const staff = await mutateStore((d) => lookupStaff(d, ops));
    expect(staff?.role).toBe("super_admin");
  });

  it("does not throw when tracking from a nested product path", () => {
    expect(() => {
      trackBi({ name: "funnel.register_start", source: "nested" });
      trackBi({ name: "ui.session_start", source: "nested", consented: true, nonce: "sess-1" });
    }).not.toThrow();
  });
});
