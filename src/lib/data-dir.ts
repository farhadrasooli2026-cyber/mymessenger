import { accessSync, constants, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let cached: string | null = null;

function canWriteDir(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Writable local data root for JSON store, photos, gallery, vault.
 * Render's Docker image runs as a non-root user with a read-only /app.
 */
export function dataDir(): string {
  if (cached) return cached;
  if (process.env.VITEST) {
    cached = path.join(process.cwd(), ".data");
    return cached;
  }
  const explicit = (process.env.NIXO_DATA_DIR || "").trim();
  if (explicit) {
    mkdirSync(explicit, { recursive: true });
    cached = explicit;
    return cached;
  }
  const local = path.join(process.cwd(), ".data");
  if (canWriteDir(local)) {
    cached = local;
    return cached;
  }
  const fallback = path.join(tmpdir(), ".data");
  mkdirSync(fallback, { recursive: true });
  cached = fallback;
  return cached;
}

export function resetDataDirForTests() {
  if (!process.env.VITEST) return;
  cached = null;
}
