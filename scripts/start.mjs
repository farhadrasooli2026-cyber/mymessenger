#!/usr/bin/env node
/**
 * Render / production start: migrate Postgres, then Next on $PORT.
 * Avoids npm-script shell PORT expansion and a missing `dist/` folder
 * (this app serves `.next`, not Vite `dist`).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const nextDir = path.join(root, ".next");
if (!existsSync(nextDir)) {
  console.error(
    JSON.stringify({
      service: "start",
      level: "error",
      msg: "missing_next_build",
      detail: "Expected .next from `npm run build`. This app is not a Vite dist/ static site.",
    }),
  );
  process.exit(1);
}

const migrate = spawnSync(process.execPath, [path.join(root, "scripts/migrate-postgres.mjs")], {
  stdio: "inherit",
  cwd: root,
  env: process.env,
});
if (migrate.status !== 0) {
  process.exit(migrate.status ?? 1);
}

const port = String(process.env.PORT || "43151").trim() || "43151";
const nextBin = path.join(root, "node_modules/next/dist/bin/next");
if (!existsSync(nextBin)) {
  console.error(JSON.stringify({ service: "start", level: "error", msg: "missing_next_binary" }));
  process.exit(1);
}

console.info(
  JSON.stringify({
    service: "start",
    msg: "next_start",
    port,
    gitSha: (process.env.RENDER_GIT_COMMIT || "").slice(0, 40),
    cwd: root,
  }),
);

const child = spawn(process.execPath, [nextBin, "start", "-H", "0.0.0.0", "-p", port], {
  stdio: "inherit",
  cwd: root,
  env: process.env,
});
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
