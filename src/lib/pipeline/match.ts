import type { Application, EmailMessage } from "@prisma/client";
import type { Db } from "@/lib/db";
import {
  ADJUDICATE_CONFIDENCE_FLOOR,
  CLASSIFIER_VERSION,
  REOPEN_GAP_DAYS,
  hasEnded,
} from "@/lib/constants";
import {
  ROLE_MATCH_THRESHOLD,
  dedupeKey,
  groupsOf,
  normalizeCompany,
  normalizeTerm,
  requisitionNumbers,
  requisitionsAgree,
  requisitionsDisagree,
  roleSimilarity,
  rolesIdentical,
  rolesMatch,
  sameEmployer,
  termsMatch,
} from "@/lib/normalize";
import { isAssessmentVendor } from "@/lib/ats";
import { classificationOf, headState } from "./recompute";
import { emptyCounters, isWitnessed, type LinkReason, type PipelineCounters } from "./counters";
import {
  applicationForThread,
  link,
  messagesOf,
  unclaimedMessages,
  type MessageInApplication,
} from "./membership";
import type { Classification } from "@/lib/llm";

/**
 * Stage 4. A separate serial pass, oldest first.
 *
 * Classification runs about ten messages at once and finishes in unpredictable
 * order, so matching cannot live inside it: two emails from the same company
 * would look each other up at the same moment, both find nothing, and both
 * create an application.
 */

/**
 * Asked when the code has run out of evidence.
 *
 * Injected rather than imported, so stage 4 stays a function of the database
 * and knows nothing about providers or keys. It returns the ids of the rows the
 * email belongs to, an empty list for none of them, or null when it could not
 * answer at all, which is the same thing as never having been asked.
 */
export type Adjudicator = (
  message: EmailMessage,
  candidates: Application[],
) => Promise<{ chosen: number[]; costUsd: number } | null>;

export type MatchOutcome = {
  attached: number;
  created: number;
  touched: number[];
  counters: PipelineCounters;
  /**
   * How many messages the pass was handed (LOOP5 Gate 10). Reported here rather
   * than counted again from the database afterwards, because the balance is a
   * statement about what this pass did with what it was given.
   */
  given: number;
};

/**
 * What one matching pass has already worked out.
 *
 * Every rule below asks the same two questions of the same handful of candidate
 * rows, once for each incoming message: which emails are on this row, and which
 * posting numbers do they quote. Reading that back out of the database each
 * time is most of the work stage 4 does, so the answers are kept here for the
 * length of the pass.
 *
 * A new link is the only thing that changes either answer, so both are dropped
 * for an application the moment `attach` writes one. That is the whole
 * invalidation rule and it is meant to stay this small.
 *
 * The alias table is loaded once for the same reason. `rememberAlias` adds to
 * the loaded copy as it writes, so a name recorded early in the pass is still
 * found by a later message.
 *
 * The blocking index is loaded the same way and for the same reason
 * (LOOP5 Decision 1). It holds the rows sharing each of `groupsOf`'s keys, and
 * a row created mid pass is added to it as it is made, so the next message
 * finds it.
 */
type Pass = {
  db: Db;
  messages: Map<number, MessageInApplication[]>;
  requisitions: Map<number, Set<string>>;
  /** Every term stated by any email on an application, normalised. */
  terms: Map<number, Set<string>>;
  /** Alias name to the canonical name it stands for, exactly as stored. */
  aliasOf: Map<string, string>;
  /** Normalised canonical name to every alias name pointing at it. */
  aliasesTo: Map<string, string[]>;
  /** Blocking key to every application whose company name carries it. */
  byGroup: Map<string, Set<number>>;
};

async function startPass(db: Db): Promise<Pass> {
  const pass: Pass = {
    db,
    messages: new Map(),
    requisitions: new Map(),
    terms: new Map(),
    aliasOf: new Map(),
    aliasesTo: new Map(),
    byGroup: new Map(),
  };

  const rows = await db.companyAlias.findMany({
    select: { aliasNormalized: true, canonicalCompanyName: true },
  });
  for (const row of rows) indexAlias(pass, row.aliasNormalized, row.canonicalCompanyName);

  const applications = await db.application.findMany({
    select: { id: true, companyNormalized: true },
  });
  for (const row of applications) indexCompany(pass, row.id, row.companyNormalized);

  return pass;
}

