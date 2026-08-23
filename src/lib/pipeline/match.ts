import type { Application, EmailMessage } from "@prisma/client";
import type { Db } from "@/lib/db";
import { CLASSIFIER_VERSION } from "@/lib/constants";
import {
  ROLE_MATCH_THRESHOLD,
  dedupeKey,
  namePrefixes,
  normalizeCompany,
  requisitionNumbers,
  requisitionsDisagree,
  roleSimilarity,
  rolesMatch,
  sameEmployer,
} from "@/lib/normalize";
import { isAssessmentVendor } from "@/lib/ats";
import { classificationOf, headState } from "./recompute";
import type { Classification } from "@/lib/llm";

/**
 * Stage 4. A separate serial pass, oldest first.
 *
 * Classification runs about ten messages at once and finishes in unpredictable
 * order, so matching cannot live inside it: two emails from the same company
 * would look each other up at the same moment, both find nothing, and both
 * create an application.
 */

export type MatchOutcome = { attached: number; created: number; touched: number[] };

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
    where: { applicationId },
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
    const attached = await db.emailMessage.findMany({
      where: { applicationId: candidate.id },
      orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
    });
    const state = headState(attached);
    // Any step the applicant was sent away to do, not the assessment stage
    // alone: a row waiting on a recorded interview or a background check is
    // waiting on a third party just as much. Naming one value of four would
    // narrow this rule silently as the vocabulary grows.
    if (state.status === "IN_PROGRESS" && state.stageDetail) waiting.push(candidate);
  }

  return waiting.length === 1 ? waiting[0] : null;
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

async function createApplication(db: Db, classification: Classification, message: EmailMessage) {
  const companyName = classification.companyName!;
  const companyNormalized = normalizeCompany(companyName);
  const key = dedupeKey({
    companyNormalized,
    roleTitle: classification.roleTitle,
    season: classification.season,
    year: classification.year,
    requisitions: requisitionNumbers(message.subject, message.bodyText),
  });

  const existing = await db.application.findUnique({ where: { dedupeKey: key } });
  if (existing) return existing;

  // An employer written as two words here may be one word in the next email,
  // and a prefix lookup cannot see across a space that is not there. Recording
  // the run together form as an alias lets the later email find this row.
  const joined = companyNormalized.replace(/ /g, "");
  if (joined !== companyNormalized) await rememberAlias(db, joined, companyName);

  return db.application.create({
    data: {
      companyName,
      companyNormalized,
      companyDomain: classification.companyDomain,
      roleTitle: classification.roleTitle,
      dedupeKey: key,
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
): Promise<void> {
  await db.emailMessage.update({
    where: { id: message.id },
    data: { applicationId },
  });

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

async function rememberAlias(db: Db, aliasNormalized: string, canonicalCompanyName: string) {
  if (!aliasNormalized || aliasNormalized === normalizeCompany(canonicalCompanyName)) return;
  await db.companyAlias.upsert({
    where: { aliasNormalized },
    create: { aliasNormalized, canonicalCompanyName },
    update: {},
  });
}

export async function attachClassified(db: Db): Promise<MatchOutcome> {
  const messages = await db.emailMessage.findMany({
    where: {
      classificationStatus: "OK",
      classifierVersion: CLASSIFIER_VERSION,
      isApplicationRelated: true,
      applicationId: null,
    },
    orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
  });

  const touched = new Set<number>();
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
      const sibling = await db.emailMessage.findFirst({
        where: { threadId: message.threadId, applicationId: { not: null } },
        orderBy: { receivedAt: "asc" },
      });
      if (sibling?.applicationId) {
        const application = await db.application.findUnique({
          where: { id: sibling.applicationId },
        });

        const contradicted =
          application &&
          (rolesDisagree(application.roleTitle, classification) ||
            (await requisitionContradicts(db, application.id, incomingRequisitions)));

        if (!contradicted) {
          await attach(db, message, sibling.applicationId, classification);
          if (classification.companyName && application) {
            await rememberAlias(
              db,
              normalizeCompany(classification.companyName),
              application.companyName,
            );
          }
          touched.add(sibling.applicationId);
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
    // well the titles happen to score against each other.
    const candidates: Application[] = [];
    for (const candidate of found) {
      if (!(await requisitionContradicts(db, candidate.id, incomingRequisitions))) {
        candidates.push(candidate);
      }
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

    if (usable.length === 1) {
      // Settled on its title. Nothing below is consulted.
      target = usable[0];
    } else {
      // Not settled: either no row will take it, or several will and the score
      // would be picking between them. An exam is neither of those questions,
      // so it is asked first, and only then does the score get its turn.
      target = await assessmentHandOff(db, message, classification, candidates);

      if (!target && usable.length > 1) {
        // Several rows could take it, so the loose score decides which, with the
        // row id breaking a dead heat so the answer never depends on row order.
        target = usable
          .map((candidate) => ({ candidate, score: scoreCandidate(candidate, classification) }))
          .sort((a, b) => b.score - a.score || a.candidate.id - b.candidate.id)[0].candidate;
      }
    }

    if (!target) {
      target = await createApplication(db, classification, message);
      created += 1;
    } else {
      await rememberAlias(db, normalized, target.companyName);
    }

    await attach(db, message, target.id, classification);
    touched.add(target.id);
    attached += 1;
  }

  return { attached, created, touched: [...touched] };
}
