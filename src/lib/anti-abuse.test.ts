import { describe, expect, it } from "vitest";
import { nextAuditChainHash, scanUploadBytes, verifyAuditChain } from "./anti-abuse";
import {
  impossibleTravel,
  isPrivateHost,
  mutatingContentTypeOk,
  redactLogText,
  safeRedirectPath,
  stripSensitive,
  timestampFresh,
} from "./safe-web";

describe("anti-abuse helpers", () => {
  it("blocks open redirects", () => {
    expect(safeRedirectPath("/app/settings/security")).toBe("/app/settings/security");
    expect(safeRedirectPath("https://evil.example")).toBeNull();
    expect(safeRedirectPath("//evil.example")).toBeNull();
    expect(safeRedirectPath("/\\evil")).toBeNull();
  });

  it("strips credentials from objects but keeps setup secrets named secret", () => {
    const out = stripSensitive({
      password: "hunter2",
      passwordHash: "abc",
      displayName: "Ali",
      secret: "totp-setup",
      refreshToken: "rotate-me",
    }) as Record<string, unknown>;
    expect(out.password).toBeUndefined();
    expect(out.passwordHash).toBeUndefined();
    expect(out.displayName).toBe("Ali");
    expect(out.secret).toBe("totp-setup");
    expect(out.refreshToken).toBe("rotate-me");
  });

  it("redacts secrets in log text", () => {
    expect(redactLogText("password=super-secret token=abc")).toContain("[redacted]");
    expect(redactLogText("password=super-secret")).not.toContain("super-secret");
  });

  it("detects private SSRF hosts", () => {
    expect(isPrivateHost("127.0.0.1")).toBe(true);
    expect(isPrivateHost("10.1.2.3")).toBe(true);
    expect(isPrivateHost("169.254.169.254")).toBe(true);
    expect(isPrivateHost("example.com")).toBe(false);
  });

  it("detects impossible travel within two hours", () => {
    const t = Date.now();
    expect(impossibleTravel({ country: "US", at: t }, { country: "IR", at: t + 60_000 })).toBe(true);
    expect(impossibleTravel({ country: "US", at: t }, { country: "US", at: t + 60_000 })).toBe(false);
    expect(impossibleTravel({ country: "US", at: t }, { country: "IR", at: t + 3 * 60 * 60_000 })).toBe(false);
  });

  it("validates timestamps and mutating content types", () => {
    expect(timestampFresh(Date.now())).toBe(true);
    expect(timestampFresh(Date.now() - 10 * 60_000)).toBe(false);
    const json = new Headers({ "content-type": "application/json" });
    const html = new Headers({ "content-type": "text/html" });
    expect(mutatingContentTypeOk(json, "POST")).toBe(true);
    expect(mutatingContentTypeOk(html, "POST")).toBe(false);
    expect(mutatingContentTypeOk(html, "GET")).toBe(true);
  });

  it("chains audit hashes and scans upload bytes by magic", () => {
    const a = { id: "1", kind: "login" as const, createdAt: 1, userId: "u", detail: "a" };
    const h1 = nextAuditChainHash("genesis", a);
    const b = { id: "2", kind: "logout" as const, createdAt: 2, userId: "u", detail: "b" };
    const h2 = nextAuditChainHash(h1, b);
    expect(
      verifyAuditChain([
        { id: "2", kind: "logout", createdAt: 2, userId: "u", detail: "b", chainHash: h2 },
        { id: "1", kind: "login", createdAt: 1, userId: "u", detail: "a", chainHash: h1 },
      ]),
    ).toBe(true);
    expect(
      verifyAuditChain([
        { id: "2", kind: "logout", createdAt: 2, userId: "u", detail: "b", chainHash: "tampered" },
        { id: "1", kind: "login", createdAt: 1, userId: "u", detail: "a", chainHash: h1 },
      ]),
    ).toBe(false);
    const html = new TextEncoder().encode("<script>x</script>");
    expect(scanUploadBytes(html).ok).toBe(false);
  });
});
