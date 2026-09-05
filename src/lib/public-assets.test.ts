import { describe, expect, it } from "vitest";
import {
  NIXO_LOGO,
  isPublicAvatarPath,
  isPublicBackgroundPath,
  publicAvatarFor,
  PUBLIC_AVATARS,
  PUBLIC_BACKGROUNDS,
} from "./public-assets";

describe("public static assets", () => {
  it("exposes the app logo and named avatar/background files", () => {
    expect(NIXO_LOGO).toBe("/Nixo-logo.png");
    expect(PUBLIC_AVATARS.some((a) => a.path === "/avatars/avatar-1.jpg")).toBe(true);
    expect(PUBLIC_AVATARS.some((a) => a.path === "/avatars/boy-1.jpg")).toBe(true);
    expect(PUBLIC_BACKGROUNDS.some((b) => b.path === "/backgrounds/bg-1.jpg")).toBe(true);
    expect(PUBLIC_BACKGROUNDS.some((b) => b.path === "/backgrounds/bg-3.png")).toBe(true);
  });

  it("only allows catalog public paths", () => {
    expect(isPublicAvatarPath("/avatars/girl-1.jpg")).toBe(true);
    expect(isPublicAvatarPath("/avatars/../Nixo-logo.png")).toBe(false);
    expect(isPublicBackgroundPath("/backgrounds/bg-2.jpg")).toBe(true);
    expect(isPublicBackgroundPath("/wallpapers/aurora.svg")).toBe(true);
    expect(isPublicBackgroundPath("https://evil.test/x.jpg")).toBe(false);
  });

  it("picks a stable default avatar from a seed", () => {
    expect(publicAvatarFor("arya")).toBe(publicAvatarFor("arya"));
    expect(publicAvatarFor("group-a", "group")).toMatch(/\/avatars\/group-/);
  });
});
