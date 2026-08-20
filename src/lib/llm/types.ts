import type { Provider, Season, StageDetail, Status } from "@/lib/constants";
import { SEASONS, STATUSES, STAGE_DETAILS } from "@/lib/constants";
import { isBlockedCompany } from "@/lib/ats";

export type Classification = {
  isApplicationRelated: boolean;
  companyName: string | null;
  companyDomain: string | null;
  roleTitle: string | null;
  season: Season | null;
  year: number | null;
  status: Status;
  stageDetail: StageDetail | null;
  isSignificant: boolean;
  emailTitle: string;
  confidenceScore: number;
  summary: string;
};

export type Usage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type ClassifyResult = {
  classification: Classification;
  usage: Usage;
  raw: string;
};

export type ProviderAdapter = {
  provider: Provider;
  model: string;
  /** Calls the provider's free model list endpoint. Proves the key works and the model exists (Q7). */
  checkKey(apiKey: string): Promise<{ ok: true } | { ok: false; message: string }>;
  classify(apiKey: string, system: string, user: string): Promise<ClassifyResult>;
};

/**
 * A structured answer that does not parse (LOOP Invariant 7).
 *
 * This is its own failure, not a transport failure. A 500 or a rate limit is
 * worth sending the identical request again; an answer cut off part way
 * through a string is not, because the identical request produces the identical
 * cut. The output cap is the likely cause, so it is tried once more with a
 * larger one, and the text that would not parse is carried on the error so it
 * can be stored and looked at rather than thrown away.
 */
export class MalformedOutputError extends Error {
  constructor(readonly raw: string, readonly detail: string) {
    super(`The model's answer did not parse: ${detail}`);
    this.name = "MalformedOutputError";
  }
}

/** Parses a provider's raw answer, or throws something that says what it was. */
export function parseRaw(raw: string): Classification {
  try {
    return parseClassification(JSON.parse(raw));
  } catch (error) {
    throw new MalformedOutputError(raw, error instanceof Error ? error.message : String(error));
  }
}

/**
 * One attempt, then one more with a larger cap if the answer was truncated.
 * Every adapter shares it, so the policy is written once.
 */
export async function withLargerCapOnce<T>(attempt: (maxTokens: number) => Promise<T>, cap: number) {
  try {
    return await attempt(cap);
  } catch (error) {
    if (!(error instanceof MalformedOutputError)) throw error;
    return attempt(cap * 4);
  }
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Turns whatever the provider returned into our shape, or throws. */
export function parseClassification(raw: unknown): Classification {
  if (!raw || typeof raw !== "object") throw new Error("Model returned no object");
  const value = raw as Record<string, unknown>;

  const status = String(value.status ?? "").toUpperCase();
  const stageDetail = String(value.stage_detail ?? "").toUpperCase();
  const season = text(value.season);
  const year = Number(value.year);
  const company = text(value.company_name);

  return {
    isApplicationRelated: value.is_application_related === true,
    // The last line of defence against an invented company (3.3).
    companyName: company && !isBlockedCompany(company) ? company : null,
    companyDomain: text(value.company_domain)?.toLowerCase().replace(/^www\./, "") ?? null,
    roleTitle: text(value.role_title),
    season: (SEASONS as readonly string[]).includes(season ?? "") ? (season as Season) : null,
    year: Number.isInteger(year) && year > 2000 && year < 2100 ? year : null,
    status: (STATUSES as readonly string[]).includes(status) ? (status as Status) : "APPLIED",
    stageDetail: (STAGE_DETAILS as readonly string[]).includes(stageDetail)
      ? (stageDetail as StageDetail)
      : null,
    isSignificant: value.is_significant === true,
    emailTitle: text(value.email_title) ?? "Application Email",
    confidenceScore: Number.isFinite(Number(value.confidence_score))
      ? Math.min(1, Math.max(0, Number(value.confidence_score)))
      : 0,
    summary: text(value.summary) ?? "",
  };
}
