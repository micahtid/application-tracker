export const STATUSES = ["ACCEPTED", "IN_PROGRESS", "APPLIED", "REJECTED"] as const;
export type Status = (typeof STATUSES)[number];

/**
 * What a step asks the applicant to go and do (LOOP3 Decision 1).
 *
 * Employers invent stages constantly and no list of their names could keep up,
 * so these four are a partition of what the applicant actually has to do
 * rather than a list of what anybody calls it. A work trial nobody has thought
 * of yet is still one of these four.
 *
 *   ASSESSMENT          something marked, with right answers
 *   RECORDED_INTERVIEW  something completed alone, reviewed later by a person
 *   INTERVIEW           something scheduled, live, with a person
 *   VERIFICATION        something supplied or consented to, checked not judged
 *
 * INTERVIEW keeps its name now that it means specifically a live one.
 * `LIVE_INTERVIEW` would say so and would cost a migration and a second pass
 * to say it, and no reader ever sees the stored word.
 */
export const STAGE_DETAILS = ["ASSESSMENT", "RECORDED_INTERVIEW", "INTERVIEW", "VERIFICATION"] as const;
export type StageDetail = (typeof STAGE_DETAILS)[number];

/**
 * What the row's badge says for each of them. A lookup rather than a choice
 * between two, so the next value added to the list above cannot leave the
 * badge saying something the drawer disagrees with.
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
 * Asked of the model rather than read back out of its prose, because the model
 * read the whole email in whatever language and wording it arrived in, and a
 * rule that searches its answer for the word "reminder" is guessing in English
 * at something already known.
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
 * Asked for because the alternative is a list of real vendors, and a rule that
 * fails when a name is missing from a list is silently wrong in every mailbox
 * whose vendors nobody has heard of. The list stays and still helps; it stops
 * being the thing a grouping rule cannot work without.
 */
export const SENDER_ROLES = ["EMPLOYER", "PLATFORM", "ASSESSMENT_VENDOR"] as const;
export type SenderRole = (typeof SENDER_ROLES)[number];

/** The fallback, and the safe one: an unknown sender behaves as the employer. */
export const SENDER_ROLE_FALLBACK: SenderRole = "EMPLOYER";

export const SEASONS = ["Summer", "Spring", "Fall"] as const;
export type Season = (typeof SEASONS)[number];

export const PROVIDERS = ["OPENROUTER", "ANTHROPIC", "GEMINI"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** The window can never reach back further than this (PRD 3.1, 5.5). */
export const MAX_MONTHS_BACK = 12;

/** Skip the sync on open when the last one finished less recently than this (D23). */
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

/** A message that has failed this many times is left alone (Part 9). */
export const MAX_CLASSIFICATION_ATTEMPTS = 3;

/** Cleaned body characters sent to the model (D29). */
export const BODY_CHAR_LIMIT = 1500;

export const GMAIL_CONCURRENCY = 10;
export const LLM_CONCURRENCY = 8;
