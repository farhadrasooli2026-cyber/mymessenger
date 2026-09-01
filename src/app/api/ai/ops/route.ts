import { json, jsonError } from "@/lib/http";
import { aiOpsDashboard, aiOpsMutate } from "@/lib/ai";
import type { AiFeatureKey, AiPromptVersion, AiProviderId } from "@/lib/ai-types";

export async function GET() {
  const r = await aiOpsDashboard();
  if (!r.ok) return jsonError(r.error, r.status);
  return json(r);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return jsonError("درخواست نامعتبر است.");
  const r = await aiOpsMutate({
    action: body.action,
    enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    primaryProvider: body.primaryProvider as AiProviderId | undefined,
    fallbackProvider: body.fallbackProvider as AiProviderId | undefined,
    mockFail: typeof body.mockFail === "boolean" ? body.mockFail : undefined,
    feature: body.feature as AiFeatureKey | undefined,
    featureOn: typeof body.featureOn === "boolean" ? body.featureOn : undefined,
    promptVersion: body.promptVersion as AiPromptVersion | undefined,
    requireCredits: typeof body.requireCredits === "boolean" ? body.requireCredits : undefined,
    creditCost: typeof body.creditCost === "number" ? body.creditCost : undefined,
    costCapUsd: typeof body.costCapUsd === "number" ? body.costCapUsd : undefined,
    experimentName: typeof body.experimentName === "string" ? body.experimentName : undefined,
    experimentPercent: typeof body.experimentPercent === "number" ? body.experimentPercent : undefined,
    grantUserId: typeof body.grantUserId === "string" ? body.grantUserId : undefined,
    grantAmount: typeof body.grantAmount === "number" ? body.grantAmount : undefined,
  });
  if (!r.ok) return jsonError(r.error, r.status ?? 400);
  return json(r);
}
