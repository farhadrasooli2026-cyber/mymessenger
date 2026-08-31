import { afterEach, describe, expect, it } from "vitest";
import { hashIp } from "./crypto-utils";
import { completeProfile } from "./profile";
import { ackHumanChallenge, issueHumanChallenge, startRegistration, verifyOtp } from "./registration";
import { getOutbox } from "./outbox";
import { resetStoreForTests } from "./store";
import { addMusicTrack, getMusicFile, listMusic, savePlaylist, signMusic, toggleFavorite } from "./music";
import { sniffMagic } from "./media";

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
    firstName: "صوت",
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

function wavBytes() {
  const sampleRate = 8000;
  const n = 200;
  const data = Buffer.alloc(n * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const WAV = `data:audio/wav;base64,${wavBytes().toString("base64")}`;

describe("NIXO music", () => {
  afterEach(async () => {
    await resetStoreForTests();
  });

  it("accepts wav magic and rejects html", () => {
    expect(sniffMagic(wavBytes()).ok).toBe(true);
    expect(sniffMagic(wavBytes()).mime).toBe("audio/wav");
    expect(sniffMagic(Buffer.from("<html>x")).ok).toBe(false);
  });

  it("keeps uploads owner-only even with a stolen token", async () => {
    const owner = await activeUser("mus_own");
    const other = await activeUser("mus_oth");
    const created = await addMusicTrack(owner, { name: "Artist - Track.wav", dataUrl: WAV, kind: "song" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.item.artist).toBe("Artist");
    const listed = await listMusic(owner);
    expect(listed.items.some((i) => i.id === created.item.id)).toBe(true);
    const otherList = await listMusic(other);
    expect(otherList.items.every((i) => i.id !== created.item.id)).toBe(true);
    const stolen = signMusic(created.item.id, other);
    const denied = await getMusicFile(other, created.item.id, stolen);
    expect(denied.ok).toBe(false);
    const ok = await getMusicFile(owner, created.item.id, signMusic(created.item.id, owner));
    expect(ok.ok).toBe(true);
    const pl = await savePlaylist(owner, { name: "Workout", trackIds: [created.item.id] });
    expect(pl.ok).toBe(true);
    const found = await listMusic(owner, { q: "workout" });
    expect(found.playlists.some((p) => p.name === "Workout")).toBe(true);
    expect(listed.stats.music).toBeGreaterThan(0);
    expect(listed.cleanup).toBeDefined();
    const fav = await toggleFavorite(owner, created.item.id);
    expect(fav.ok && fav.favorite).toBe(true);
    expect(listed.catalog.some((c) => c.licensed)).toBe(true);
  });
});
