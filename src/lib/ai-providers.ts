import { circuitAllow, circuitFailure, circuitSuccess } from "@/lib/circuit";
import { runAiEngine, type AiEngineInput, type AiEngineOutput } from "@/lib/ai-engine";
import type { AiPolicy, AiProviderId } from "@/lib/ai-types";
import {
  completeLive,
  engineInputToLivePrompt,
  hasLiveAiKeys,
  logNixoAi,
  NixoAiUnavailableError,
  preferredLiveProvider,
} from "@/lib/nixo-ai-live";

export type ProviderResult = AiEngineOutput & { provider: AiProviderId; fallback: boolean };

function runLocal(input: AiEngineInput): AiEngineOutput {
  return runAiEngine(input);
}

function runMock(input: AiEngineInput, policy: AiPolicy): AiEngineOutput {
  if (policy.mockFail) throw new Error("mock-provider-down");
  return runAiEngine(input);
}

function allowOfflineLocal() {
  return !hasLiveAiKeys();
}

export async function completeWithFallback(policy: AiPolicy, input: AiEngineInput, system?: string): Promise<ProviderResult> {
  if (hasLiveAiKeys()) {
    const liveId = preferredLiveProvider() ?? "gemini";
    const gate = `ai-${liveId}`;
    if (!circuitAllow(gate)) {
      throw new NixoAiUnavailableError();
    }
    try {
      const packed = engineInputToLivePrompt(input);
      const live = await completeLive({
        prompt: packed.prompt,
        messages: packed.messages,
        system: system?.trim() || packed.system,
        timeoutMs: policy.timeoutMs,
      });
      circuitSuccess(gate);
      logNixoAi("provider-ok", { provider: live.provider, fallback: false, turns: packed.messages.length });
      return {
        text: live.text,
        refused: false,
        uncertain: true,
        intent: input.intent ?? "chat",
        provider: live.provider,
        fallback: false,
      };
    } catch (err) {
      circuitFailure(gate);
      logNixoAi("error", {
        where: "completeWithFallback",
        name: err instanceof Error ? err.name : "unknown",
        status: err instanceof NixoAiUnavailableError ? err.status : undefined,
      });
      throw new NixoAiUnavailableError();
    }
  }

  if (!allowOfflineLocal()) {
    throw new NixoAiUnavailableError();
  }

  const order: AiProviderId[] = [policy.primaryProvider];
  if (policy.fallbackProvider !== policy.primaryProvider) order.push(policy.fallbackProvider);
  if (!order.includes("local")) order.push("local");

  let lastErr: string | null = null;
  for (let i = 0; i < order.length; i += 1) {
    const id = order[i]!;
    if (id === "gemini" || id === "openai") continue;
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
  if (lastErr) throw new NixoAiUnavailableError();
  const out = runLocal(input);
  return { ...out, provider: "local", fallback: false };
}
