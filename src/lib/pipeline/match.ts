import type { Application, EmailMessage } from "@prisma/client";
import type { Db } from "@/lib/db";
import { ADJUDICATE_CONFIDENCE_FLOOR, CLASSIFIER_VERSION, REOPEN_GAP_DAYS } from "@/lib/constants";
import {
  ROLE_MATCH_THRESHOLD,
  dedupeKey,
  namePrefixes,
  normalizeCompany,
  requisitionNumbers,
  requisitionsDisagree,
  roleSimilarity,
  rolesIdentical,
  rolesMatch,
  sameEmployer,
} from "@/lib/normalize";
import { isAssessmentVendor } from "@/lib/ats";
import { classificationOf, headState } from "./recompute";
import { emptyCounters, isWitnessed, type LinkReason, type PipelineCounters } from "./counters";
import { applicationForThread, link, messagesOf, unclaimedMessages } from "./membership";
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
 * Asked when the code has run out of evidence (LOOP4 Decision 6).
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
};

/**
 * Candidate rows for a company name, from the alias table and from the name
 * itself. Both passes stay on the `company_normalized` index: an equality
 * lookup over every leading prefix of the incoming name catches a shorter
 * stored name, and a prefix match on the first token catches a shorter
 * incoming one.
 */
async function candidatesFor(db: Db, normalized: string): Promise<Application[]> {
  const names = new Set([normalized, ...namePrefixes(normalized)]);
  const aliased = new Set<string>();

  const alias = await db.companyAlias.findUnique({ where: { aliasNormalized: normalized } });
  if (alias) aliased.add(normalizeCompany(alias.canonicalCompanyName));

  const aliasesTo = await db.companyAlias.findMany({
    where: { canonicalCompanyName: { not: "" } },
    select: { aliasNormalized: true, canonicalCompanyName: true },
  });
  for (const row of aliasesTo) {
    if (normalizeCompany(row.canonicalCompanyName) === normalized) aliased.add(row.aliasNormalized);
  }

  const firstToken = normalized.split(" ")[0] ?? normalized;

  const [byName, byPrefix] = await Promise.all([
    db.application.findMany({ where: { companyNormalized: { in: [...names, ...aliased] } } }),
    db.application.findMany({ where: { companyNormalized: { startsWith: firstToken } } }),
  ]);

  const found = new Map<number, Application>();
  for (const row of [...byName, ...byPrefix]) found.set(row.id, row);

  // The indexed lookups do the narrowing, so the loose comparison below never
  // runs at scale. An alias is an explicit statement that two names are one
  // employer, so it is taken at its word.
  return [...found.values()].filter(
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

/** True when both sides quote a posting number and they quote the same one. */
async function requisitionAgrees(
  db: Db,
  applicationId: number,
  incoming: Set<string>,
): Promise<boolean> {
  if (!incoming.size) return false;
  const known = await requisitionsOf(db, applicationId);
  for (const value of incoming) if (known.has(value)) return true;
  return false;
}

/** Every posting number quoted by any email already on an application. */
async function requisitionsOf(db: Db, applicationId: number): Promise<Set<string>> {
  const messages = await db.emailMessage.findMany({
    where: { memberships: { some: { applicationId } } },
    select: { subject: true, bodyText: true },
  });

  const all = new Set<string>();
  for (const message of messages) {
    for (const value of requisitionNumbers(message.subject, message.bodyText)) all.add(value);
  }
  return all;
}

/**
 * An employer that quotes a posting number in one email and a different one in
 * the next is telling you these are two applications, whatever the titles say.
 * Two postings can be worded identically, and often are; the number is the one
 * thing that cannot be.
 */
async function requisitionContradicts(
  db: Db,
  applicationId: number,
  incoming: Set<string>,
): Promise<boolean> {
  if (!incoming.size) return false;
  return requisitionsDisagree(await requisitionsOf(db, applicationId), incoming);
}

/**
 * Whether this email came from a third party running one step for an employer
 * (LOOP3 Invariant 5).
 *
 * The model answers it, because the email says so plainly. The vendor list is
 * consulted too and can only add certainty: a sender the list knows counts
 * whatever the model said, and an unknown sender is no worse off. A lookup
 * alone was the LOOP2 rule, and it silently failed in any mailbox whose
 * vendors were not on the list.
 */
function runsAStepForAnEmployer(message: EmailMessage, classification: Classification): boolean {
  return classification.senderRole === "ASSESSMENT_VENDOR" || isAssessmentVendor(message.senderDomain);
}

/**
 * LOOP2 Invariant 1. A company that runs exams never receives an application,
 * so its email can only continue one that already exists.
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
  db: Db,
  message: EmailMessage,
  classification: Classification,
  candidates: Application[],
): Promise<Application | null> {
  if (!runsAStepForAnEmployer(message, classification)) return null;

  const waiting: Application[] = [];
  for (const candidate of candidates) {
    const state = headState(await messagesOf(db, candidate.id));
    // Any step the applicant was sent away to do, not the assessment stage
    // alone: a row waiting on a recorded interview or a background check is
    // waiting on a third party just as much. Naming one value of four would
    // narrow this rule silently as the vocabulary grows.
    if (state.status === "IN_PROGRESS" && state.stageDetail) waiting.push(candidate);
  }

  return waiting.length === 1 ? waiting[0] : null;
}

/**
 * LOOP4 Invariant 6. An email belongs to every application it is about, and to
 * no others.
 *
 * The generalisation of `assessmentHandOff`, which gives up whenever more than
 * one row is waiting. It stops giving up and reaches all of them, under
 * conditions that are all about the email rather than about any employer.
 *
 * **It never fans out a decision.** This is the rule that makes the rest safe,
 * and it is load bearing rather than cautious. `milestonesIn` writes one
 * history row per significant email per application, so an email reaching two
 * applications writes two milestones and `headState` reads each row's newest.
 * For an assessment reminder that is exactly right: both rows really did move.
 * For a rejection it would close two real applications on one email, and
 * employers withhold a rejection precisely when the candidate is still live on
 * another requisition, so the one case that looks like it covers everything is
 * the case where it provably does not.
 *
 * **A quoted posting number stops it dead.** A number is a real answer and has
 * to decide on its own.
 *
 * **It reaches only rows waiting on the same thing.** Not "waiting" in general:
 * the row's head state has to be IN_PROGRESS at the very step this email is
 * about. An assessment reminder reaches every row waiting on an assessment. It
 * does not reach a row waiting on an interview, and it does not reach a row
 * that is merely APPLIED.
 *
 * **A stated title still contradicts, unless it is a paper's name.** Decision 2
 * says the email must state no role at all. That is very nearly right and it is
 * not quite the rule, because it fails in both directions.
 *
 * Too loose: an employer running two postings sends a step invitation for each,
 * and the second names its own posting. Ignoring that title reaches the first
 * row and welds two real applications into one. The title disagreeing is
 * positive evidence, not silence.
 *
 * Too strict: the email this loop exists for does state a role, and it is the
 * wrong kind of role. A vendor names the paper after the programme rather than
 * after the posting, which is the whole reason the title comparison is the
 * wrong question for an exam and why `assessmentHandOff` sits behind it.
 * Requiring silence would leave the one real case in this mailbox unreachable
 * while still claiming to fix it.
 *
 * So the title is believed exactly when it is a posting title: when the email
 * states none, or when its sender is running a step for the employer and is
 * therefore naming its own paper. That is the same judgement `assessmentHandOff`
 * already makes, applied to the same question.
 */
async function rowsWaitingOnThisStep(
  db: Db,
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
    const state = headState(await messagesOf(db, candidate.id));
    if (state.status === "IN_PROGRESS" && state.stageDetail === classification.stageDetail) {
      waiting.push(candidate);
    }
  }
  return waiting;
}

/**
 * LOOP4 Invariant 4. An application that ended and then went quiet is
 * finished. A later email with the same title is a new application unless the
 * thread or a posting number says otherwise.
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
  db: Db,
  candidate: Application,
  message: EmailMessage,
  incomingRequisitions: Set<string>,
): Promise<boolean> {
  const attached = await messagesOf(db, candidate.id);
  if (!attached.length) return false;

  const { status } = headState(attached);
  if (status !== "ACCEPTED" && status !== "REJECTED") return false;

  const newest = attached[attached.length - 1].receivedAt.getTime();
  const gapDays = (message.receivedAt.getTime() - newest) / 86_400_000;
  if (gapDays <= REOPEN_GAP_DAYS) return false;

  return !(await requisitionAgrees(db, candidate.id, incomingRequisitions));
}

function scoreCandidate(candidate: Application, classification: Classification): number {
  const bothRolesKnown = Boolean(candidate.roleTitle && classification.roleTitle);
  let score = bothRolesKnown ? roleSimilarity(candidate.roleTitle, classification.roleTitle) : 0.5;

  // Season and year break ties only when both sides actually have them.
  if (candidate.season && classification.season) {
    score += candidate.season === classification.season ? 0.1 : -0.25;
  }
  if (candidate.year && classification.year) {
    score += candidate.year === classification.year ? 0.1 : -0.25;
  }

  return score;
}

async function createApplication(
  db: Db,
  classification: Classification,
  message: EmailMessage,
  counters: PipelineCounters,
) {
  const companyName = classification.companyName!;
  const companyNormalized = normalizeCompany(companyName);
  const key = dedupeKey({
    companyNormalized,
    roleTitle: classification.roleTitle,
    season: classification.season,
    year: classification.year,
    requisitions: requisitionNumbers(message.subject, message.bodyText),
  });

  /**
   * A key collision no longer hands back the row that owns the key.
   *
   * It used to, and that made this a second matching rule sitting underneath
   * the first and quietly overruling it. Two applications to the same posting a
   * year apart share every part of the key: same employer, same title, and no
   * season, year or posting number, which is the case for about half the
   * labelled groups here. So Invariant 4 would decide the old row is closed,
   * and this lookup would hand it straight back.
   *
   * The rules above have already decided this is a new application. The key is
   * an alarm rather than the thing that prevents duplicates (LOOP Invariant 6),
   * so the collision is counted and the row is made distinct, exactly as stage
   * 5 does. Stage 5 will settle on its own suffix on the next recalculation.
   */
  const collision = await db.application.findUnique({ where: { dedupeKey: key } });
  if (collision) counters.dedupeCollisions += 1;
  const distinctKey = collision ? `${key}#${message.gmailMessageId}` : key;

  // An employer written as two words here may be one word in the next email,
  // and a prefix lookup cannot see across a space that is not there. Recording
  // the run together form as an alias lets the later email find this row.
  const joined = companyNormalized.replace(/ /g, "");
  if (joined !== companyNormalized) await rememberAlias(db, joined, companyName, "NEW", true, counters);

  return db.application.create({
    data: {
      companyName,
      companyNormalized,
      companyDomain: classification.companyDomain,
      roleTitle: classification.roleTitle,
      dedupeKey: distinctKey,
      season: classification.season,
      year: classification.year,
      status: classification.status,
      stageDetail: classification.stageDetail,
      firstEmailAt: message.receivedAt,
      latestEmailAt: message.receivedAt,
      confidence: classification.confidenceScore,
    },
  });
}

