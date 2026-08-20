import type { Provider } from "@/lib/constants";

/**
 * Which provider a key belongs to, worked out from the key itself.
 *
 * There is no provider selector: the three we support all stamp their keys with
 * a distinct prefix, so asking you to name the provider would be asking you to
 * repeat something the key already says.
 *
 * The prefixes are matched rather than guessed, and an unrecognised key is
 * rejected outright. Probing all three endpoints in turn would work too, but it
 * would send your key to two services it does not belong to, which is the wrong
 * trade for an app whose whole point is that nothing leaks.
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
