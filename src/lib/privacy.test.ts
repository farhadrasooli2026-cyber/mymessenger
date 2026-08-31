import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile, publicProfile } from "./profile";
import { getOutbox } from "./outbox";
import { ackHumanChallenge, getUserById, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { resetStoreForTests } from "./store";
import { createGroup, addMembers } from "./groups";
import { findByIdentifier, updatePrivacy, requestDeletion } from "./privacy";

async function activeUser(username: string, channel: "email" | "phone" = "email", identifier?: string) {
  const ip = hashIp(`test-ip:${username}`);
  const issued = await issueHumanChallenge(ip);
  await ackHumanChallenge(issued.token, ip);
  const id = identifier ?? (channel === "email" ? `${username}@nixo.test` : "09120000000");
  const start = await startRegistration(
    { channel, identifier: id, humanToken: issued.token, website: "" },
    ip,
  );
  if (!start.ok) throw new Error("start");
  const code = getOutbox(start.challengeId)?.body.match(/\b(\d{6})\b/)?.[1] ?? "";
  const verified = await verifyOtp(start.challengeId, code, ip);
  if (!verified.ok) throw new Error("verify");
  const done = await completeProfile(verified.userId, {
    firstName: "حریم",
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

describe("NIXO privacy", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("hides email from strangers by default", async () => {
    const owner = await activeUser("pv_mail");
    const viewer = await activeUser("pv_see");
    const user = await getUserById(owner);
    expect(user).toBeTruthy();
    const view = publicProfile(user!, viewer);
    expect(view.identifierMasked).toBeUndefined();
    const own = publicProfile(user!, owner);
    expect(own.identifierMasked).toBeTruthy();
  });

  it("does not find a phone when find-privacy is nobody", async () => {
    const owner = await activeUser("pv_ph", "phone", "09123334455");
    const stranger = await activeUser("pv_str");
    await updatePrivacy(owner, { privacyFindPhone: "nobody" });
    const hit = await findByIdentifier(stranger, "09123334455");
    expect(hit.ok).toBe(true);
    if (hit.ok) expect(hit.user).toBeNull();
    await updatePrivacy(owner, { privacyFindPhone: "everyone" });
    const open = await findByIdentifier(stranger, "09123334455");
    expect(open.ok).toBe(true);
    if (open.ok) expect(open.user?.id).toBe(owner);
  });

  it("blocks adding a user to a group when they forbid it", async () => {
    const owner = await activeUser("pv_gown");
    const target = await activeUser("pv_gmem");
    await updatePrivacy(target, { privacyGroups: "nobody" });
    const created = await createGroup(owner, { name: "گروه حریم", memberKeys: [target] });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.group.members?.some((m: { key: string }) => m.key === target)).toBeFalsy();
    const added = await addMembers(owner, created.group.id, [target]);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.group.members?.some((m: { key: string }) => m.key === target)).toBeFalsy();
  });

  it("records a deletion request without exposing it to others", async () => {
    const user = await activeUser("pv_del");
    const result = await requestDeletion(user);
    expect(result.ok).toBe(true);
    const other = await activeUser("pv_del2");
    const viewed = publicProfile((await getUserById(user))!, other);
    expect((viewed as { deletionRequestedAt?: number }).deletionRequestedAt).toBeUndefined();
  });
});
