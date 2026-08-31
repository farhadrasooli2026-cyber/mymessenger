import { describe, expect, it } from "vitest";
import { normalizeUsername, usernameIssue } from "./username";

describe("username", () => {
  it("accepts valid handles and rejects reserved ones", () => {
    expect(normalizeUsername("arya.kian")).toBe("arya.kian");
    expect(normalizeUsername("@NixoUser1")).toBe("nixouser1");
    expect(normalizeUsername("nixo")).toBeNull();
    expect(normalizeUsername("ab")).toBeNull();
    expect(normalizeUsername("1user")).toBeNull();
    expect(normalizeUsername("admin")).toBeNull();
    expect(normalizeUsername("administrator")).toBeNull();
    expect(normalizeUsername("nixo_official")).toBeNull();
    expect(usernameIssue("bad name")).toBe("invalid");
    expect(usernameIssue("support")).toBe("reserved");
  });
});
