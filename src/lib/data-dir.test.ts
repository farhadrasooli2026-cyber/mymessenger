import { describe, expect, it } from "vitest";
import path from "node:path";
import { dataDir } from "./data-dir";

describe("dataDir", () => {
  it("uses the workspace .data folder during tests", () => {
    expect(dataDir()).toBe(path.join(process.cwd(), ".data"));
    expect(dataDir()).not.toBe(path.join("/app", ".data"));
  });
});
