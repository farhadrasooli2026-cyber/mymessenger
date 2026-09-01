/** In-memory platform mode so posting gates stay sync. */

import type { PlatformMode } from "@/lib/dr-types";

let cached: PlatformMode = "normal";

export function rememberPlatformMode(mode: PlatformMode) {
  cached = mode;
}

export function currentPlatformMode(): PlatformMode {
  return cached;
}
