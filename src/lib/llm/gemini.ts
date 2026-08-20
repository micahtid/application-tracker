import { geminiSchema } from "./schema";
import { parseClassification, type ClassifyResult, type ProviderAdapter } from "./types";
import { RetryableError, isRetryableStatus, withRetry } from "@/lib/retry";

/**
 * Confirmed against the Gemini API docs: structured output through
 * responseSchema, $0.75 per million in and $3.75 per million out.
 * temperature, top_p and top_k are deprecated on this model, so none are sent.
 */
const MODEL = "gemini-3.7-flash";
const INPUT_PER_MTOK = 0.75;
const OUTPUT_PER_MTOK = 3.75;
const BASE = "https://generativelanguage.googleapis.com/v1beta";

export const geminiAdapter: ProviderAdapter = {
  provider: "GEMINI",
  model: MODEL,

  async checkKey(apiKey) {
    try {
      const response = await fetch(`${BASE}/models?pageSize=200`, {
        headers: { "x-goog-api-key": apiKey },
      });
      if (response.status === 400 || response.status === 401 || response.status === 403) {
        return { ok: false, message: "Key rejected. Check it and try again." };
      }
      if (!response.ok) return { ok: false, message: `Gemini said: ${response.status}` };

      const body = (await response.json()) as { models?: { name?: string }[] };
      const exists = body.models?.some((entry) => entry.name === `models/${MODEL}`);
      if (body.models && !exists) {
        return { ok: false, message: `Google no longer offers ${MODEL}.` };
      }
      return { ok: true };
    } catch {
      return { ok: false, message: "Could not reach Google." };
    }
  },

  async classify(apiKey, system, user): Promise<ClassifyResult> {
    return withRetry(async () => {
      const response = await fetch(`${BASE}/models/${MODEL}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: geminiSchema(),
            maxOutputTokens: 2048,
          },
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        if (isRetryableStatus(response.status)) {
          throw new RetryableError(`Gemini ${response.status}: ${detail}`, response.status);
        }
        throw new Error(`Gemini ${response.status}: ${detail}`);
      }

      const body = (await response.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };

      const raw = (body.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? "")
        .join("")
        .trim();
      if (!raw) throw new Error("Gemini returned no content");

      const inputTokens = body.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = body.usageMetadata?.candidatesTokenCount ?? 0;

      return {
        classification: parseClassification(JSON.parse(raw)),
        raw,
        usage: {
          model: MODEL,
          inputTokens,
          outputTokens,
          costUsd:
            (inputTokens / 1_000_000) * INPUT_PER_MTOK +
            (outputTokens / 1_000_000) * OUTPUT_PER_MTOK,
        },
      };
    });
  },
};
