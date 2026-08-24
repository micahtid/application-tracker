import type { EmailEvent, Outcome, Provider, Season, SenderRole, StageDetail, Status } from "@/lib/constants";
import {
  EMAIL_EVENTS,
  EMAIL_EVENT_FALLBACK,
  OUTCOMES,
  SEASONS,
  SENDER_ROLES,
  SENDER_ROLE_FALLBACK,
  STATUSES,
  STAGE_DETAILS,
} from "@/lib/constants";
import { isBlockedCompany } from "@/lib/ats";
import { RetryableError, isRetryableStatus, withRetry } from "@/lib/retry";

export type Classification = {
  isApplicationRelated: boolean;
  companyName: string | null;
  companyDomain: string | null;
  roleTitle: string | null;
  season: Season | null;
  year: number | null;
  status: Status;
  stageDetail: StageDetail | null;
  /**
   * What kind of report the email is, or null when the answer predates the
   * field. Null and UPDATE are different states: UPDATE is an answer meaning
   * "none of the others fits", null is no answer at all, and the display shows
   * the model's own words rather than a standard phrase when it has neither
   * this nor a stage (LOOP3 Decision 7).
   */
  emailEvent: EmailEvent | null;
  /**
   * Which ending this email announced, or null on the great majority that
   * announce none (LOOP4 Decision 7). Null is also what an answer given before
   * the field existed reads as, which is right: it says nothing rather than
   * claiming an ending nobody stated.
   */
  outcome: Outcome | null;
  /**
   * Who sent it: the employer, a service delivering its mail, or a third
   * party running one step. Never null, because the fallback is the employer
   * and an unknown sender behaves exactly as one.
   */
  senderRole: SenderRole;
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
  /** Calls the provider's free model list endpoint. Proves the key works and the model exists. */
  checkKey(apiKey: string): Promise<{ ok: true } | { ok: false; message: string }>;
  classify(apiKey: string, system: string, user: string): Promise<ClassifyResult>;
  /**
   * One structured question that is not a classification (LOOP4 Decision 6).
   *
   * The classification schema is the shape of an answer about one email read
   * alone. Matching is nothing but context, so the adjudicator asks a different
   * question and needs a different shape. Optional, because a provider that
   * cannot answer it must leave the caller exactly as it was rather than break
   * it: a paid call may never be load bearing for correctness.
   */
  ask?(
    apiKey: string,
    system: string,
    user: string,
    schema: Record<string, unknown>,
    name: string,
  ): Promise<{ raw: string; usage: Usage }>;
};

/**
 * A structured answer that does not parse (LOOP Invariant 7).
 *
 * Its own kind of failure, not a transport one. Repeating the identical
 * request reproduces the identical cut, so the fix is a larger output cap
 * rather than a retry. The text that would not parse rides on the error so it
 * can be stored and read rather than thrown away.
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
 * Transport errors are retried inside each attempt.
 */
export async function attemptClassify(
  cap: number,
  attempt: (maxTokens: number) => Promise<ClassifyResult>,
): Promise<ClassifyResult> {
  const once = (maxTokens: number) => withRetry(() => attempt(maxTokens));
  try {
    return await once(cap);
  } catch (error) {
    if (!(error instanceof MalformedOutputError)) throw error;
    return once(cap * 4);
  }
}

/** What a provider charges, per million tokens. */
export type Rates = { inputPerMTok: number; outputPerMTok: number };

/**
 * One answer, parsed and priced. A provider that reports its own cost is
 * believed over our sum; the others are priced from the rates beside the model.
 */
export function classifyResult(args: {
  model: string;
  rates: Rates;
  raw: string;
  inputTokens: number;
  outputTokens: number;
  reportedCostUsd?: number | null;
}): ClassifyResult {
  const { model, rates, raw, inputTokens, outputTokens } = args;
  const summed =
    (inputTokens / 1_000_000) * rates.inputPerMTok +
    (outputTokens / 1_000_000) * rates.outputPerMTok;

  return {
    classification: parseRaw(raw),
    raw,
    usage: {
      model,
      inputTokens,
      outputTokens,
      costUsd: typeof args.reportedCostUsd === "number" ? args.reportedCostUsd : summed,
    },
  };
}

/** A failed response, raised as the kind of error the retry rule expects. */
export async function throwForStatus(label: string, response: Response): Promise<never> {
  const detail = await response.text();
  const message = `${label} ${response.status}: ${detail}`;
  if (isRetryableStatus(response.status)) throw new RetryableError(message, response.status);
  throw new Error(message);
}

/**
 * The event the model answered, degraded rather than dropped.
 *
 * A value outside the list falls back: something happened and this code cannot
 * say what. A field that is absent stays null instead, because crediting it
 * with a guess it never made would put a standard phrase on a line nothing was
 * read for.
 */
function parseEvent(value: unknown): EmailEvent | null {
  if (value === undefined || value === null) return null;
  const upper = String(value).trim().toUpperCase();
  if (!upper) return null;
  return oneOf(EMAIL_EVENTS, upper, EMAIL_EVENT_FALLBACK);
}

/** The value when the list holds it, otherwise the fallback. */
function oneOf<T extends string, F>(
  list: readonly T[],
  value: string | null | undefined,
  fallback: F,
): T | F {
  return (list as readonly string[]).includes(value ?? "") ? (value as T) : fallback;
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
  const senderRole = String(value.sender_role ?? "").toUpperCase();
  const season = text(value.season);
  const year = Number(value.year);
  const company = text(value.company_name);

  return {
    isApplicationRelated: value.is_application_related === true,
    // The last line of defence against an invented company.
    companyName: company && !isBlockedCompany(company) ? company : null,
    companyDomain: text(value.company_domain)?.toLowerCase().replace(/^www\./, "") ?? null,
    roleTitle: text(value.role_title),
    season: oneOf(SEASONS, season, null),
    year: Number.isInteger(year) && year > 2000 && year < 2100 ? year : null,
    status: oneOf(STATUSES, status, "APPLIED"),
    stageDetail: oneOf(STAGE_DETAILS, stageDetail, null),
    emailEvent: parseEvent(value.email_event),
    // Unlike the event, an unrecognised ending falls to null rather than to a
    // fallback. There is no ending that means "some ending", and inventing one
    // would put a closing line on a row that never closed.
    outcome: oneOf<Outcome, null>(OUTCOMES, String(value.outcome ?? "").toUpperCase(), null),
    senderRole: oneOf(SENDER_ROLES, senderRole, SENDER_ROLE_FALLBACK),
    isSignificant: value.is_significant === true,
    emailTitle: text(value.email_title) ?? "Application Email",
    confidenceScore: Number.isFinite(Number(value.confidence_score))
      ? Math.min(1, Math.max(0, Number(value.confidence_score)))
      : 0,
    summary: text(value.summary) ?? "",
  };
}