/** Puts an application under every blocking key its company name carries. */
function indexCompany(pass: Pass, applicationId: number, companyNormalized: string): void {
  for (const key of groupsOf(companyNormalized)) {
    const sharing = pass.byGroup.get(key);
    if (sharing) sharing.add(applicationId);
    else pass.byGroup.set(key, new Set([applicationId]));
  }
}

/**
 * Adds one alias to the loaded copy. An alias already known keeps the name it
 * already had, which is what the upsert in `rememberAlias` does on disk.
 */
function indexAlias(pass: Pass, aliasNormalized: string, canonicalCompanyName: string): void {
  if (pass.aliasOf.has(aliasNormalized)) return;
  pass.aliasOf.set(aliasNormalized, canonicalCompanyName);

  if (!canonicalCompanyName) return;
  const canonical = normalizeCompany(canonicalCompanyName);
  const pointing = pass.aliasesTo.get(canonical);
  if (pointing) pointing.push(aliasNormalized);
  else pass.aliasesTo.set(canonical, [aliasNormalized]);
}

/** Every email of an application, read from the database once per pass. */
async function messagesIn(pass: Pass, applicationId: number): Promise<MessageInApplication[]> {
  const held = pass.messages.get(applicationId);
  if (held) return held;

  const messages = await messagesOf(pass.db, applicationId);
  pass.messages.set(applicationId, messages);
  return messages;
}

/** Both held answers for one application go stale the moment it gains an email. */
function forgetApplication(pass: Pass, applicationId: number): void {
  pass.messages.delete(applicationId);
  pass.requisitions.delete(applicationId);
  pass.terms.delete(applicationId);
}

/**
 * Candidate rows for a company name, narrowed by the one blocking rule
 * (LOOP5 Decision 1).
 *
 * `groupsOf` is what the repair pass and the split suspects report already
 * narrow with, and it carries the property those two rest on: two names sharing
 * no key can never be one employer, so nothing `sameEmployer` would accept is
 * dropped here.
 *
 * What this replaced could not say that. It looked up every leading run of the
 * incoming name's words and scanned for stored names beginning with its first
 * word, which reaches a longer stored name from a shorter incoming one and
 * never the other way about, so an email naming an employer's long form never
 * found the row filed under its short form.
 *
 * An alias is an explicit statement that two names are one employer, so its
 * rows are gathered too and taken at their word.
 */
async function candidatesFor(pass: Pass, normalized: string): Promise<Application[]> {
  const aliased = new Set<string>();

  const canonical = pass.aliasOf.get(normalized);
  if (canonical !== undefined) aliased.add(normalizeCompany(canonical));

  for (const alias of pass.aliasesTo.get(normalized) ?? []) aliased.add(alias);

  const ids = new Set<number>();
  for (const name of [normalized, ...aliased]) {
    for (const key of groupsOf(name)) {
      for (const id of pass.byGroup.get(key) ?? []) ids.add(id);
    }
  }
  if (!ids.size) return [];

  const found = await pass.db.application.findMany({ where: { id: { in: [...ids] } } });

  // The blocking does the narrowing, so the loose comparison below never runs
  // at scale.
  return found.filter(
    (row) => aliased.has(row.companyNormalized) || sameEmployer(normalized, row.companyNormalized),
  );
}

/**
 * Two roles disagree when both are stated and neither title's words are all
 * present in the other's. Neither side saying anything is not a disagreement:
 * an email that names no role contradicts nothing.
 */
function rolesDisagree(role: string | null, classification: Classification): boolean {
  return !rolesMatch(role, classification.roleTitle);
}

/**
 * Every term stated by any email already on an application, read the same way
 * its posting numbers are and kept beside them for the length of the pass.
 *
 * From the emails rather than from the `term` column, for the reason
 * `requisitionsOf` reads them that way: stage 5 writes that column and has not
 * run, so mid pass it still holds whatever the row's first email said.
 */
