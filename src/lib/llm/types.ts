import type { EmailEvent, Outcome, Provider, Season, SenderRole, StageDetail, Status } from "@/lib/constants";
import {
  EMAIL_EVENTS,
  EMAIL_EVENT_FALLBACK,
  OUTCOMES,
  SENDER_ROLES,
  SENDER_ROLE_FALLBACK,
  STATUSES,
  STAGE_DETAILS,
  termBucket,
} from "@/lib/constants";
import { isBlockedCompany } from "@/lib/ats";
import { RetryableError, isRetryableStatus, withRetry } from "@/lib/retry";

export type Classification = {
  isApplicationRelated: boolean;
  companyName: string | null;
  /**
   * The name the model gave that the code would not accept as an employer, and
   * null when it accepted the answer or the model gave none (LOOP5 Decision 7).
   *
   * `isBlockedCompany` used to erase the answer here and say nothing, so stage
   * 4 dropped the message down a silent `continue` and no counter anywhere
   * named it. Two rules each defensible alone composed into a hole.
   *
   * What the list knows is worth keeping, so the answer is recorded as the
   * refusal it is rather than deleted. `companyName` stays null, so every rule
   * that treats it as the employer behaves exactly as it did and no vendor name
   * can leak onto a row or into an alias. What changes is that stage 4 can now
   * tell a message that named nobody from one whose name it would not accept,
   * and counts them apart.
   */
  companyRefused: string | null;
  companyDomain: string | null;
  /**
   * The posting this email is about, or null.
   *
   * Null on an email that states no title, and null too on one whose stated
   * title names something the sending system is running rather than a posting:
   * a message template, a test, the programme that test belongs to
   * (LOOP5 Decision 4). A stated string used to be a stated title full stop,
   * which is how a template name became a job name and split one application
   * into two rows.
   *
   * Null is not a loss, because `rolesMatch` treats silence as agreement, so a
   * refused title still attaches to the row whose title is real. The string
   * itself stays in `llm_classification_raw`, where `title.lost` reads it back.
   */
  roleTitle: string | null;
  /**
   * What the model said about the title it stated: true when it names a
   * posting, false when it names something the sender is running, and null
   * when it stated no title or the answer predates the field.
   *
   * Kept beside `roleTitle` rather than folded into it, because "no title was
   * stated" and "a title was stated and refused" are different facts and the
   * second is the one `title.placeholder` and `title.lost` are scored on.
   */
  roleTitleIsPosting: boolean | null;
  /**
   * The term this email says the posting runs in, in the words it used
   * (LOOP5 Decision 6). Checked against no list, because a vocabulary that
   * decides what may be recorded is how a term the code had never heard of was
   * dropped in silence.
   */
  term: string | null;
  season: Season | null;
  year: number | null;
  status: Status;
  stageDetail: StageDetail | null;
  /**
   * What kind of report the email is, or null when the answer predates the
   * field. Null and UPDATE are different states: UPDATE is an answer meaning
   * "none of the others fits", null is no answer at all, and the display shows
   * the model's own words rather than a standard phrase when it has neither
   * this nor a stage.
   */
  emailEvent: EmailEvent | null;
  /**
   * Which ending this email announced, or null on the great majority that
   * announce none. Null is also what an answer given before the field existed
   * reads as, which is right: it says nothing rather than claiming an ending
   * nobody stated.
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
   * One structured question that is not a classification.
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
 * A structured answer that does not parse.
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
 * What a call cost at those rates. Every adapter prices its calls here, so a
 * change to how cost is worked out reaches all of them at once.
 */
export function costOf(rates: Rates, inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * rates.inputPerMTok +
    (outputTokens / 1_000_000) * rates.outputPerMTok
  );
}

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
  const summed = costOf(rates, inputTokens, outputTokens);

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
  // `season` is read as well, so an answer written before the field was
  // renamed still says what it said. It is a bucket word either way, and
  // `termBucket` files it under itself.
  const term = text(value.term) ?? text(value.season);
  const year = Number(value.year);
  const company = text(value.company_name);
  const role = text(value.role_title);

  /**
   * A stated title is a posting title unless the model says otherwise.
   *
   * An answer written before the field existed carries no opinion, and reading
   * that silence as "not a posting" would delete every title in the cache the
   * moment this shipped. So absence means yes and only an explicit false
   * refuses anything.
   */
  const roleTitleIsPosting = role === null ? null : value.role_title_is_posting !== false;

  // Recorded as an answer the code could not use, rather than as an answer it
  // never got (LOOP5 Decision 7, Gate 9).
  const refused = company !== null && isBlockedCompany(company);

  return {
    isApplicationRelated: value.is_application_related === true,
    companyName: refused ? null : company,
    companyRefused: refused ? company : null,
    companyDomain: text(value.company_domain)?.toLowerCase().replace(/^www\./, "") ?? null,
    // A title that names something other than the posting is stored as no
    // title, which is what `rolesMatch` already knows how to read.
    roleTitle: roleTitleIsPosting === false ? null : role,
    roleTitleIsPosting,
    term,
    // The bucket, derived from the term on every read rather than stored
    // instead of it. Null when no bucket fits, which is now an answer about the
    // display rather than a decision to throw the term away.
    season: termBucket(term),
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
