import { describe, expect, it } from "vitest";
import { inspectLink, inspectTextLinks } from "./link-safety";

describe("link safety", () => {
  it("warns on shorteners and javascript", () => {
    expect(inspectLink("https://tinyurl.com/abc").warn).toBe(true);
    expect(inspectLink("javascript:void(0)").warn).toBe(true);
    expect(inspectLink("http://127.0.0.1/admin").warn).toBe(true);
    expect(inspectTextLinks("ok https://example.com/a").warn).toBe(false);
  });
});
