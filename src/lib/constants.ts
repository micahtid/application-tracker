export const STATUSES = ["ACCEPTED", "IN_PROGRESS", "APPLIED", "REJECTED"] as const;
export type Status = (typeof STATUSES)[number];

export const STAGE_DETAILS = ["ASSESSMENT", "INTERVIEW"] as const;
export type StageDetail = (typeof STAGE_DETAILS)[number];

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
export const CLASSIFIER_VERSION = 1;

/**
 * The other half of the same idea, covering everything after classification:
 * the matching rules in stage 4 and the recalculation rules in stage 5. Raise
 * it to group every message again on the next sync.
 *
 * Raising this costs nothing, because it re-reads answers already on disk.
 * Raising CLASSIFIER_VERSION costs a pass over the mailbox.
 */
export const GROUPING_VERSION = 3;

/** A message that has failed this many times is left alone (Part 9). */
export const MAX_CLASSIFICATION_ATTEMPTS = 3;

/** Cleaned body characters sent to the model (D29). */
export const BODY_CHAR_LIMIT = 1500;

export const GMAIL_CONCURRENCY = 10;
export const LLM_CONCURRENCY = 8;
