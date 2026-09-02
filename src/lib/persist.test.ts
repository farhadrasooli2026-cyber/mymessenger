import { describe, expect, it } from "vitest";
import { persistHealth, persistMode, productionPersistOk } from "./persist";
import { validateRuntimeConfig } from "./env-config";
import { deployedGitSha } from "./release";

describe("durable persist", () => {
  it("uses the file store during tests", () => {
    expect(persistMode()).toBe("file");
    expect(persistHealth().driver).toBe("file");
  });

  it("requires a database URL in production unless file store is explicitly allowed", () => {
    expect(productionPersistOk()).toBe(false);
    expect(validateRuntimeConfig("production").errors.some((e) => e.includes("database"))).toBe(true);
  });

  it("exposes the Render git SHA for deploy verification", () => {
    const prev = process.env.RENDER_GIT_COMMIT;
    process.env.RENDER_GIT_COMMIT = "233295edd57ca4578e5b259cfda9fd23e848307c";
    expect(deployedGitSha()).toBe("233295edd57ca4578e5b259cfda9fd23e848307c");
    if (prev === undefined) delete process.env.RENDER_GIT_COMMIT;
    else process.env.RENDER_GIT_COMMIT = prev;
  });
});
