/** On-demand UGC translation. Never send private content without permission. */

export type TranslateProviderId = "none" | "mock";

export type TranslateRequest = {
  text: string;
  to: string;
  permission: boolean;
  privateContent?: boolean;
};

export type TranslateResult = { ok: true; text: string; provider: TranslateProviderId } | { ok: false; text: string; reason: string };

export interface UgcTranslateProvider {
  id: TranslateProviderId;
  translate(req: TranslateRequest): Promise<TranslateResult>;
}

const noneProvider: UgcTranslateProvider = {
  id: "none",
  async translate(req) {
    return { ok: false, text: req.text, reason: "provider_none" };
  },
};

const mockProvider: UgcTranslateProvider = {
  id: "mock",
  async translate(req) {
    if (!req.permission) return { ok: false, text: req.text, reason: "permission_denied" };
    if (req.privateContent) return { ok: false, text: req.text, reason: "private_denied" };
    if (!req.text) return { ok: true, text: req.text, provider: "mock" };
    return { ok: true, text: `[${req.to}] ${req.text}`, provider: "mock" };
  },
};

const registry: Record<TranslateProviderId, UgcTranslateProvider> = {
  none: noneProvider,
  mock: mockProvider,
};

export function getTranslateProvider(id: TranslateProviderId | string | null | undefined): UgcTranslateProvider {
  if (id === "mock") return registry.mock;
  return registry.none;
}

export async function translateUgc(req: TranslateRequest, id: TranslateProviderId = "none"): Promise<TranslateResult> {
  try {
    return await getTranslateProvider(id).translate(req);
  } catch {
    return { ok: false, text: req.text, reason: "provider_failed" };
  }
}
