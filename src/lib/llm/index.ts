import type { Provider } from "@/lib/constants";
import { anthropicAdapter } from "./anthropic";
import { geminiAdapter } from "./gemini";
import { openrouterAdapter } from "./openrouter";
import type { ProviderAdapter } from "./types";

const ADAPTERS: Record<Provider, ProviderAdapter> = {
  ANTHROPIC: anthropicAdapter,
  OPENROUTER: openrouterAdapter,
  GEMINI: geminiAdapter,
};

export function adapterFor(provider: Provider): ProviderAdapter {
  return ADAPTERS[provider];
}

/** What Settings shows next to each provider: the model we chose for it. */
export const PROVIDER_LABELS: Record<Provider, { label: string; model: string }> = {
  OPENROUTER: { label: "OpenRouter", model: openrouterAdapter.model },
  ANTHROPIC: { label: "Anthropic", model: anthropicAdapter.model },
  GEMINI: { label: "Gemini", model: geminiAdapter.model },
};

export * from "./types";
