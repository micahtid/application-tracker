/**
 * What the pipeline did that the board cannot show afterwards.
 *
 * Every number here records a moment where the rules ran out and something had
 * to be chosen anyway. None of them leaves a trace on the board: a row that won
 * a coin flip looks exactly like a row that was the only candidate.
 *
 * They are threaded through the return values rather than kept in a module
 * level tally, because two syncs may run at once and a global would add one
 * run's guesses to the other's.
 */
import { plural, verb } from "@/lib/text";

/**
 * Why a message is attached to an application.
 *
 * Ordered from the strongest evidence to the weakest, which is also the order
 * the matching rules try them in. The distinction is not decoration:
 * `isWitnessed` reads it to decide whether an alias may be written at all, and
 * the repair pass reads it to decide which links it is allowed to undo. A link
 * made because two emails quote the same posting number is evidence. A link
 * made because one row scored 0.5 and another scored 0.5 is a guess, and the
 * two must not be stored as though they were the same kind of thing.
 *
 *   NEW          this message started the application, so there was nothing to choose
 *   THREAD       a message already on the row shares this one's thread
 *   REQUISITION  both quote the same posting number
 *   TITLE        the titles agree and exactly one row could take it
 *   HANDOFF      an exam vendor's mail, and exactly one row was waiting on a step
 *   SCORE        several rows could take it and the score picked one
 *   FANOUT       several rows were waiting on this very step and it reached them all
 */
export const LINK_REASONS = [
  "NEW",
  "THREAD",
  "REQUISITION",
  "TITLE",
  "HANDOFF",
  "SCORE",
  "FANOUT",
] as const;

export type LinkReason = (typeof LINK_REASONS)[number];

/**
 * The reasons that are evidence rather than a guess.
 *
 * An alias is a standing claim that two names are one employer, acted on by
 * every later message, so it may only be written from a link somebody could
 * point at. A score picking between two candidates is not that.
 */
const WITNESSED_REASONS: readonly LinkReason[] = ["NEW", "THREAD", "REQUISITION"];

/**
 * Whether the link that produced an alias is something somebody could point
 * at.
 *
 * A shared thread and a shared posting number are statements the employer
 * made. A title that agrees word for word is the same claim in weaker form and
 * counts too. A title that merely contains the other's words does not: that
 * comparison is loose on purpose, because it has to absorb an employer
 * wording one posting several ways, and what makes it right for attaching one
 * email makes it wrong for a claim that outlives every email.
 */
export function isWitnessed(reason: LinkReason, titlesAreIdentical: boolean): boolean {
  if (reason === "TITLE") return titlesAreIdentical;
  return WITNESSED_REASONS.includes(reason);
}

export type PipelineCounters = {
  linksByReason: Record<LinkReason, number>;
  /** Times the score's top two candidates were exactly level and row id decided. */
  scoreTies: number;
  aliasesWritten: number;
  /** Aliases written from a link that was a guess rather than evidence. */
  aliasesGuessed: number;
  /** Dedupe keys the stage 5 catch had to make unique to get past a collision. */
  dedupeCollisions: number;
  /** Emails that reached more than one application, and rows reached in total. */
  fanoutEvents: number;
  fanoutRowsReached: number;
  repairMerges: number;
  repairSplits: number;
  /** Repairs a second pass would have found, deliberately not run. */
  repairUnsettled: number;
  adjudicateCalls: number;
  /** Calls that were made and came back with nothing: out of credit, down, or unparseable. */
  adjudicateUnanswered: number;
  adjudicateCostUsd: number;
};

export function emptyCounters(): PipelineCounters {
  return {
    linksByReason: Object.fromEntries(LINK_REASONS.map((reason) => [reason, 0])) as Record<
      LinkReason,
      number
    >,
    scoreTies: 0,
    aliasesWritten: 0,
    aliasesGuessed: 0,
    dedupeCollisions: 0,
    fanoutEvents: 0,
    fanoutRowsReached: 0,
    repairMerges: 0,
    repairSplits: 0,
    repairUnsettled: 0,
    adjudicateCalls: 0,
    adjudicateUnanswered: 0,
    adjudicateCostUsd: 0,
  };
}

export function mergeCounters(...parts: PipelineCounters[]): PipelineCounters {
  const total = emptyCounters();
  for (const part of parts) {
    for (const reason of LINK_REASONS) total.linksByReason[reason] += part.linksByReason[reason];
    for (const key of Object.keys(total) as (keyof PipelineCounters)[]) {
      if (key === "linksByReason") continue;
      total[key] += part[key];
    }
  }
  return total;
}

/**
 * The lines worth saying out loud, for the sync notes and the scorecard.
 *
 * Only the numbers that are not zero, because a run that guessed at nothing
 * should say nothing rather than print a wall of zeroes. A run that guessed
 * should be impossible to miss.
 */
export function counterNotes(counters: PipelineCounters): string[] {
  const notes: string[] = [];

  if (counters.dedupeCollisions) {
    notes.push(
      `${plural(counters.dedupeCollisions, "application")} collided on their identity key and were kept apart by adding the row id. Two rows that should be one is the likeliest reason.`,
    );
  }
  if (counters.scoreTies) {
    notes.push(
      `${plural(counters.scoreTies, "email")} could have belonged to more than one application and were filed against the lowest numbered one, because nothing in them said which.`,
    );
  }
  if (counters.aliasesGuessed) {
    notes.push(
      `${plural(counters.aliasesGuessed, "company alias", "company aliases")} ${verb(counters.aliasesGuessed, "was", "were")} written from a match nobody witnessed.`,
    );
  }
  if (counters.fanoutEvents) {
    notes.push(
      `${plural(counters.fanoutEvents, "email")} were about more than one application and were filed against ${counters.fanoutRowsReached} rows in total.`,
    );
  }
  if (counters.repairMerges || counters.repairSplits) {
    notes.push(
      `A repair pass joined ${plural(counters.repairMerges, "row")} and separated ${counters.repairSplits}.`,
    );
  }
  if (counters.adjudicateUnanswered) {
    notes.push(
      `${counters.adjudicateUnanswered} of ${plural(counters.adjudicateCalls, "question")} about which application an email belonged to could not be answered, so the ordinary rules decided.`,
    );
  }
  if (counters.repairUnsettled) {
    notes.push(
      `${plural(counters.repairUnsettled, "further repair")} were found and deliberately not run, because a repair pass makes one move per row and stops.`,
    );
  }

  return notes;
}
