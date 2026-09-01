import { describe, expect, it } from "vitest";
import { declaredExtAllowed, inspectZipSafety, sanitizeFileName, scanNamedFile, sniffFileBytes } from "./files";
import { scanAttachment } from "./media";

describe("files policy", () => {
  it("sanitizes path traversal names", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("a/b\\c.txt")).toBe("c.txt");
  });

  it("rejects html disguised as pdf name", () => {
    const html = new TextEncoder().encode("<!doctype html><script>x</script>");
    expect(sniffFileBytes(html).ok).toBe(false);
    expect(scanNamedFile("ok.exe", "application/octet-stream", 100).ok).toBe(false);
  });

  it("accepts pdf magic", () => {
    const pdf = new TextEncoder().encode("%PDF-1.4 extra bytes here");
    expect(sniffFileBytes(pdf).mime).toBe("application/pdf");
  });

  it("flags zip path traversal", () => {
    const name = "../evil.txt";
    const buf = new Uint8Array(30 + name.length);
    buf[0] = 0x50;
    buf[1] = 0x4b;
    buf[2] = 0x03;
    buf[3] = 0x04;
    buf[26] = name.length;
    buf[27] = 0;
    for (let i = 0; i < name.length; i += 1) buf[30 + i] = name.charCodeAt(i);
    expect(inspectZipSafety(buf).ok).toBe(false);
  });

  it("applies admin declared-extension allow list without trusting path", () => {
    expect(declaredExtAllowed(null, "pdf")).toBe(true);
    expect(declaredExtAllowed(["pdf", "docx"], "report.PDF")).toBe(true);
    expect(declaredExtAllowed(["pdf"], "xlsx")).toBe(false);
    expect(declaredExtAllowed(["txt"], "../../secret.txt")).toBe(true);
  });
});
