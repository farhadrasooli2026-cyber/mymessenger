import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { getOutbox } from "./outbox";
import { resetStoreForTests } from "./store";
import { createGroup } from "./groups";
import { actLive, createLive, getLive, listLives } from "./live";
import { collectSearchHits } from "./search";
import { readStoreSnapshot } from "./store";

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
    firstName: "لایو",
    lastName: "آزمایش",
    username,
    bio: "",
    privacyPhoto: "everyone",
    privacyBio: "everyone",
    photoAllowIds: [],
    bioAllowIds: [],
  });
  if (!done.ok) throw new Error("profile");
  return verified.userId;
}

describe("live streaming access", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("blocks IDOR on private live and keeps private titles out of public search", async () => {
    const host = await activeUser("livehost1");
    const other = await activeUser("liveguest1");
    const made = await createLive(host, { title: "جلسه محرمانه نیکسو", visibility: "private" });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const steal = await getLive(other, made.live.id);
    expect(steal.ok).toBe(false);
    const data = await readStoreSnapshot();
    const hits = collectSearchHits(data, other, { q: "محرمانه", kind: "live" });
    expect(hits.some((h) => h.target.id === made.live.id)).toBe(false);
  });

  it("lists public discovery and rejects join after end", async () => {
    const host = await activeUser("livehost2");
    const viewer = await activeUser("liveview2");
    const made = await createLive(host, { title: "گفتگوی عمومی نیکسو", visibility: "public", category: "talk" });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    await actLive(host, made.live.id, "start");
    const disc = await listLives(viewer, "discovery");
    expect(disc.items.some((i) => i.id === made.live.id)).toBe(true);
    const joined = await actLive(viewer, made.live.id, "join");
    expect(joined.ok).toBe(true);
    await actLive(host, made.live.id, "end");
    const again = await actLive(viewer, made.live.id, "join");
    expect(again.ok).toBe(false);
  });

  it("group live requires membership", async () => {
    const owner = await activeUser("livegrpown");
    const outsider = await activeUser("livegrpout");
    const g = await createGroup(owner, { name: "گروه لایو", memberKeys: [] });
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    const made = await createLive(owner, { title: "Live گروه", scope: "group", groupId: g.group.id, visibility: "members" });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const denied = await actLive(outsider, made.live.id, "join");
    expect(denied.ok).toBe(false);
  });
});
