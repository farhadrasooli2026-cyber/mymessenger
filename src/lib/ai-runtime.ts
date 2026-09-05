import { runAiEngine, type AiEngineInput, type AiEngineOutput } from "@/lib/ai-engine";
import type { AiPolicy } from "@/lib/ai-types";

export function runLocal(input: AiEngineInput): AiEngineOutput {
  return runAiEngine(input);
}

export function runMock(input: AiEngineInput, policy: AiPolicy): AiEngineOutput {
  if (policy.mockFail) throw new Error("mock-provider-down");
  return runAiEngine(input);
}
