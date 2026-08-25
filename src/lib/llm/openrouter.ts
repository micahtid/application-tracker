import { jsonSchema } from "./schema";
import {
  attemptClassify,
  classifyResult,
  costOf,
  throwForStatus,
  type ClassifyResult,
  type ProviderAdapter,
  type Rates,
} from "./types";

/**
 * Confirmed against OpenRouter's live model list: supports structured outputs,
 * $0.375 per million in and $1.875 per million out. OpenRouter also reports the
 * real cost on the response, which is preferred over our own sum.
 */
const MODEL = "google/gemini-3.7-flash";
const MAX_TOKENS = 1024;
const RATES: Rates = { inputPerMTok: 0.375, outputPerMTok: 1.875 };
const BASE = "https://openrouter.ai/api/v1";

const HEADERS = {
  "HTTP-Referer": "http://127.0.0.1:3939",
  "X-Title": "Internship Applications Tracker",
};

/**
 * The one request both public methods make.
 *
 * They differ only in the schema they ask for, the name they give it and the
 * output cap they allow, so sending the request and reading the answer out of
 * it happens here once and the two paths cannot drift apart.
 */
async function call(
  apiKey: string,
  system: string,
  user: string,
  schema: Record<string, unknown>,
  name: string,
  maxTokens: number,
): Promise<{
  raw: string;
  inputTokens: number;
  outputTokens: number;
  /** What OpenRouter says the call really cost, when it says. */
  reportedCostUsd?: number;
}> {
  const response = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...HEADERS },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      usage: { include: true },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
    }),
  });

  if (!response.ok) await throwForStatus("OpenRouter", response);

  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  };

  const raw = body.choices?.[0]?.message?.content ?? "";
  if (!raw) throw new Error("OpenRouter returned no content");

  return {
    raw,
    inputTokens: body.usage?.prompt_tokens ?? 0,
    outputTokens: body.usage?.completion_tokens ?? 0,
    reportedCostUsd: body.usage?.cost,
  };
}

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

  async ask(apiKey, system, user, schema, name) {
    const { raw, inputTokens, outputTokens, reportedCostUsd } = await call(
      apiKey,
      system,
      user,
      schema,
      name,
      MAX_TOKENS,
    );

    return {
      raw,
      usage: {
        model: MODEL,
        inputTokens,
        outputTokens,
        costUsd: reportedCostUsd ?? costOf(RATES, inputTokens, outputTokens),
      },
    };
  },

  async classify(apiKey, system, user): Promise<ClassifyResult> {
    return attemptClassify(MAX_TOKENS, async (maxTokens) => {
      const { raw, inputTokens, outputTokens, reportedCostUsd } = await call(
        apiKey,
        system,
        user,
        jsonSchema(),
        "email_classification",
        maxTokens,
      );

      return classifyResult({
        model: MODEL,
        rates: RATES,
        raw,
        inputTokens,
        outputTokens,
        // OpenRouter reports what the call really cost, which beats our sum.
        reportedCostUsd,
      });
    });
  },
};
