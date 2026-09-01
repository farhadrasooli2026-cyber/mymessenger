import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { getOutbox } from "./outbox";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { mutateStore, resetStoreForTests } from "./store";
import { enableTwoStep } from "./security";
import { clearStaffCookie, staffLogin, writeStaffCookie } from "./admin-moderation";
import { fingerprintError, redactMonitorText } from "./logger";
import {
  ackMonitorAlert,
  classifyRoute,
  flushMonitor,
  ingestClientError,
  monitorDashboard,
  nixoLog,
  publicHealth,
  recordApiHit,
  recoverMonitor,
  resetMonitorForTests,
  resolveMonitorAlert,
} from "./monitor";

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

describe("analytics monitoring", () => {
  afterEach(async () => {
    resetMonitorForTests();
    await clearStaffCookie();
    await resetStoreForTests();
  });

  it("blocks civilians, redacts secrets, and keeps aggregates privacy-safe", async () => {
    const civilian = await activeUser("mon_civilian_user");
    const denied = await monitorDashboard();
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.status).toBe(401);

    const ops = await activeUser("nixo_ops");
    const pw = "NixoAdminPass12";
    await enableTwoStep(ops, pw, "127.0.0.1");
    const login = await staffLogin(ops, pw, undefined, "127.0.0.1", "vitest");
    if (!login.ok) throw new Error(login.error);
    await writeStaffCookie(ops, login.sid);

    nixoLog("error", "api", "password=SuperSecret99 token=abc123 user@nixo.test");
    expect(redactMonitorText("password=SuperSecret99")).not.toContain("SuperSecret99");
    const dash = await monitorDashboard();
    expect(dash.ok).toBe(true);
    if (!dash.ok) throw new Error("dash");
    const blob = JSON.stringify(dash);
    expect(blob).not.toContain("SuperSecret99");
    expect(blob).not.toContain(civilian);
    expect(dash.privacy.storesPlaintextMessages).toBe(false);
    expect(dash.privacy.storesCallMedia).toBe(false);
    expect(dash.privacy.storesFileBytes).toBe(false);
    expect(dash.privacy.piiInMetrics).toBe(false);
    expect(dash.logs.some((l) => l.message.includes("SuperSecret99"))).toBe(false);
    expect(dash.health.services.api).toBeTruthy();
    expect(dash.api.slaTarget).toBe(99.9);

    expect(classifyRoute("/api/chats/deadbeefcafebabe/messages")).toBe("/api/chats/*/messages");
    expect(fingerprintError("api", "timeout 1200")).toBe(fingerprintError("api", "timeout 4400"));

    for (let i = 0; i < 20; i += 1) recordApiHit({ status: i < 5 ? 500 : 200, ms: 40, route: "/api/ping" });
    await flushMonitor();
    const afterHits = await monitorDashboard();
    if (!afterHits.ok) throw new Error("hits");
    expect(afterHits.api.requests).toBeGreaterThanOrEqual(20);
    expect(afterHits.api.errors).toBeGreaterThanOrEqual(5);

    const live = await publicHealth("live");
    expect(live.ok).toBe(true);
    const ready = await publicHealth("ready");
    expect(ready.ok).toBe(true);

    const recovered = await recoverMonitor();
    expect(recovered.ok).toBe(true);

    const client = await ingestClientError("TypeError at app password=hidden");
    expect(client.ok).toBe(true);

    const open = await mutateStore((data) => data.monitor?.alerts.find((a) => !a.resolvedAt)?.id ?? "");
    if (open) {
      const ack = await ackMonitorAlert(open);
      expect(ack.ok).toBe(true);
      const resolved = await resolveMonitorAlert(open);
      expect(resolved.ok).toBe(true);
    }
  });
});
