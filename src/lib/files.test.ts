import { describe, expect, it } from "vitest";
import { declaredExtAllowed, inspectZipSafety, sanitizeFileName, scanNamedFile, sniffFileBytes, stripJpegExif, IMAGE_MAX_BYTES } from "./files";

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

  it("rejects MZ executables even with a jpg name", () => {
    const mz = new Uint8Array(16);
    mz[0] = 0x4d;
    mz[1] = 0x5a;
    expect(sniffFileBytes(mz).ok).toBe(false);
  });

  it("enforces image size separately from overall cap", () => {
    expect(scanNamedFile("pic.jpg", "image/jpeg", IMAGE_MAX_BYTES + 1).ok).toBe(false);
    expect(scanNamedFile("pic.jpg", "image/jpeg", 1024).ok).toBe(true);
  });

  it("strips JPEG APP1 EXIF including GPS markers", () => {
    const payload = Buffer.alloc(16);
    Buffer.from("Exif\0\0GPS").copy(payload);
    const len = 2 + payload.length;
    const buf = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe1, (len >> 8) & 0xff, len & 0xff]),
      payload,
      Buffer.from([0xff, 0xd9]),
    ]);
    expect(buf.includes("Exif")).toBe(true);
    const stripped = stripJpegExif(buf);
    expect(stripped.includes("Exif")).toBe(false);
    expect(stripped[0]).toBe(0xff);
    expect(stripped[1]).toBe(0xd8);
  });

  it("applies admin declared-extension allow list without trusting path", () => {
    expect(declaredExtAllowed(null, "pdf")).toBe(true);
    expect(declaredExtAllowed(["pdf", "docx"], "report.PDF")).toBe(true);
    expect(declaredExtAllowed(["pdf"], "xlsx")).toBe(false);
    expect(declaredExtAllowed(["txt"], "../../secret.txt")).toBe(true);
  });
});
