import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { getOutbox } from "./outbox";
import { mutateStore, resetStoreForTests } from "./store";
import { emitNotification, invalidateNotifyPrefsCache, listNotifications, markNotify, muteTarget, updateNotifyPrefs } from "./notify";
import { appendAudit } from "./security";
import { createChannel, createPost, subscribe } from "./channels";
import { createGroup, sendGroupMessage } from "./groups";

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
    firstName: "اعلان",
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

describe("NIXO notifications", () => {
  afterEach(async () => {
    invalidateNotifyPrefsCache();
    await resetStoreForTests();
  });

  it("never puts E2EE ciphertext in notification body", async () => {
    const user = await activeUser("nt_e2ee");
    await mutateStore((data) => {
      emitNotification(data, {
        userId: user,
        category: "messages",
        kind: "message",
        title: "Ali",
        senderName: "Ali",
        body: "SECRET-CIPHERTEXT-PLAIN",
        e2ee: true,
        sourceId: "chat:ali",
        target: { type: "chat", id: "t1" },
      });
    });
    const list = await listNotifications(user, "messages");
    expect(list.items[0]?.body).not.toMatch(/SECRET-CIPHERTEXT/);
    expect(list.items[0]?.e2ee).toBe(true);
  });

  it("suppresses non-security during DND but delivers security alerts", async () => {
    const user = await activeUser("nt_dnd");
    await updateNotifyPrefs(user, { dnd: true, dndStart: "00:00", dndEnd: "23:59" });
    await mutateStore((data) => {
      emitNotification(data, {
        userId: user,
        category: "messages",
        kind: "message",
        title: "Ali",
        body: "hi",
        sourceId: "chat:a",
        target: { type: "chat", id: "t" },
      });
      appendAudit(data, user, "new_device", { detail: "New Login from unknown device" });
    });
    const list = await listNotifications(user);
    const msg = list.items.find((i) => i.kind === "message");
    const sec = list.items.find((i) => i.category === "security");
    expect(msg?.suppressed).toBe(true);
    expect(sec).toBeTruthy();
    expect(sec?.priority).toBe("critical");
    expect(sec?.suppressed).toBe(false);
    expect(list.counts.security).toBeGreaterThan(0);
  });

  it("honors mute chat and mark as read", async () => {
    const user = await activeUser("nt_mute");
    await muteTarget(user, "chat", "thread-1", null);
    await mutateStore((data) => {
      emitNotification(data, {
        userId: user,
        category: "messages",
        kind: "message",
        title: "B",
        sourceId: "chat:b",
        muteType: "chat",
        muteId: "thread-1",
        target: { type: "chat", id: "thread-1" },
      });
    });
    const list = await listNotifications(user);
    expect(list.items[0]?.suppressed).toBe(true);
    expect(list.counts.total).toBe(0);
    await mutateStore((data) => {
      emitNotification(data, {
        userId: user,
        category: "calls",
        kind: "incoming_voice",
        title: "Incoming Voice Call",
        sourceId: "call:x",
        target: { type: "call", id: "c1" },
      });
    });
    const open = await listNotifications(user, "calls");
    expect(open.counts.calls).toBeGreaterThan(0);
    await markNotify(user, "all", true);
    const after = await listNotifications(user);
    expect(after.counts.total).toBe(0);
  });

  it("does not notify muted channel subscribers and respects group e2ee", async () => {
    const owner = await activeUser("nt_own");
    const fan = await activeUser("nt_fan");
    const ch = await createChannel(owner, { name: "کانال اعلان", username: "nt_chan", visibility: "public" });
    expect(ch.ok).toBe(true);
    if (!ch.ok) return;
    await subscribe(fan, ch.channel.id);
    await mutateStore((data) => {
      const c = data.pubChannels.find((x) => x.id === ch.channel.id);
      const s = c?.subscribers.find((r) => r.userId === fan);
      if (s) s.notify = "off";
    });
    await createPost(owner, ch.channel.id, { body: "پست عمومی اعلان", kind: "text" });
    const fanList = await listNotifications(fan, "channels");
    expect(fanList.items.length).toBe(0);
    const g = await createGroup(owner, { name: "گروه اعلان", joinMode: "open", username: "nt_g_open", memberKeys: [fan] });
    expect(g.ok).toBe(true);
    if (!g.ok) return;
    const sent = await sendGroupMessage(owner, g.group.id, {
      enc: "e2ee-v1",
      ciphertext: "AAAAAAAA",
      nonce: "BBBBBBBB",
      mentions: [fan],
    });
    expect(sent.ok).toBe(true);
    const mentions = await listNotifications(fan, "groups");
    expect(mentions.items.some((i) => i.kind === "mention")).toBe(true);
    expect(mentions.items.every((i) => !i.body.includes("AAAAAAAA"))).toBe(true);
  });

  it("rate-limits notification spam from one source", async () => {
    const user = await activeUser("nt_spam");
    await mutateStore((data) => {
      for (let i = 0; i < 20; i += 1) {
        emitNotification(data, {
          userId: user,
          category: "bots",
          kind: "bot_push",
          title: "bot",
          body: `n${i}`,
          sourceId: "bot:spammer",
          target: { type: "bot", id: `b${i}` },
        });
      }
    });
    const list = await listNotifications(user, "bots");
    const live = list.items.filter((i) => !i.suppressed);
    expect(live.length).toBeLessThan(20);
  });

  it("isolates channel and group destinations and authorizes deep links", async () => {
    const owner = await activeUser("nt_iso_o");
    const stranger = await activeUser("nt_iso_s");
    const ch = await createChannel(owner, { name: "خصوصی اعلان", visibility: "private" });
    expect(ch.ok).toBe(true);
    if (!ch.ok) return;
    await mutateStore((data) => {
      const leaked = emitNotification(data, {
        userId: stranger,
        category: "channels",
        kind: "channel_post",
        title: "نباید ببینی",
        body: "secret-post",
        sourceId: `channel:${ch.channel.id}`,
        target: { type: "channel", id: ch.channel.id },
      });
      expect(leaked).toBeNull();
    });
    const stolen = await listNotifications(stranger, "channels");
    expect(stolen.items.some((i) => i.target.id === ch.channel.id)).toBe(false);
    let ownerId = "";
    await mutateStore((data) => {
      const rec = emitNotification(data, {
        userId: owner,
        category: "messages",
        kind: "message",
        title: "مالک",
        body: "hi",
        sourceId: "chat:self",
        target: { type: "chat", id: "synthetic" },
      });
      ownerId = rec?.id ?? "";
    });
    const { openNotification } = await import("./notify");
    const blocked = await openNotification(stranger, ownerId);
    expect(blocked.ok).toBe(false);
    const mine = await openNotification(owner, ownerId);
    expect(mine.ok).toBe(true);
  });

  it("delivers incoming calls during quiet hours, hides XSS, and queues push without leaking tokens", async () => {
    const user = await activeUser("nt_push");
    await updateNotifyPrefs(user, { dnd: true, dndStart: "00:00", dndEnd: "23:59", reactions: false });
    await mutateStore((data) => {
      emitNotification(data, {
        userId: user,
        category: "calls",
        kind: "incoming_voice",
        title: "Incoming Voice Call",
        sourceId: "call:in",
        target: { type: "call", id: "c-in" },
      });
      emitNotification(data, {
        userId: user,
        category: "groups",
        kind: "reaction",
        title: "گروه",
        sourceId: "g:r",
        target: { type: "group", id: "g1" },
      });
      emitNotification(data, {
        userId: user,
        category: "messages",
        kind: "message",
        title: "<script>alert(1)</script>Ali",
        body: "<img onerror=alert(1)>hi",
        sourceId: "chat:x",
        target: { type: "chat", id: "tx" },
      });
    });
    const calls = await listNotifications(user, "calls");
    expect(calls.items.find((i) => i.kind === "incoming_voice")?.suppressed).toBe(false);
    expect(calls.items.find((i) => i.kind === "incoming_voice")?.priority).toBe("high");
    const groups = await listNotifications(user, "groups");
    expect(groups.items.some((i) => i.kind === "reaction")).toBe(false);
    const msgs = await listNotifications(user, "messages");
    expect(msgs.items[0]?.title.toLowerCase()).not.toContain("<script");
    const { createDeviceSessionForUser } = await import("./security");
    const { registerPushToken, getNotifySnapshot } = await import("./notify");
    const { device } = await createDeviceSessionForUser({
      userId: user,
      ip: "127.0.0.1",
      userAgent: "NixoTest/1.0",
      approx: "test",
    });
    const token = await registerPushToken(user, device.id, {
      endpoint: "https://push.example/secret-endpoint-value-xyz",
      permission: "granted",
    });
    expect(token.ok).toBe(true);
    const snap = await getNotifySnapshot(user);
    expect(JSON.stringify(snap)).not.toContain("secret-endpoint-value");
    await updateNotifyPrefs(user, { dnd: false });
    await mutateStore((data) => {
      emitNotification(data, {
        userId: user,
        category: "system",
        kind: "system",
        title: "سیستم",
        body: "ok",
        sourceId: "sys:1",
        target: { type: "system", id: "s1" },
      });
    });
    const after = await listNotifications(user, "system");
    expect(after.items[0]?.pushState === "delivered" || after.items[0]?.state === "delivered").toBe(true);
    const page = await listNotifications(user, "all", 0, 2);
    expect(page.nextCursor === null || typeof page.nextCursor === "string").toBe(true);
  });

  it("deduplicates by event id, filters unread, and refuses silent security disable", async () => {
    const user = await activeUser("nt_idemp");
    let first = "";
    await mutateStore((data) => {
      const a = emitNotification(data, {
        userId: user,
        category: "messages",
        kind: "message",
        title: "Ali",
        body: "one",
        sourceId: "chat:idemp",
        eventId: "evt-same-1",
        target: { type: "chat", id: "tid" },
      });
      const b = emitNotification(data, {
        userId: user,
        category: "messages",
        kind: "message",
        title: "Ali",
        body: "two",
        sourceId: "chat:idemp",
        eventId: "evt-same-1",
        target: { type: "chat", id: "tid" },
      });
      first = a?.id ?? "";
      expect(b?.id).toBe(first);
    });
    const unread = await listNotifications(user, "all", 0, 40, { unread: true });
    expect(unread.items.length).toBeGreaterThan(0);
    expect(unread.items.every((i) => !i.read)).toBe(true);
    const silent = await updateNotifyPrefs(user, { enabled: { ...unread.prefs.enabled, security: false } });
    expect(silent.prefs.enabled.security).toBe(true);
    const acked = await updateNotifyPrefs(user, {
      enabled: { ...silent.prefs.enabled, security: false },
      securityDisableAck: true,
    });
    expect(acked.prefs.enabled.security).toBe(false);
    const { securePushPayload } = await import("./notify");
    const payload = securePushPayload({
      id: "n1",
      eventId: "e1",
      userId: user,
      category: "messages",
      kind: "message",
      title: "hi",
      body: "preview",
      senderName: "Ali",
      photoUrl: null,
      priority: "normal",
      e2ee: false,
      suppressed: false,
      readAt: null,
      deletedAt: null,
      createdAt: Date.now(),
      sourceId: "s",
      target: { type: "chat", id: "t" },
      pushState: "pending",
      groupKey: "g",
      collapsedCount: 1,
    });
    expect(JSON.stringify(payload)).not.toMatch(/password|token|session|secret/i);
  });
});