async function termsOf(pass: Pass, applicationId: number): Promise<Set<string>> {
  const held = pass.terms.get(applicationId);
  if (held) return held;

  const all = new Set<string>();
  for (const message of await messagesIn(pass, applicationId)) {
    const said = classificationOf(message)?.term;
    if (said) all.add(normalizeTerm(said));
  }

  pass.terms.set(applicationId, all);
  return all;
}

/**
 * An employer running the same posting in two terms is running two
 * applications, whatever the titles say (LOOP5 Decision 6).
 *
 * The same shape as `requisitionContradicts` below, and a third caller for one
 * idea rather than a new rule: **a contradiction the employer stated excludes a
 * candidate, and silence contradicts nothing.**
 *
 * It reads the stated term rather than the bucket it is filed under, which is
 * what keeps a list of season words out of a grouping answer: a mailbox whose
 * terms no bucket fits groups exactly as well as this one.
 */
async function termContradicts(
  pass: Pass,
  applicationId: number,
  classification: Classification,
): Promise<boolean> {
  if (!classification.term) return false;
  const stated = await termsOf(pass, applicationId);
  if (!stated.size) return false;
  return !stated.has(normalizeTerm(classification.term));
}

/** True when both sides quote a posting number and they quote the same one. */
async function requisitionAgrees(
  pass: Pass,
  applicationId: number,
  incoming: Set<string>,
): Promise<boolean> {
  if (!incoming.size) return false;
  return requisitionsAgree(await requisitionsOf(pass, applicationId), incoming);
}

/**
 * Every posting number quoted by any email already on an application, read out
 * of the emails the pass already holds and then kept beside them.
 */
async function requisitionsOf(pass: Pass, applicationId: number): Promise<Set<string>> {
  const held = pass.requisitions.get(applicationId);
  if (held) return held;

  const all = new Set<string>();
  for (const message of await messagesIn(pass, applicationId)) {
    for (const value of requisitionNumbers(message.subject, message.bodyText)) all.add(value);
  }

  pass.requisitions.set(applicationId, all);
  return all;
}

/**
 * An employer that quotes a posting number in one email and a different one in
 * the next is telling you these are two applications, whatever the titles say.
 * Two postings can be worded identically, and often are; the number is the one
 * thing that cannot be.
 */
async function requisitionContradicts(
  pass: Pass,
  applicationId: number,
  incoming: Set<string>,
): Promise<boolean> {
  if (!incoming.size) return false;
  return requisitionsDisagree(await requisitionsOf(pass, applicationId), incoming);
}

/**
 * Whether this email came from a third party running one step for an employer.
 *
 * The model answers it, because the email says so plainly. The vendor list is
 * consulted too and can only add certainty: a sender the list knows counts
 * whatever the model said, and an unknown sender is no worse off. The list on
 * its own is not enough, because it is silently wrong in any mailbox whose
 * vendors are not on it.
 */
function runsAStepForAnEmployer(message: EmailMessage, classification: Classification): boolean {
  return classification.senderRole === "ASSESSMENT_VENDOR" || isAssessmentVendor(message.senderDomain);
}

/**
 * A company that runs exams never receives an application, so its email can
 * only continue one that already exists.
 *
 * The title comparison this sits behind is the wrong question for an exam: the
 * vendor names the paper after the programme rather than the posting. So it is
 * tried last, leaving a row that matches on its title to win on its title, and
 * it acts only when exactly one application at the employer is waiting on a
 * step. Two postings through one vendor give no way to tell the papers apart,
 * and guessing would merge two real applications.
 *
 * What a row is waiting on is read from its attached emails, not from the
 * `status` column, which stage 5 has not written yet.
 */
async function assessmentHandOff(
  pass: Pass,
  message: EmailMessage,
  classification: Classification,
  candidates: Application[],
): Promise<Application | null> {
  if (!runsAStepForAnEmployer(message, classification)) return null;

  const waiting: Application[] = [];
  for (const candidate of candidates) {
    const state = headState(await messagesIn(pass, candidate.id));
    // Any step the applicant was sent away to do, not the assessment stage
    // alone: a row waiting on a recorded interview or a background check is
    // waiting on a third party just as much. Naming one value of four would
    // narrow this rule as the vocabulary grows, with nothing to say it had.
    if (state.status === "IN_PROGRESS" && state.stageDetail) waiting.push(candidate);
  }

  return waiting.length === 1 ? waiting[0] : null;
}

