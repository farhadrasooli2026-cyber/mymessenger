/** Process lifecycle: drain, restart limits, ready gating. No secrets. */

let shuttingDown = false;
let restarts = 0;
let windowStart = Date.now();
const RESTART_WINDOW_MS = 60_000;
const RESTART_MAX = 5;

export function isShuttingDown() {
  return shuttingDown;
}

export function markShuttingDown() {
  shuttingDown = true;
}

export function recordCrashRestart(): { allowed: boolean; count: number } {
  const now = Date.now();
  if (now - windowStart > RESTART_WINDOW_MS) {
    windowStart = now;
    restarts = 0;
  }
  restarts += 1;
  return { allowed: restarts <= RESTART_MAX, count: restarts };
}

export function installProcessGuards() {
  if (process.env.VITEST) return;
  const onStop = (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(JSON.stringify({ level: "info", service: "lifecycle", msg: "graceful shutdown", sig }));
    setTimeout(() => process.exit(0), 8_000).unref();
  };
  process.once("SIGTERM", () => onStop("SIGTERM"));
  process.once("SIGINT", () => onStop("SIGINT"));
}

export function drainNote() {
  return {
    websocket: "existing sockets finish; LB stops new traffic via failed ready probe",
    sessions: "HttpOnly cookies stay valid; deploy does not revoke sessions",
    queues: "JSON store jobs survive process restart",
    cache: "in-memory cache rebuilds; private media stays authorized",
  };
}
