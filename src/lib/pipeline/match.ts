import type { Application, EmailMessage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { CLASSIFIER_VERSION } from "@/lib/constants";
import { ROLE_MATCH_THRESHOLD, dedupeKey, normalizeCompany, roleSimilarity } from "@/lib/normalize";
import { classificationOf } from "./recompute";
import type { Classification } from "@/lib/llm";

/**
 * Stage 4 (3.5). A separate serial pass, oldest first.
 *
 * Classification runs about ten messages at once and finishes in unpredictable
 * order, so matching cannot live inside it: two emails from the same company
 * would look each other up at the same moment, both find nothing, and both
 * create an application.
 */

export type MatchOutcome = { attached: number; created: number; touched: number[] };

/** The alias table remembers company names already matched together (3.5). */
async function candidatesFor(normalized: string): Promise<Application[]> {
  const names = new Set([normalized]);

  const alias = await prisma.companyAlias.findUnique({ where: { aliasNormalized: normalized } });
  if (alias) names.add(normalizeCompany(alias.canonicalCompanyName));

  const aliasesTo = await prisma.companyAlias.findMany({
    where: { canonicalCompanyName: { not: "" } },
    select: { aliasNormalized: true, canonicalCompanyName: true },
  });
  for (const row of aliasesTo) {
    if (normalizeCompany(row.canonicalCompanyName) === normalized) names.add(row.aliasNormalized);
  }

  // The indexed equality lookup does the narrowing, so the loose comparison
  // below never runs at scale.
  return prisma.application.findMany({ where: { companyNormalized: { in: [...names] } } });
}

function scoreCandidate(candidate: Application, classification: Classification): number {
  const bothRolesKnown = Boolean(candidate.roleTitle && classification.roleTitle);
  let score = bothRolesKnown ? roleSimilarity(candidate.roleTitle, classification.roleTitle) : 0.5;

  // Season and year break ties only when both sides actually have them (3.5).
  if (candidate.season && classification.season) {
    score += candidate.season === classification.season ? 0.1 : -0.25;
  }
  if (candidate.year && classification.year) {
    score += candidate.year === classification.year ? 0.1 : -0.25;
  }

  return score;
}

async function createApplication(classification: Classification, message: EmailMessage) {
  const companyName = classification.companyName!;
  const companyNormalized = normalizeCompany(companyName);
  const key = dedupeKey({
    companyNormalized,
    roleTitle: classification.roleTitle,
    season: classification.season,
    year: classification.year,
  });

  const existing = await prisma.application.findUnique({ where: { dedupeKey: key } });
  if (existing) return existing;

  return prisma.application.create({
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
  message: EmailMessage,
  applicationId: number,
  classification: Classification,
): Promise<void> {
  await prisma.emailMessage.update({
    where: { id: message.id },
    data: { applicationId },
  });

  // Only significant emails write status history. Without this rule a
  // "sounds good, see you Thursday" reply would drag an offer out of
  // Accepted (3.6).
  if (classification.isSignificant) {
    await prisma.applicationStatusHistory.upsert({
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

async function rememberAlias(aliasNormalized: string, canonicalCompanyName: string) {
  if (!aliasNormalized || aliasNormalized === normalizeCompany(canonicalCompanyName)) return;
  await prisma.companyAlias.upsert({
    where: { aliasNormalized },
    create: { aliasNormalized, canonicalCompanyName },
    update: {},
  });
}

export async function attachClassified(): Promise<MatchOutcome> {
  const messages = await prisma.emailMessage.findMany({
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

    // 1. Thread already linked to an application. Present only sometimes,
    //    never depended on, but it is what links a bare "Re: your application"
    //    that names no company at all.
    if (message.threadId) {
      const sibling = await prisma.emailMessage.findFirst({
        where: { threadId: message.threadId, applicationId: { not: null } },
        orderBy: { receivedAt: "asc" },
      });
      if (sibling?.applicationId) {
        await attach(message, sibling.applicationId, classification);
        if (classification.companyName) {
          const application = await prisma.application.findUnique({
            where: { id: sibling.applicationId },
          });
          if (application) {
            await rememberAlias(
              normalizeCompany(classification.companyName),
              application.companyName,
            );
          }
        }
        touched.add(sibling.applicationId);
        attached += 1;
        continue;
      }
    }

    // A message with no company creates no application: company is the anchor
    // for matching, so a nameless row could never be matched to anything (3.5).
    if (!classification.companyName) continue;

    const normalized = normalizeCompany(classification.companyName);
    if (!normalized) continue;

    // 2 and 3. Indexed equality lookup, then a loose role comparison inside
    //          that candidate set only.
    const candidates = await candidatesFor(normalized);

    let target: Application | null = null;

    if (candidates.length === 1) {
      const only = candidates[0];
      const bothRolesKnown = Boolean(only.roleTitle && classification.roleTitle);
      const clearlyDifferent =
        bothRolesKnown && roleSimilarity(only.roleTitle, classification.roleTitle) < ROLE_MATCH_THRESHOLD;
      target = clearlyDifferent ? null : only;
    } else if (candidates.length > 1) {
      const ranked = candidates
        .map((candidate) => ({ candidate, score: scoreCandidate(candidate, classification) }))
        .sort((a, b) => b.score - a.score);
      target = ranked[0].score >= ROLE_MATCH_THRESHOLD ? ranked[0].candidate : null;
    }

    if (!target) {
      target = await createApplication(classification, message);
      created += 1;
    } else {
      await rememberAlias(normalized, target.companyName);
    }

    await attach(message, target.id, classification);
    touched.add(target.id);
    attached += 1;
  }

  return { attached, created, touched: [...touched] };
}