/**
 * Every row waiting on the very step this email is about. An email belongs to
 * every application it is about, and to no others.
 *
 * A decision never reaches more than one row: an email reaching two rows writes
 * a milestone on each, which is right for a reminder and would close two real
 * applications on one rejection. A quoted posting number stops this too, being
 * a real answer that has to decide on its own.
 *
 * A stated title contradicts, unless the sender runs the step and is therefore
 * naming its own paper rather than the posting.
 */
async function rowsWaitingOnThisStep(
  pass: Pass,
  message: EmailMessage,
  classification: Classification,
  candidates: Application[],
  incomingRequisitions: Set<string>,
): Promise<Application[]> {
  if (classification.emailEvent === "DECISION") return [];
  if (incomingRequisitions.size) return [];
  if (!classification.stageDetail) return [];

  const titleNamesAPosting = !runsAStepForAnEmployer(message, classification);

  const waiting: Application[] = [];
  for (const candidate of candidates) {
    if (titleNamesAPosting && rolesDisagree(candidate.roleTitle, classification)) continue;
    const state = headState(await messagesIn(pass, candidate.id));
    if (state.status === "IN_PROGRESS" && state.stageDetail === classification.stageDetail) {
      waiting.push(candidate);
    }
  }
  return waiting;
}

/**
 * An application that ended and then went quiet is finished. A later email
 * with the same title is a new application unless the thread or a posting
 * number says otherwise.
 *
 * Apply in one year, get rejected, apply again the next to the same posting.
 * The title is word for word identical and the employer states no season and
 * no year, which is the case for roughly half the labelled groups here. Without
 * this the new confirmation matches on title, attaches to the closed row, and
 * `headState` takes the newest significant milestone, so the row flips from
 * rejected back to applied and the rejection is buried underneath. The board
 * then shows one application that has been open for two years instead of two
 * applications, one of which ended.
 *
 * Two exceptions, and both are the employer speaking rather than a guess. A
 * reply on the original thread really does belong to the old application
 * however long the gap, and rule 1 above has already attached it before this
 * runs. A quoted posting number is the employer saying so directly.
 *
 * What the row reached is read from its emails rather than from the `status`
 * column, for the same reason `assessmentHandOff` does: mid pass that column is
 * out of date.
 */
async function endedAndQuiet(
  pass: Pass,
  candidate: Application,
  message: EmailMessage,
  incomingRequisitions: Set<string>,
): Promise<boolean> {
  const attached = await messagesIn(pass, candidate.id);
  if (!attached.length) return false;

  const { status } = headState(attached);
  if (!hasEnded(status)) return false;

  const newest = attached[attached.length - 1].receivedAt.getTime();
  const gapDays = (message.receivedAt.getTime() - newest) / 86_400_000;
  if (gapDays <= REOPEN_GAP_DAYS) return false;

  return !(await requisitionAgrees(pass, candidate.id, incomingRequisitions));
}

function scoreCandidate(candidate: Application, classification: Classification): number {
  const bothRolesKnown = Boolean(candidate.roleTitle && classification.roleTitle);
  let score = bothRolesKnown ? roleSimilarity(candidate.roleTitle, classification.roleTitle) : 0.5;

  // Term and year break ties only when both sides actually have them. The
  // stated term rather than the bucket it is filed under, so two postings one
  // bucket covers still tell each other apart (LOOP5 Decision 6).
  if (candidate.term && classification.term) {
    score += termsMatch(candidate.term, classification.term) ? 0.1 : -0.25;
  }
  if (candidate.year && classification.year) {
    score += candidate.year === classification.year ? 0.1 : -0.25;
  }

  return score;
}

