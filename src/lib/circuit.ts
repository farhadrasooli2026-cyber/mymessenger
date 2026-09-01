/** Circuit breaker for optional dependencies. Core paths must not import this for auth or messaging. */

export type CircuitState = "closed" | "open" | "half";

type Gate = { failures: number; openedAt: number; state: CircuitState };

const gates = new Map<string, Gate>();

const FAIL_OPEN = 8;
const OPEN_MS = 30_000;

export function circuitAllow(name: string, now = Date.now()): boolean {
  const g = gates.get(name);
  if (!g || g.state === "closed") return true;
  if (g.state === "open" && now - g.openedAt >= OPEN_MS) {
    g.state = "half";
    return true;
  }
  return g.state === "half";
}

export function circuitSuccess(name: string) {
  gates.set(name, { failures: 0, openedAt: 0, state: "closed" });
}

export function circuitFailure(name: string, now = Date.now()) {
  const g = gates.get(name) ?? { failures: 0, openedAt: 0, state: "closed" as CircuitState };
  g.failures += 1;
  if (g.failures >= FAIL_OPEN) {
    g.state = "open";
    g.openedAt = now;
  }
  gates.set(name, g);
}

export function circuitSnapshot() {
  return [...gates.entries()].map(([name, g]) => ({ name, state: g.state, failures: g.failures }));
}

export function resetCircuitsForTests() {
  gates.clear();
}
