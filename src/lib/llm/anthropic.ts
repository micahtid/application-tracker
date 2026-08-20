import Anthropic from "@anthropic-ai/sdk";
import { jsonSchema } from "./schema";
import { parseClassification, type ClassifyResult, type ProviderAdapter } from "./types";
import { RetryableError, withRetry } from "@/lib/retry";

/** Confirmed against the Claude API docs: $1 per million in, $5 per million out. */
const MODEL = "claude-haiku-4-5";
const INPUT_PER_MTOK = 1.0;
const OUTPUT_PER_MTOK = 5.0;

function client(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, maxRetries: 0 });
}

export const anthropicAdapter: ProviderAdapter = {
  provider: "ANTHROPIC",
  model: MODEL,

  async checkKey(apiKey) {
    try {
      // Free, needs a working key, and proves our chosen model still exists (Q7).
      await client(apiKey).models.retrieve(MODEL);
      return { ok: true };
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        if (error.status === 401 || error.status === 403) {
          return { ok: false, message: "Key rejected. Check it and try again." };
        }
        if (error.status === 404) {
          return { ok: false, message: `Anthropic no longer offers ${MODEL}.` };
        }
        return { ok: false, message: `Anthropic said: ${error.message}` };
      }
      return { ok: false, message: "Could not reach Anthropic." };
    }
  },

  async classify(apiKey, system, user): Promise<ClassifyResult> {
    return withRetry(async () => {
      let response;
      try {
        response = await client(apiKey).messages.create({
          model: MODEL,
          max_tokens: 1024,
          system,
          messages: [{ role: "user", content: user }],
          output_config: { format: { type: "json_schema", schema: jsonSchema() } },
        } as Anthropic.MessageCreateParamsNonStreaming);
      } catch (error) {
        if (error instanceof Anthropic.APIError && error.status && error.status >= 429) {
          throw new RetryableError(error.message, error.status);
        }
        throw error;
      }

      const block = response.content.find((part) => part.type === "text");
      const raw = block && block.type === "text" ? block.text : "";
      if (!raw) throw new Error("Anthropic returned no text");

      const inputTokens = response.usage.input_tokens;
      const outputTokens = response.usage.output_tokens;

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