async function createApplication(
  pass: Pass,
  classification: Classification,
  message: EmailMessage,
  counters: PipelineCounters,
) {
  const companyName = classification.companyName!;
  const companyNormalized = normalizeCompany(companyName);
  const key = dedupeKey({
    companyNormalized,
    roleTitle: classification.roleTitle,
    term: classification.term,
    year: classification.year,
    requisitions: requisitionNumbers(message.subject, message.bodyText),
  });

  /**
   * A key collision hands back nothing. The rules above have already decided
   * this is a new application, and the key is an alarm rather than the thing
   * that prevents duplicates, so the collision is counted and the row is made
   * distinct. Stage 5 settles on its own suffix on the next recalculation.
   */
  const collision = await pass.db.application.findUnique({ where: { dedupeKey: key } });
  if (collision) counters.dedupeCollisions += 1;
  const distinctKey = collision ? `${key}#${message.gmailMessageId}` : key;

  const created = await pass.db.application.create({
    data: {
      companyName,
      companyNormalized,
      companyDomain: classification.companyDomain,
      roleTitle: classification.roleTitle,
      dedupeKey: distinctKey,
      term: classification.term,
      season: classification.season,
      year: classification.year,
      status: classification.status,
      stageDetail: classification.stageDetail,
      firstEmailAt: message.receivedAt,
      latestEmailAt: message.receivedAt,
      confidence: classification.confidenceScore,
    },
  });

  // Into the blocking index before the next message is read, for the same
  // reason the pass is serial at all: two emails from one employer must be
  // able to find each other's row.
  indexCompany(pass, created.id, companyNormalized);
  return created;
}

async function attach(
  pass: Pass,
  message: EmailMessage,
  applicationId: number,
  classification: Classification,
  reason: LinkReason,
): Promise<void> {
  await link(pass.db, applicationId, message.id, reason);
  forgetApplication(pass, applicationId);

  // Only significant emails write status history. Without this rule a
  // "sounds good, see you Thursday" reply would drag an offer out of
  // Accepted.
  if (classification.isSignificant) {
    await pass.db.applicationStatusHistory.upsert({
      where: {
        applicationId_messageId_status: {
          applicationId,
          messageId: message.id,
          status: classification.status,
        },
      },
      create: {
        applicationId,
        messageId: message.id,
        status: classification.status,
        detectedAt: message.receivedAt,
      },
      update: { detectedAt: message.receivedAt },
    });
  }
}

/**
 * Records that two names are one employer.
 *
 * Counted by the link that produced it, because an alias made from a guess is
 * used by every later message just as readily as one made from evidence, and
 * nothing ever removes it. The count is what makes that visible.
 */
async function rememberAlias(
  pass: Pass,
  aliasNormalized: string,
  canonicalCompanyName: string,
  reason: LinkReason,
  witnessed: boolean,
  counters: PipelineCounters,
) {
  if (!aliasNormalized || aliasNormalized === normalizeCompany(canonicalCompanyName)) return;

  // A rule may act on what it observed. It may not act on what it guessed as
  // readily as on what it observed.
  //
  // A wrong score writing an alias welds two employers together for good:
  // nothing removes an alias except a rebuild, which removes all of them.
  if (!witnessed) return;

  await pass.db.companyAlias.upsert({
    where: { aliasNormalized },
    create: { aliasNormalized, canonicalCompanyName, reason },
    update: {},
  });
  indexAlias(pass, aliasNormalized, canonicalCompanyName);
  counters.aliasesWritten += 1;
}

