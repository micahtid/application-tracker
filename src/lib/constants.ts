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
  /**
   * Something already arranged that is now not happening: an interview called
   * off, a posting put on hold (LOOP4 Decision 7).
   *
   * Not a DECISION, because nothing was decided about the applicant, and
   * letting it fall to UPDATE left the row claiming a stage that had stopped.
   */
  "CANCELLATION",
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
 * Which ending an application reached (LOOP4 Decision 7).
 *
 * Symmetric with `stage_detail`: that says which step an application in
 * progress is at, this says which ending a finished one reached. Same shape,
 * same fallback behaviour, no new concept to learn.
 *
 * It exists because `status` says one word for several different facts.
 * ACCEPTED covers an offer extended, an offer the applicant accepted, an offer
 * the applicant declined and an offer the employer took back, and two of those
 * four are the opposite of good news. REJECTED covers being turned down,
 * withdrawing, and a posting the employer cancelled. A rescinded offer shown as
 * Accepted is not merely imprecise; it is wrong about the only thing the reader
 * cares about.
 *
 * `status` keeps its four values and needs no migration. This says which of the
 * endings it was, and null says the application has not ended.
 *
 *   OFFER_EXTENDED          an offer is on the table and unanswered
 *   OFFER_ACCEPTED          the applicant took it
 *   OFFER_DECLINED          the applicant turned it down
 *   OFFER_RESCINDED         the employer took it back
 *   REJECTED_BY_EMPLOYER    turned down
 *   WITHDRAWN_BY_APPLICANT  the applicant pulled out
 *   POSTING_CANCELLED       the role went away, nobody was turned down
 */
export const OUTCOMES = [
  "OFFER_EXTENDED",
  "OFFER_ACCEPTED",
  "OFFER_DECLINED",
  "OFFER_RESCINDED",
  "REJECTED_BY_EMPLOYER",
  "WITHDRAWN_BY_APPLICANT",
  "POSTING_CANCELLED",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** What the drawer's closing line says for each. A lookup, so a value added
 *  above cannot leave the line saying something that did not happen. */
export const OUTCOME_LABELS: Record<Outcome, string> = {
  OFFER_EXTENDED: "Offer",
  OFFER_ACCEPTED: "Offer Accepted",
  OFFER_DECLINED: "Offer Declined",
  OFFER_RESCINDED: "Offer Withdrawn by the Employer",
  REJECTED_BY_EMPLOYER: "Application Rejected",
  WITHDRAWN_BY_APPLICANT: "Application Withdrawn",
  POSTING_CANCELLED: "Posting Cancelled",
};

/**
 * How long an application may go without any mail before the board says so
 * (LOOP4 Decision 7 and V3).
 *
 * Every board of this kind fills with rows acknowledged once and never
 * mentioned again. They read APPLIED for ever and crowd out the handful that
 * are live.
 *
 * **Silence is not something an email says**, so this is never asked of the
 * model: no model reading one email can tell you that nothing followed it. It
 * is a fact about the set, worked out beside `headState` from the newest email
 * and the head state, and it is a display fact rather than a stored status, so
 * it can never be wrong in a way that moves the board's history.
 *
 * Sixty days is two of the ninety day reopen window's three months: long
 * enough that an employer taking its time is not called quiet, short enough
 * that a row nobody will ever hear from again stops looking live.
 */
export const STALE_AFTER_DAYS = 60;

/**
 * Below this the model is telling you it was not sure what it was reading, and
 * a match built on it is built on sand (LOOP4 Decision 6).
 *
 * This is `confidence_score`'s first job since it was added: it has been
 * stored on every classification and read by nothing. Every one of the 99
 * related messages in this mailbox scores 0.9 or better, so this fires here
 * never, which is the right shape for a rule that exists to catch a mailbox
 * that is harder to read than this one.
 */
export const ADJUDICATE_CONFIDENCE_FLOOR = 0.7;

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
export const CLASSIFIER_VERSION = 3;

/**
 * The other half of the same idea, covering everything after classification:
 * the matching rules in stage 4 and the recalculation rules in stage 5. Raise
 * it to group every message again on the next sync.
 *
 * Raising this costs nothing, because it re-reads answers already on disk.
 * Raising CLASSIFIER_VERSION costs a pass over the mailbox.
 */
export const GROUPING_VERSION = 5;

/**
 * How long an application that has ended may stay open to new mail (LOOP4
 * Decision 4).
 *
 * > An application that has reached an outcome and has been silent for longer
 * > than this is closed to new attachments, except by thread id or by a shared
 * > posting number.
 *
 * Derived from the labels rather than picked. Of the 57 labelled groups, 20
 * hold more than one email; the longest runs 11.67 days and the median runs
 * 1.01. So 90 days is more than seven times the longest thing this rule must
 * not break, and it is a quarter of the annual cycle these postings come back
 * on, which is the shortest interval at which the same title really is a new
 * posting.
 *
 * Nothing in the labels sits between twelve days and a year. That empty gap is
 * what makes 90 safe rather than merely defensible: moving it anywhere inside
 * the gap changes no answer here. It is also the honest limit of the evidence,
 * because twenty groups is a small sample and full time hiring is slower than
 * internship hiring. One constant in one file with a fixture on each side, so
 * it is cheap to move when a mailbox proves it wrong.
 */
export const REOPEN_GAP_DAYS = 90;

/** A message that has failed this many times is left alone. */
export const MAX_CLASSIFICATION_ATTEMPTS = 3;

/** Cleaned body characters sent to the model. */
export const BODY_CHAR_LIMIT = 1500;

export const GMAIL_CONCURRENCY = 10;
export const LLM_CONCURRENCY = 8;
