import type { EmailMessage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { parseClassification, type Classification } from "@/lib/llm";
import { dedupeKey, normalizeCompany } from "@/lib/normalize";
import { vendorForDomain } from "@/lib/ats";
import type { Status } from "@/lib/constants";

/**
 * Stage 5 (3.6). Every field on a row is worked out from its emails and
 * rewritten whenever that set changes. Nothing is written once and frozen.
 *
 *   Identity comes from the oldest email. State comes from the newest
 *   significant one.
 */

/** The saved model answer for one email, or null when there is not one. */
export function classificationOf(message: EmailMessage): Classification | null {
  if (!message.llmClassificationRaw) return null;
  try {
    return parseClassification(JSON.parse(message.llmClassificationRaw));
  } catch {
    return null;
  }
}

/**
 * Only used when two status rows carry the exact same timestamp. It never
 * decides between stages, because a rejection arriving after an interview has
 * to win on date alone (3.6).
 */
const TIE_ORDER: Status[] = ["ACCEPTED", "REJECTED", "IN_PROGRESS", "APPLIED"];

export async function recomputeApplication(applicationId: number): Promise<void> {
  const application = await prisma.application.findUnique({ where: { id: applicationId } });
  if (!application) return;

  const messages = await prisma.emailMessage.findMany({
    where: { applicationId },
    orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
  });

  // An application is a view of its emails. With none left, there is nothing to
  // view, and the hand made corrections on it have nothing to correct.
  if (!messages.length) {
    await prisma.application.delete({ where: { id: applicationId } });
    return;
  }

  const oldest = messages[0];
  const identity = classificationOf(oldest);

  const companyName = identity?.companyName ?? application.companyName;
  const companyNormalized = normalizeCompany(companyName);

  const history = await prisma.applicationStatusHistory.findMany({
    where: { applicationId },
    orderBy: [{ detectedAt: "desc" }],
    include: { message: true },
  });

  const newest = history.length
    ? history
        .filter((row) => row.detectedAt.getTime() === history[0].detectedAt.getTime())
        .sort(
          (a, b) =>
            TIE_ORDER.indexOf(a.status as Status) - TIE_ORDER.indexOf(b.status as Status),
        )[0]
    : null;

  const status = (newest?.status as Status) ?? "APPLIED";
  const stageDetail =
    status === "IN_PROGRESS" && newest ? classificationOf(newest.message)?.stageDetail ?? null : null;

  const atsVendor =
    messages.map((message) => vendorForDomain(message.senderDomain)).find(Boolean) ?? null;

  const data = {
    companyName,
    companyNormalized,
    companyDomain: identity?.companyDomain ?? null,
    roleTitle: identity?.roleTitle ?? null,
    season: identity?.season ?? null,
    year: identity?.year ?? null,
    status,
    stageDetail,
    firstEmailAt: oldest.receivedAt,
    latestEmailAt: messages[messages.length - 1].receivedAt,
    atsVendor,
    confidence: identity?.confidenceScore ?? null,
  };

  const key = dedupeKey({
    companyNormalized,
    roleTitle: data.roleTitle,
    season: data.season,
    year: data.year,
  });

  try {
    await prisma.application.update({ where: { id: applicationId }, data: { ...data, dedupeKey: key } });
  } catch {
    // The unique rule on dedupe_key is an alarm, not the thing that prevents
    // duplicates (3.5). Keeping the row distinct lets the sync finish; the
    // collision is what the alarm was for.
    await prisma.application.update({
      where: { id: applicationId },
      data: { ...data, dedupeKey: `${key}#${applicationId}` },
    });
  }
}

/** Recalculates several applications, skipping ids that appear twice. */
export async function recomputeAll(ids: Iterable<number>): Promise<void> {
  for (const id of new Set(ids)) await recomputeApplication(id);
}
