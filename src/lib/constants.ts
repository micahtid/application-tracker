export const STATUSES = ["ACCEPTED", "IN_PROGRESS", "APPLIED", "REJECTED"] as const;
export type Status = (typeof STATUSES)[number];

/** What a status is called on screen, in every place one is named. */
export const STATUS_LABELS: Record<Status, string> = {
  ACCEPTED: "Accepted",
  IN_PROGRESS: "In Progress",
  APPLIED: "Applied",
  REJECTED: "Rejected",
};

/**
 * What a step asks the applicant to go and do (LOOP3 Decision 1).
 *
 * A partition of what the applicant has to do, not a list of what employers
 * call it: they invent names constantly and no list would keep up. A work
 * trial nobody has thought of yet is still one of these four.
 *
 *   ASSESSMENT          something marked, with right answers
 *   RECORDED_INTERVIEW  something completed alone, reviewed later by a person
 *   INTERVIEW           something scheduled, live, with a person
 *   VERIFICATION        something supplied or consented to, checked not judged
 */
export const STAGE_DETAILS = ["ASSESSMENT", "RECORDED_INTERVIEW", "INTERVIEW", "VERIFICATION"] as const;
export type StageDetail = (typeof STAGE_DETAILS)[number];

/**
 * What the row's badge says for each of them. A lookup, so a value added above
 * cannot leave the badge disagreeing with the drawer.
 */
export const STAGE_LABELS: Record<StageDetail, string> = {
  ASSESSMENT: "Assessment",
  RECORDED_INTERVIEW: "Recorded Interview",
  INTERVIEW: "Interview",
  VERIFICATION: "Verification",
};

/**
 * What kind of report an email is (LOOP3 Decision 1).
 *
 * Asked of the model rather than read back out of its prose: searching its
 * answer for the word "reminder" would be guessing in English at something the
 * model already knows, in whatever language the email arrived in.
 */
export const EMAIL_EVENTS = [
  "CONFIRMATION",
  "INVITATION",
  "REMINDER",
  "COMPLETION",
  "REQUEST",
  "DECISION",
  "UPDATE",
] as const;
export type EmailEvent = (typeof EMAIL_EVENTS)[number];

/**
 * Where an answer this code has never seen lands. An unknown value degrades to
 * the plainest thing that is still true; it never disappears and never stops a
 * line being drawn.
 */
export const EMAIL_EVENT_FALLBACK: EmailEvent = "UPDATE";

/**
 * Who sent the email, as the email itself shows (LOOP3 Decision 2).
 *
 *   EMPLOYER           the employer writing for itself
 *   PLATFORM           a service delivering the employer's own mail
 *   ASSESSMENT_VENDOR  a third party running a step on the employer's behalf
 *
 * Asked of the model because the alternative, a list of known vendors, is
 * silently wrong in any mailbox whose vendors are not on it. The list stays
 * and still helps; it is no longer what a grouping rule depends on.
 */
export const SENDER_ROLES = ["EMPLOYER", "PLATFORM", "ASSESSMENT_VENDOR"] as const;
export type SenderRole = (typeof SENDER_ROLES)[number];

/** The fallback, and the safe one: an unknown sender behaves as the employer. */
export const SENDER_ROLE_FALLBACK: SenderRole = "EMPLOYER";

export const SEASONS = ["Summer", "Spring", "Fall"] as const;
export type Season = (typeof SEASONS)[number];

export const PROVIDERS = ["OPENROUTER", "ANTHROPIC", "GEMINI"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** The window can never reach back further than this. */
export const MAX_MONTHS_BACK = 12;

/** Skip the sync on open when the last one finished less recently than this. */
export const SYNC_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * One number covering the whole local pipeline: the prefilter rules, the prompt,
 * and the chosen model. Raise it to re-read every cached email on the next sync.
 */
export const CLASSIFIER_VERSION = 2;

/**
 * The other half of the same idea, covering everything after classification:
 * the matching rules in stage 4 and the recalculation rules in stage 5. Raise
 * it to group every message again on the next sync.
 *
 * Raising this costs nothing, because it re-reads answers already on disk.
 * Raising CLASSIFIER_VERSION costs a pass over the mailbox.
 */
export const GROUPING_VERSION = 4;

/** A message that has failed this many times is left alone. */
export const MAX_CLASSIFICATION_ATTEMPTS = 3;

/** Cleaned body characters sent to the model. */
export const BODY_CHAR_LIMIT = 1500;

export const GMAIL_CONCURRENCY = 10;
export const LLM_CONCURRENCY = 8;
