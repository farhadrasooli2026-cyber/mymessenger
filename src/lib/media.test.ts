import { describe, expect, it } from "vitest";
import { formatBytes, scanAttachment } from "./media";

describe("media policy", () => {
  it("rejects dangerous executables", () => {
    const r = scanAttachment("setup.exe", "application/x-msdownload", 1200);
    expect(r.ok).toBe(false);
  });

  it("allows documents and images", () => {
    expect(scanAttachment("report.pdf", "application/pdf", 8000).ok).toBe(true);
    expect(scanAttachment("pic.jpg", "image/jpeg", 4000).mimeClass).toBe("image");
  });

  it("formats sizes", () => {
    expect(formatBytes(2048)).toContain("KB");
  });
});
