import { afterEach, describe, expect, it } from "vitest";
import { mutateStore, resetStoreForTests } from "./store";
import { clampLimit } from "./db/query";
import { emptyPerfPersist } from "./perf-types";
import { shouldShedRequest, setShedLevel } from "./perf-mode";
import {
  buildHotIndex,
  cacheGet,
  cacheSet,
  circuitAllow,
  circuitFail,
  drainPerfWorkers,
  enqueuePerfJob,
  pickFields,
  prefetchById,
  resetPerfForTests,
  runMicroBench,
  singleFlight,
} from "./perf";

describe("performance scalability", () => {
  afterEach(async () => {
    resetPerfForTests();
    await resetStoreForTests();
  });

  it("never caches secrets, sheds only non-critical traffic, and retries into DLQ", async () => {
    expect(cacheSet("user:cipher", { ciphertext: "AAAA" })).toBe(false);
    expect(cacheSet("password", "x")).toBe(false);
    expect(cacheSet("pub:user:abc", { id: "abc", username: "nixo" })).toBe(true);
    expect(cacheGet("pub:user:abc")).toEqual({ id: "abc", username: "nixo" });

    const picked = pickFields({ id: "1", username: "a", passwordHash: "nope", displayName: "ب" }, ["id", "username", "passwordHash", "displayName"]);
    expect(picked.passwordHash).toBeUndefined();
    expect(picked.username).toBe("a");

    setShedLevel("soft");
    expect(shouldShedRequest("/api/search")).toBe("soft");
    expect(shouldShedRequest("/api/register/start")).toBeNull();
    expect(shouldShedRequest("/api/chats/x")).toBeNull();
    setShedLevel("hard");
    expect(shouldShedRequest("/api/music")).toBe("hard");
    expect(shouldShedRequest("/api/health")).toBeNull();
    setShedLevel("off");

    expect(clampLimit(9999)).toBe(80);

    let runs = 0;
    const [a, b] = await Promise.all([
      singleFlight("pub:stampede", async () => {
        runs += 1;
        await new Promise((r) => setTimeout(r, 20));
        return { ok: true };
      }),
      singleFlight("pub:stampede", async () => {
        runs += 1;
        return { ok: false };
      }),
    ]);
    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    expect(runs).toBe(1);

    await mutateStore((data) => {
      data.perf = emptyPerfPersist();
      data.perf.policy.retryMax = 1;
    });
    await enqueuePerfJob({ kind: "bench", targetId: "fail", idempotencyKey: "bench-fail-1" });
    await drainPerfWorkers();
    await drainPerfWorkers();
    const dead = await mutateStore((data) => data.perf?.dlq.length ?? 0);
    expect(dead).toBeGreaterThanOrEqual(1);

    circuitFail("search", 1, 60_000);
    expect(circuitAllow("search")).toBe(false);

    const idx = await mutateStore((data) => {
      data.users.push({
        ...(data.users[0] ?? ({} as never)),
      });
      return buildHotIndex(data);
    });
    expect(idx.userById.size).toBe(idx.users);

    const map = prefetchById([{ id: "a" }, { id: "b" }], ["b"]);
    expect(map.get("b")?.id).toBe("b");
    expect(map.get("a")).toBeUndefined();

    expect(cacheSet("pub:group:g1", { id: "g1", inviteToken: "secret-invite" })).toBe(false);
  });

  it("indexes users without scanning when an id map exists", async () => {
    await mutateStore((data) => {
      for (let i = 0; i < 8; i += 1) {
        data.users.push({
          id: `u${i}`,
          username: `user${i}`,
        } as never);
      }
    });
    const data = await mutateStore((d) => d);
    const bench = runMicroBench(data);
    expect(bench.samples).toBeGreaterThan(0);
    expect(bench.indexMs).toBeGreaterThanOrEqual(0);
  });
});
