import { describe, expect, it } from "vitest";
import { persistHealth, persistMode, productionPersistOk } from "./persist";
import { validateRuntimeConfig } from "./env-config";

describe("durable persist", () => {
  it("uses the file store during tests", () => {
    expect(persistMode()).toBe("file");
    expect(persistHealth().driver).toBe("file");
  });

  it("requires a database URL in production unless file store is explicitly allowed", () => {
    expect(productionPersistOk()).toBe(false);
    expect(validateRuntimeConfig("production").errors.some((e) => e.includes("database"))).toBe(true);
  });
});
