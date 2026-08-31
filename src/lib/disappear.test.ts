import { describe, expect, it } from "vitest";
import {
  backupEligible,
  expireFromForKind,
  isMessageExpired,
  remainingMs,
  systemDisappearText,
} from "./disappear";

describe("disappear helpers", () => {
  it("starts photo/video/voice timers after view, text from send", () => {
    expect(expireFromForKind("text", false, 10_000)).toBe("send");
    expect(expireFromForKind("photo", false, 10_000)).toBe("view");
    expect(expireFromForKind("voice", true, 10_000)).toBe("view");
    expect(expireFromForKind("file", false, null)).toBeUndefined();
  });

  it("does not expire view-based media before viewed, even if send time passed", () => {
    const now = 1_000_000;
    expect(
      isMessageExpired(
        {
          createdAt: now - 60_000,
          expireFrom: "view",
          disappearAfterMs: 10_000,
          viewOnce: false,
          enc: "e2ee-v1",
          kind: "photo",
        },
        now,
      ),
    ).toBe(false);
    expect(
      isMessageExpired(
        {
          createdAt: now - 60_000,
          expireFrom: "view",
          disappearAfterMs: 10_000,
          viewedAt: now - 11_000,
          enc: "e2ee-v1",
          kind: "photo",
        },
        now,
      ),
    ).toBe(true);
  });

  it("expires text from send using server clock fields", () => {
    const now = 5_000_000;
    expect(
      isMessageExpired(
        { createdAt: now - 11_000, expireFrom: "send", disappearAfterMs: 10_000, enc: "e2ee-v1", kind: "text" },
        now,
      ),
    ).toBe(true);
  });

  it("keeps expired and view-once payloads out of ordinary backup", () => {
    const now = Date.now();
    expect(backupEligible({ createdAt: now, viewOnce: true, enc: "e2ee-v1", kind: "photo" }, now)).toBe(false);
    expect(backupEligible({ createdAt: now, enc: "purged", kind: "text" }, now)).toBe(false);
    expect(backupEligible({ createdAt: now, enc: "e2ee-v1", kind: "text" }, now)).toBe(true);
  });

  it("labels system timer notices", () => {
    expect(systemDisappearText(null)).toMatch(/خاموش/);
    expect(systemDisappearText(86_400_000)).toMatch(/۱ روز/);
    expect(remainingMs({ createdAt: 0, expiresAt: 50, expireFrom: "send" }, 40)).toBe(10);
  });
});
