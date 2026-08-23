import type { Provider } from "@/lib/constants";

/**
 * Which provider a key belongs to, worked out from the key itself. All three
 * stamp their keys with a distinct prefix, so there is no provider selector to
 * fill in.
 *
 * An unrecognised key is rejected rather than probed: trying all three
 * endpoints would send the key to two services it does not belong to.
 */
const PREFIXES: [string, Provider][] = [
  ["sk-ant-", "ANTHROPIC"],
  ["sk-or-", "OPENROUTER"],
  ["AIza", "GEMINI"],
];

export function detectProvider(apiKey: string): Provider | null {
  const key = apiKey.trim();
  for (const [prefix, provider] of PREFIXES) {
    if (key.startsWith(prefix)) return provider;
  }
  return null;
}

export const UNRECOGNISED_KEY =
  "That does not look like an OpenRouter, Anthropic, or Gemini key. They start with sk-or-, sk-ant-, and AIza.";