async function attach(
  db: Db,
  message: EmailMessage,
  applicationId: number,
  classification: Classification,
  reason: LinkReason,
): Promise<void> {
  await link(db, applicationId, message.id, reason);

  // Only significant emails write status history. Without this rule a
  // "sounds good, see you Thursday" reply would drag an offer out of
  // Accepted.
  if (classification.isSignificant) {
    await db.applicationStatusHistory.upsert({
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
 * believed by every later message just as strongly as one made from evidence,
 * and nothing ever removes it (LOOP4 M2). The count is what makes that
 * visible; Iteration 3 is what stops it happening.
 */
async function rememberAlias(
  db: Db,
  aliasNormalized: string,
  canonicalCompanyName: string,
  reason: LinkReason,
  witnessed: boolean,
  counters: PipelineCounters,
) {
  if (!aliasNormalized || aliasNormalized === normalizeCompany(canonicalCompanyName)) return;

  // LOOP4 Invariant 3. A rule may believe what it observed. It may not believe
  // what it guessed as strongly as what it observed.
  //
  // This used to fire on every successful match, including one the score
  // picked between two equally good candidates. From then on `candidatesFor`
  // took the alias at its word, so a single wrong score welded two employers
  // together for good: nothing removes an alias except a rebuild, which
  // removes all of them. One wrong link then infects everything built on it.
  if (!witnessed) return;

  await db.companyAlias.upsert({
    where: { aliasNormalized },
    create: { aliasNormalized, canonicalCompanyName, reason },
    update: {},
  });
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

  const touched = new Set<number>();
  const counters = emptyCounters();
  let attached = 0;
  let created = 0;

  // Serial on purpose. Nothing here runs in parallel, so two emails from the
  // same company cannot race each other into two applications.
  for (const message of messages) {
    const classification = classificationOf(message);
    if (!classification || !classification.isApplicationRelated) continue;

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
            (await requisitionContradicts(db, application.id, incomingRequisitions)));

        if (!contradicted) {
          await attach(db, message, siblingApplicationId, classification, "THREAD");
          counters.linksByReason.THREAD += 1;
          if (classification.companyName && application) {
            await rememberAlias(
              db,
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
    if (!classification.companyName) continue;

    const normalized = normalizeCompany(classification.companyName);
    if (!normalized) continue;

    // 2 and 3. Indexed equality lookup, then a loose role comparison inside
    //          that candidate set only.
    const found = await candidatesFor(db, normalized);

    // A row that names a different posting is not a candidate at all, however
    // well the titles happen to score against each other. Neither is one that
    // ended and then went quiet for a season.
    const candidates: Application[] = [];
    for (const candidate of found) {
      if (await requisitionContradicts(db, candidate.id, incomingRequisitions)) continue;
      if (await endedAndQuiet(db, candidate, message, incomingRequisitions)) continue;
      candidates.push(candidate);
    }

    // A shared posting number settles it, however differently the two emails
    // word the title. Otherwise the titles have to agree.
    const numbered: Application[] = [];
    const titled: Application[] = [];
    for (const candidate of candidates) {
      if (await requisitionAgrees(db, candidate.id, incomingRequisitions)) numbered.push(candidate);
      else if (!rolesDisagree(candidate.roleTitle, classification)) titled.push(candidate);
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
      target = await assessmentHandOff(db, message, classification, candidates);
      if (target) reason = "HANDOFF";

      if (!target) {
        // More than one row is waiting on the very step this email is about,
        // so it is about all of them. This is the only place a message gains
        // more than one membership (LOOP4 Invariant 6).
        let reached = await rowsWaitingOnThisStep(
          db,
          message,
          classification,
          candidates,
          incomingRequisitions,
        );

        // Exactly one row waiting on this step is the ordinary hand off, and it
        // is the answer whoever sent the email. More than one means the email
        // is about all of them, and this is the only place a message gains
        // more than one membership (LOOP4 Invariant 6).
        if (reached.length === 1) {
          target = reached[0];
          reason = "HANDOFF";
        } else if (reached.length > 1) {
          // LOOP4 Invariant 9, trigger 2: fan out has more than one plausible
          // reading. Asking can only narrow it, and an answer that names none
          // of them or cannot be had leaves fan out exactly as it was.
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
            await attach(db, message, row.id, classification, "FANOUT");
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

        // Gate 9. A dead heat means nothing in the email said which row it
        // belonged to and the lowest row id won. The answer is stable, which
        // is exactly what stops anybody noticing, so it is counted.
        const levelHeat = ranked.length > 1 && ranked[0].score === ranked[1].score;
        if (levelHeat) counters.scoreTies += 1;

        // LOOP4 Invariant 9. A tie is a question, not an answer. The two
        // triggers here are the two ways the code can reach this point without
        // evidence: the rows are exactly level, or the model was not sure what
        // it was reading in the first place.
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
                await attach(db, message, row.id, classification, "FANOUT");
                counters.linksByReason.FANOUT += 1;
                touched.add(row.id);
              }
              counters.fanoutEvents += 1;
              counters.fanoutRowsReached += picked.length;
              attached += 1;
              continue;
            }
            if (picked.length === 1) {
              await attach(db, message, picked[0].id, classification, "SCORE");
              counters.linksByReason.SCORE += 1;
              touched.add(picked[0].id);
              attached += 1;
              continue;
            }
            if (answer.chosen.length === 0) {
              // None of them. A new application, which is what "none" means.
              const fresh = await createApplication(db, classification, message, counters);
              counters.linksByReason.NEW += 1;
              await attach(db, message, fresh.id, classification, "NEW");
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
      target = await createApplication(db, classification, message, counters);
      reason = "NEW";
      created += 1;
    } else {
      await rememberAlias(
        db,
        normalized,
        target.companyName,
        reason,
        isWitnessed(reason, rolesIdentical(target.roleTitle, classification.roleTitle)),
        counters,
      );
    }

    counters.linksByReason[reason] += 1;
    await attach(db, message, target.id, classification, reason);
    touched.add(target.id);
    attached += 1;
  }

  return { attached, created, touched: [...touched], counters };
}
