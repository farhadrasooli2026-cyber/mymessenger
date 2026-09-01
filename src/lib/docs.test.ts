import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DOC_API_PATHS,
  DOC_ENV_VARS,
  DOC_PAGES,
  DOC_SCRIPTS,
  DOCS_VERSION,
  getDoc,
  searchDocs,
} from "./docs-catalog";

describe("documentation catalog", () => {
  it("stays version-aligned, secret-free, and mapped to real routes", () => {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version: string; scripts: Record<string, string> };
    expect(DOCS_VERSION).toBe(pkg.version);
    for (const name of DOC_SCRIPTS) expect(pkg.scripts[name], name).toBeTruthy();

    const envEx = readFileSync(path.join(process.cwd(), ".env.example"), "utf8");
    for (const name of DOC_ENV_VARS) expect(envEx.includes(name), name).toBe(true);

    const slugs = DOC_PAGES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(getDoc("overview")?.title).toContain("نیکسو");
    expect(searchDocs("E2EE").some((p) => p.slug === "security")).toBe(true);
    expect(searchDocs("sse").length).toBeGreaterThan(0);

    const blob = DOC_PAGES.map((p) => p.body).join("\n");
    expect(blob).not.toMatch(/BEGIN (RSA |OPENSSH )?PRIVATE KEY/);
    expect(blob).not.toMatch(/AKIA[0-9A-Z]{16}/);
    expect(blob.toLowerCase()).not.toContain("nixoadminpass");

    for (const api of DOC_API_PATHS) {
      const file = path.join(process.cwd(), "src/app", api, "route.ts");
      expect(existsSync(file), file).toBe(true);
    }
  });
});
