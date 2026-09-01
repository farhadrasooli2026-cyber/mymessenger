import { emptyProdPersist, type ProdPersist } from "@/lib/prod-types";

export type { ProdPersist };
export { emptyProdPersist };

export function hydrateProdPersist(raw: unknown): ProdPersist {
  const base = emptyProdPersist();
  if (!raw || typeof raw !== "object") return base;
  const rec = raw as Partial<ProdPersist>;
  return {
    freeze: Boolean(rec.freeze),
    freezeReason: typeof rec.freezeReason === "string" ? rec.freezeReason.slice(0, 200) : "",
    freezeAt: typeof rec.freezeAt === "number" ? rec.freezeAt : null,
    freezeActorHint: typeof rec.freezeActorHint === "string" ? rec.freezeActorHint.slice(0, 16) : null,
    approvals: Array.isArray(rec.approvals) ? rec.approvals.slice(-80) : [],
    incidents: Array.isArray(rec.incidents) ? rec.incidents.slice(0, 80) : [],
    postmortems: Array.isArray(rec.postmortems) ? rec.postmortems.slice(-80) : [],
    smokeRuns: Array.isArray(rec.smokeRuns) ? rec.smokeRuns.slice(-20) : [],
    lastScore: typeof rec.lastScore === "number" ? rec.lastScore : null,
    lastEvaluatedAt: typeof rec.lastEvaluatedAt === "number" ? rec.lastEvaluatedAt : null,
  };
}
