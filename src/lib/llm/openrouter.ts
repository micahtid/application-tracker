import { jsonSchema } from "./schema";
import { parseClassification, type ClassifyResult, type ProviderAdapter } from "./types";
import { RetryableError, isRetryableStatus, withRetry } from "@/lib/retry";

/**
 * Confirmed against OpenRouter's live model list: supports structured outputs,
 * $0.375 per million in and $1.875 per million out. OpenRouter also reports the
 * real cost on the response, which is preferred over our own sum (Q8).
 */
const MODEL = "google/gemini-3.7-flash";
const INPUT_PER_MTOK = 0.375;
const OUTPUT_PER_MTOK = 1.875;
const BASE = "https://openrouter.ai/api/v1";

const HEADERS = {
  "HTTP-Referer": "http://127.0.0.1:3939",
  "X-Title": "Internship Applications Tracker",
};

export const openrouterAdapter: ProviderAdapter = {
  provider: "OPENROUTER",
  model: MODEL,

  async checkKey(apiKey) {
    try {
      const keyResponse = await fetch(`${BASE}/key`, {
        headers: { Authorization: `Bearer ${apiKey}`, ...HEADERS },
      });
      if (keyResponse.status === 401 || keyResponse.status === 403) {
        return { ok: false, message: "Key rejected. Check it and try again." };
      }
      if (!keyResponse.ok) {
        return { ok: false, message: `OpenRouter said: ${keyResponse.status}` };
      }

      const models = await fetch(`${BASE}/models`, { headers: HEADERS });
      if (models.ok) {
        const body = (await models.json()) as { data?: { id?: string }[] };
        const exists = body.data?.some((entry) => entry.id === MODEL);
        if (!exists) return { ok: false, message: `OpenRouter no longer offers ${MODEL}.` };
      }
      return { ok: true };
    } catch {
      return { ok: false, message: "Could not reach OpenRouter." };
    }
  },

  async classify(apiKey, system, user): Promise<ClassifyResult> {
    return withRetry(async () => {
      const response = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...HEADERS,
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 1024,
          usage: { include: true },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: {
            type: "json_schema",
            json_schema: { name: "email_classification", strict: true, schema: jsonSchema() },
          },
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        if (isRetryableStatus(response.status)) {
          throw new RetryableError(`OpenRouter ${response.status}: ${detail}`, response.status);
        }
        throw new Error(`OpenRouter ${response.status}: ${detail}`);
      }

      const body = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
      };

      const raw = body.choices?.[0]?.message?.content ?? "";
      if (!raw) throw new Error("OpenRouter returned no content");

      const inputTokens = body.usage?.prompt_tokens ?? 0;
      const outputTokens = body.usage?.completion_tokens ?? 0;
      const reported = body.usage?.cost;

      return {
        classification: parseClassification(JSON.parse(raw)),
        raw,
        usage: {
          model: MODEL,
          inputTokens,
          outputTokens,
          costUsd:
            typeof reported === "number"
              ? reported
              : (inputTokens / 1_000_000) * INPUT_PER_MTOK +
                (outputTokens / 1_000_000) * OUTPUT_PER_MTOK,
        },
      };
    });
  },
};
