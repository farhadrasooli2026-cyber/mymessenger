import { describe, expect, it } from "vitest";
import { otpauthUrl, randomTotpSecret, totpCode, totpValid } from "./totp";

describe("TOTP", () => {
  it("accepts the current window and rejects a wrong code", () => {
    const secret = randomTotpSecret();
    const now = Date.now();
    const code = totpCode(secret, now);
    expect(totpValid(secret, code, now)).toBe(true);
    expect(totpValid(secret, "000000", now)).toBe(false);
    expect(otpauthUrl(secret, "alice").startsWith("otpauth://totp/")).toBe(true);
  });
});
