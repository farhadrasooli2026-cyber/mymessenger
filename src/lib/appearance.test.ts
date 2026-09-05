import { describe, expect, it } from "vitest";
import { defaultAppearance } from "./appearance-types";

describe("appearance defaults", () => {
  it("starts with NIXO dark theme and default backgrounds", () => {
    const a = defaultAppearance();
    expect(a.theme).toBe("dark");
    expect(a.appBackground.kind).toBe("default");
    expect(a.chatBackground.kind).toBe("default");
    expect(a.chatBgOpacity).toBe(100);
    expect(a.chatBgBlur).toBe(0);
    expect(a.syncAppearance).toBe(true);
    expect(a.bubbleStyle).toBe("rounded");
  });
});