export async function attachClassified(
  db: Db,
  adjudicator?: Adjudicator,
): Promise<MatchOutcome> {
  const messages = await unclaimedMessages(db, {
    classificationStatus: "OK",
    classifierVersion: CLASSIFIER_VERSION,
    isApplicationRelated: true,
  });

  const pass = await startPass(db);
  const touched = new Set<number>();
  const counters = emptyCounters();
  let attached = 0;
  let created = 0;

  // Serial on purpose. Nothing here runs in parallel, so two emails from the
  // same company cannot race each other into two applications.
  for (const message of messages) {
    const classification = classificationOf(message);
    if (!classification || !classification.isApplicationRelated) {
      counters.skipsByReason.NOT_APPLICATION_MAIL += 1;
      continue;
    }

    const incomingRequisitions = requisitionNumbers(message.subject, message.bodyText);

    // 1. Thread already linked to an application. Often absent, never relied
    //    on, but it is what links a bare "Re: your application" naming no
    //    company. Evidence, not proof: mail clients thread by subject, so two
    //    applications acknowledged in the same words share a thread, and an
    //    email naming a different job is a different application however it
    //    was delivered.
    if (message.threadId) {
      const siblingApplicationId = await applicationForThread(db, message.threadId);
      if (siblingApplicationId) {
        const application = await db.application.findUnique({
          where: { id: siblingApplicationId },
        });

        const contradicted =
          application &&
          (rolesDisagree(application.roleTitle, classification) ||
            (await termContradicts(pass, application.id, classification)) ||
            (await requisitionContradicts(pass, application.id, incomingRequisitions)));

        if (!contradicted) {
          await attach(pass, message, siblingApplicationId, classification, "THREAD");
          counters.linksByReason.THREAD += 1;
          if (classification.companyName && application) {
            await rememberAlias(
              pass,
              normalizeCompany(classification.companyName),
              application.companyName,
              "THREAD",
              true,
              counters,
            );
          }
          touched.add(siblingApplicationId);
          attached += 1;
          continue;
        }
      }
    }

    // A message with no company creates no application: company is the anchor
    // for matching, so a nameless row could never be matched to anything.
    //
    // The two ways of having no company are counted apart, because they are
    // different answers: saying nothing, and saying a name the code will not
    // accept as an employer (LOOP5 Decisions 7 and 8, Gate 10).
    if (!classification.companyName) {
      counters.skipsByReason[classification.companyRefused ? "COMPANY_REFUSED" : "NO_COMPANY"] += 1;
      continue;
    }

    const normalized = normalizeCompany(classification.companyName);
    if (!normalized) {
      counters.skipsByReason.COMPANY_UNREADABLE += 1;
      continue;
    }

    // 2 and 3. Indexed equality lookup, then a loose role comparison inside
    //          that candidate set only.
    const found = await candidatesFor(pass, normalized);

    // A row that names a different posting is not a candidate at all, however
    // well the titles happen to score against each other. Neither is one that
    // ended and then went quiet for a season.
    const candidates: Application[] = [];
    for (const candidate of found) {
      if (await requisitionContradicts(pass, candidate.id, incomingRequisitions)) continue;
      if (await endedAndQuiet(pass, candidate, message, incomingRequisitions)) continue;
      candidates.push(candidate);
    }

    // A shared posting number settles it, however differently the two emails
    // word the title. Otherwise the titles have to agree and the terms must not
    // contradict: an employer running the same posting in two terms is running
    // two applications, and until the term survived being read there was
    // nothing on the row to say so (LOOP5 Decision 6).
    const numbered: Application[] = [];
    const titled: Application[] = [];
    for (const candidate of candidates) {
      if (await requisitionAgrees(pass, candidate.id, incomingRequisitions)) numbered.push(candidate);
      else if (
        !rolesDisagree(candidate.roleTitle, classification) &&
        !(await termContradicts(pass, candidate.id, classification))
      ) {
        titled.push(candidate);
      }
    }

    const usable = numbered.length ? numbered : titled;

    let target: Application | null = null;
    let reason: LinkReason = "NEW";

    if (usable.length === 1) {
      // Settled on its posting number, or on its title. Nothing below is
      // consulted.
      target = usable[0];
      reason = numbered.length ? "REQUISITION" : "TITLE";
    } else {
      // Not settled: either no row will take it, or several will and the score
      // would be picking between them. An exam is neither of those questions,
      // so it is asked first, and only then does the score get its turn.
      target = await assessmentHandOff(pass, message, classification, candidates);
      if (target) reason = "HANDOFF";

      if (!target) {
        // More than one row is waiting on the very step this email is about,
        // so it is about all of them. This is the only place a message gains
        // more than one membership.
        let reached = await rowsWaitingOnThisStep(
          pass,
          message,
          classification,
          candidates,
          incomingRequisitions,
        );

        // Exactly one row waiting on this step is the ordinary hand off, and it
        // is the answer whoever sent the email. More than one means the email
        // is about all of them, and this is the only place a message gains
        // more than one membership.
        if (reached.length === 1) {
          target = reached[0];
          reason = "HANDOFF";
        } else if (reached.length > 1) {
          // Fan out has more than one plausible reading. Asking can only
          // narrow it, and an answer that names none of them or cannot be had
          // leaves fan out exactly as it was.
          if (adjudicator) {
            counters.adjudicateCalls += 1;
            const answer = await adjudicator(message, reached);
            if (answer) {
              counters.adjudicateCostUsd += answer.costUsd;
              const picked = reached.filter((row) => answer.chosen.includes(row.id));
              if (picked.length) reached = picked;
            } else {
              counters.adjudicateUnanswered += 1;
            }
          }

          for (const row of reached) {
            await attach(pass, message, row.id, classification, "FANOUT");
            counters.linksByReason.FANOUT += 1;
            touched.add(row.id);
          }
          counters.fanoutEvents += 1;
          counters.fanoutRowsReached += reached.length;
          attached += 1;
          continue;
        }
      }

      if (!target && usable.length > 1) {
        // Several rows could take it, so the loose score decides which, with the
        // row id breaking a dead heat so the answer never depends on row order.
        const ranked = usable
          .map((candidate) => ({ candidate, score: scoreCandidate(candidate, classification) }))
          .sort((a, b) => b.score - a.score || a.candidate.id - b.candidate.id);

        // A dead heat means nothing in the email said which row it belonged to
        // and the lowest row id won. The answer is stable, which is exactly
        // what stops anybody noticing, so it is counted.
        const levelHeat = ranked.length > 1 && ranked[0].score === ranked[1].score;
        if (levelHeat) counters.scoreTies += 1;

        // A tie is a question, not an answer. The two triggers here are the
        // two ways the code can reach this point without evidence: the rows are
        // exactly level, or the model was not sure what it was reading in the
        // first place.
        const unsure = classification.confidenceScore < ADJUDICATE_CONFIDENCE_FLOOR;
        if (adjudicator && (levelHeat || unsure)) {
          counters.adjudicateCalls += 1;
          const answer = await adjudicator(message, ranked.map((row) => row.candidate));
          if (!answer) counters.adjudicateUnanswered += 1;
          if (answer) {
            counters.adjudicateCostUsd += answer.costUsd;
            const picked = usable.filter((row) => answer.chosen.includes(row.id));
            // An outcome is about one application however many the model
            // named, for the same reason fan out never carries one.
            const many = picked.length > 1 && classification.emailEvent !== "DECISION";
            if (many) {
              for (const row of picked) {
                await attach(pass, message, row.id, classification, "FANOUT");
                counters.linksByReason.FANOUT += 1;
                touched.add(row.id);
              }
              counters.fanoutEvents += 1;
              counters.fanoutRowsReached += picked.length;
              attached += 1;
              continue;
            }
            if (picked.length === 1) {
              await attach(pass, message, picked[0].id, classification, "SCORE");
              counters.linksByReason.SCORE += 1;
              touched.add(picked[0].id);
              attached += 1;
              continue;
            }
            if (answer.chosen.length === 0) {
              // None of them. A new application, which is what "none" means.
              const fresh = await createApplication(pass, classification, message, counters);
              counters.linksByReason.NEW += 1;
              await attach(pass, message, fresh.id, classification, "NEW");
              touched.add(fresh.id);
              created += 1;
              attached += 1;
              continue;
            }
          }
        }

        target = ranked[0].candidate;
        reason = "SCORE";
      }
    }

    if (!target) {
      target = await createApplication(pass, classification, message, counters);
      reason = "NEW";
      created += 1;
    } else {
      await rememberAlias(
        pass,
        normalized,
        target.companyName,
        reason,
        isWitnessed(reason, rolesIdentical(target.roleTitle, classification.roleTitle)),
        counters,
      );
    }

    counters.linksByReason[reason] += 1;
    await attach(pass, message, target.id, classification, reason);
    touched.add(target.id);
    attached += 1;
  }

  return { attached, created, touched: [...touched], counters, given: messages.length };
}
