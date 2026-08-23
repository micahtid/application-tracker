import { geminiSchema } from "./schema";
import {
  attemptClassify,
  classifyResult,
  throwForStatus,
  type ClassifyResult,
  type ProviderAdapter,
  type Rates,
} from "./types";

/**
 * Confirmed against the Gemini API docs: structured output through
 * responseSchema, $0.75 per million in and $3.75 per million out.
 * temperature, top_p and top_k are deprecated on this model, so none are sent.
 */
const MODEL = "gemini-3.7-flash";
const MAX_TOKENS = 2048;
const RATES: Rates = { inputPerMTok: 0.75, outputPerMTok: 3.75 };
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
    return attemptClassify(MAX_TOKENS, async (maxTokens) => {
      const response = await fetch(`${BASE}/models/${MODEL}:generateContent`, {
        method: "POST",
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: geminiSchema(),
            maxOutputTokens: maxTokens,
          },
        }),
      });

      if (!response.ok) await throwForStatus("Gemini", response);

      const body = (await response.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };

      const raw = (body.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? "")
        .join("")
        .trim();
      if (!raw) throw new Error("Gemini returned no content");

      return classifyResult({
        model: MODEL,
        rates: RATES,
        raw,
        inputTokens: body.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
      });
    });
  },
};
