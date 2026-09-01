import { circuitAllow, circuitFailure, circuitSuccess } from "@/lib/circuit";
import { runAiEngine, type AiEngineInput, type AiEngineOutput } from "@/lib/ai-engine";
import type { AiPolicy, AiProviderId } from "@/lib/ai-types";

export type ProviderResult = AiEngineOutput & { provider: AiProviderId; fallback: boolean };

function runLocal(input: AiEngineInput): AiEngineOutput {
  return runAiEngine(input);
}

function runMock(input: AiEngineInput, policy: AiPolicy): AiEngineOutput {
  if (policy.mockFail) throw new Error("mock-provider-down");
  const out = runAiEngine(input);
  return { ...out, text: out.text };
}

export function completeWithFallback(policy: AiPolicy, input: AiEngineInput): ProviderResult {
  const order: AiProviderId[] = [policy.primaryProvider];
  if (policy.fallbackProvider !== policy.primaryProvider) order.push(policy.fallbackProvider);
  if (!order.includes("local")) order.push("local");

  let lastErr: string | null = null;
  for (let i = 0; i < order.length; i += 1) {
    const id = order[i]!;
    const gate = `ai-${id}`;
    if (!circuitAllow(gate)) {
      lastErr = "circuit-open";
      continue;
    }
    try {
      const out = id === "mock" ? runMock(input, policy) : runLocal(input);
      circuitSuccess(gate);
      return { ...out, provider: id === "mock" ? "mock" : "local", fallback: i > 0 };
    } catch (err) {
      circuitFailure(gate);
      lastErr = err instanceof Error ? err.message : "provider-fail";
    }
  }
  const out = runLocal(input);
  return {
    ...out,
    text: lastErr ? `${out.text}\n\n(ارائه‌دهندهٔ خارجی در دسترس نبود؛ موتور داخلی پاسخ داد.)` : out.text,
    provider: "local",
    fallback: true,
  };
}
