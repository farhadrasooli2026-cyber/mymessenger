import { describe, expect, it } from "vitest";
import { databaseUrl, persistHealth, persistMode, productionPersistOk } from "./persist";
import { validateRuntimeConfig } from "./env-config";
import { deployedGitSha } from "./release";

describe("durable persist", () => {
  it("skips Postgres migrate during tests", async () => {
    const { migratePostgres } = await import("./persist");
    const result = await migratePostgres();
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it("requires a database URL in production unless file store is explicitly allowed", () => {
    expect(productionPersistOk()).toBe(false);
    expect(validateRuntimeConfig("production").errors.some((e) => e.includes("database"))).toBe(true);
  });

  it("strips wrapping quotes from DATABASE_URL", async () => {
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = '"postgres://nixo:secret@db.example:5432/nixo"';
    expect(databaseUrl()).toBe("postgres://nixo:secret@db.example:5432/nixo");
    if (prev === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prev;
  });

  it("exposes the Render git SHA for deploy verification", () => {
    const prev = process.env.RENDER_GIT_COMMIT;
    process.env.RENDER_GIT_COMMIT = "233295edd57ca4578e5b259cfda9fd23e848307c";
    expect(deployedGitSha()).toBe("233295edd57ca4578e5b259cfda9fd23e848307c");
    if (prev === undefined) delete process.env.RENDER_GIT_COMMIT;
    else process.env.RENDER_GIT_COMMIT = prev;
  });
});
