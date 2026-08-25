import Anthropic from "@anthropic-ai/sdk";
import { jsonSchema } from "./schema";
import {
  attemptClassify,
  classifyResult,
  costOf,
  type ClassifyResult,
  type ProviderAdapter,
  type Rates,
} from "./types";
import { RetryableError } from "@/lib/retry";

/** Confirmed against the Claude API docs: $1 per million in, $5 per million out. */
const MODEL = "claude-haiku-4-5";
const RATES: Rates = { inputPerMTok: 1.0, outputPerMTok: 5.0 };
const MAX_TOKENS = 1024;

function client(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, maxRetries: 0 });
}

/**
 * The one request both public methods make.
 *
 * They differ only in the schema they ask for and the output cap they allow, so
 * sending the request and reading the answer out of it happens here once and
 * the two paths cannot drift apart.
 */
async function call(
  apiKey: string,
  system: string,
  user: string,
  schema: Record<string, unknown>,
  maxTokens: number,
): Promise<{ raw: string; inputTokens: number; outputTokens: number }> {
  let response;
  try {
    response = await client(apiKey).messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { format: { type: "json_schema", schema } },
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

  return {
    raw,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

export const anthropicAdapter: ProviderAdapter = {
  provider: "ANTHROPIC",
  model: MODEL,

  async checkKey(apiKey) {
    try {
      // Free, needs a working key, and proves our chosen model still exists.
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

  async ask(apiKey, system, user, schema) {
    const { raw, inputTokens, outputTokens } = await call(apiKey, system, user, schema, MAX_TOKENS);

    return {
      raw,
      usage: {
        model: MODEL,
        inputTokens,
        outputTokens,
        costUsd: costOf(RATES, inputTokens, outputTokens),
      },
    };
  },

  async classify(apiKey, system, user): Promise<ClassifyResult> {
    return attemptClassify(MAX_TOKENS, async (maxTokens) => {
      const { raw, inputTokens, outputTokens } = await call(
        apiKey,
        system,
        user,
        jsonSchema(),
        maxTokens,
      );

      return classifyResult({ model: MODEL, rates: RATES, raw, inputTokens, outputTokens });
    });
  },
};
