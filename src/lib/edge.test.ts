import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { getOutbox } from "./outbox";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { resetStoreForTests } from "./store";
import { enableTwoStep } from "./security";
import { clearStaffCookie, staffLogin, writeStaffCookie } from "./admin-moderation";
import { roleHasPerm } from "./admin-types";
import {
  cacheControlFor,
  classifyPath,
  defaultPops,
  hostAllowed,
  isOpenRedirect,
  percentile,
  pickImageFormat,
  publicCacheKey,
  routeToPop,
  sharedCacheAllowed,
  signedExpired,
  wsGatewayFor,
} from "./edge-policy";
import { EDGE_CONFIRM } from "./edge-types";
import { edgeDashboard, edgeMutate, ingestEdgeRum } from "./edge";

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
    firstName: "لبه",
    lastName: "سی‌دی‌ان",
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

describe("edge CDN policy", () => {
  afterEach(async () => {
    await clearStaffCookie();
    await resetStoreForTests();
  });

  it("never shared-caches private APIs, signed tokens, or cookie-bound responses", () => {
    expect(classifyPath("/_next/static/chunk.js")).toBe("static");
    expect(classifyPath("/api/chats/abc")).toBe("api-private");
    expect(classifyPath("/api/storage/x/media")).toBe("media-private");
    expect(cacheControlFor("api-private")).toMatch(/no-store/);
    expect(sharedCacheAllowed({ path: "/api/chats", cookie: "nixo_reg=abc" })).toBe(false);
    expect(sharedCacheAllowed({ path: "/_next/static/a.js" })).toBe(true);
    expect(publicCacheKey("nixo.example", "/api/storage/1", "?t=secret-token")).toBeNull();
    expect(publicCacheKey("nixo.example", "/_next/static/a.js", "")).toContain("/_next/static/a.js");
    expect(signedExpired(Date.now() - 1000)).toBe(true);
    expect(isOpenRedirect("https://evil.test")).toBe(true);
    expect(isOpenRedirect("/app")).toBe(false);
    expect(hostAllowed("evil.test", ["nixo.example"])).toBe(false);
    expect(pickImageFormat("image/avif,image/webp")).toBe("avif");
    expect(percentile([10, 20, 30, 40, 100], 50)).toBeGreaterThan(0);
    const pops = defaultPops();
    pops[0]!.healthy = false;
    expect(routeToPop(pops, { country: "DE", latency: true })?.id).not.toBe("fra");
    expect(wsGatewayFor(pops[1]!, "user-session-1")).toMatch(/gw-/);
    expect(roleHasPerm("analyst", "edge.view")).toBe(true);
    expect(roleHasPerm("analyst", "edge.manage")).toBe(false);
  });

  it("requires purge permission and blocks private prefixes", async () => {
    const ops = await activeUser("nixo_ops");
    const pw = "NixoAdminPass12";
    await enableTwoStep(ops, pw, "127.0.0.1");
    const login = await staffLogin(ops, pw, undefined, "127.0.0.1", "vitest");
    if (!login.ok) throw new Error(login.error);
    await writeStaffCookie(ops, login.sid);
    const denied = await edgeMutate({ action: "purge", prefix: "/_next/static" });
    expect(denied.ok).toBe(false);
    const priv = await edgeMutate({ action: "purge", confirm: EDGE_CONFIRM.purge, prefix: "/api/chats" });
    expect(priv.ok).toBe(false);
    const ok = await edgeMutate({ action: "purge", confirm: EDGE_CONFIRM.purge, prefix: "/_next/static" });
    expect(ok.ok).toBe(true);
    const dash = await edgeDashboard();
    expect(dash.ok).toBe(true);
    if (!dash.ok) return;
    expect(dash.cache.api).toMatch(/no-store/);
    expect(dash.config.originHost).toContain("internal");
    await ingestEdgeRum({ ipHash: "abcd", ms: 40, kind: "static", pop: "iad" });
    const syn = await edgeMutate({ action: "synthetic" });
    expect(syn.ok).toBe(true);
  });
});
