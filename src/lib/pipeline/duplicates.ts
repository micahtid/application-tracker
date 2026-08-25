import type { Db } from "@/lib/db";
import {
  ROLE_MATCH_THRESHOLD,
  normalizeCompany,
  pairsToCompare,
  requisitionNumbers,
  requisitionsDisagree,
  roleSimilarity,
  rolesMatch,
  sameEmployer,
} from "@/lib/normalize";

/**
 * The duplicate alarm that can actually fire.
 *
 * The unique `dedupe_key` cannot notice the failure it was meant to: two rows
 * that should be one have different keys by construction, so it catches only
 * identical repeats, which the serial pass already prevents.
 *
 * This is a report instead. It finds pairs at the same employer whose titles
 * all but agree, which are the pairs one rule change away from merging and so
 * the ones worth a person's eye. Advisory only. Nothing acts on it.
 */

export type SplitSuspect = {
  left: number;
  right: number;
  company: string;
  roles: [string | null, string | null];
  similarity: number;
};

/** How many applications' emails are held in memory at once. */
const BODY_BATCH = 50;

/**
 * The posting numbers on each application, in the order the ids were given.
 *
 * The bodies are the whole mail corpus and all that is wanted out of them is a
 * handful of numbers, so they are read a batch at a time and let go again
 * rather than pulled across in one piece.
 */
async function requisitionsOf(db: Db, ids: number[]): Promise<Set<string>[]> {
  const found: Set<string>[] = [];

  for (let at = 0; at < ids.length; at += BODY_BATCH) {
    const batch = ids.slice(at, at + BODY_BATCH);

    const memberships = await db.applicationMembership.findMany({
      where: { applicationId: { in: batch } },
      select: { applicationId: true, message: { select: { subject: true, bodyText: true } } },
    });

    const inBatch = new Map(batch.map((id) => [id, new Set<string>()]));
    for (const { applicationId, message } of memberships) {
      const all = inBatch.get(applicationId)!;
      for (const value of requisitionNumbers(message.subject, message.bodyText)) all.add(value);
    }

    for (const id of batch) found.push(inBatch.get(id)!);
  }

  return found;
}

export async function findSplitSuspects(db: Db): Promise<SplitSuspect[]> {
  const applications = await db.application.findMany({ orderBy: { id: "asc" } });
  const requisitions = await requisitionsOf(
    db,
    applications.map((application) => application.id),
  );

  const suspects: SplitSuspect[] = [];

  const pairs = pairsToCompare(applications.map((application) => application.companyNormalized));

  for (const [i, j] of pairs) {
    const left = applications[i];
    const right = applications[j];

    if (!sameEmployer(left.companyNormalized, right.companyNormalized)) continue;

    // Different posting numbers is the employer saying these are two
    // applications. That is not a suspect, it is an answer.
    if (requisitionsDisagree(requisitions[i], requisitions[j])) continue;

    // Already considered the same job, so they would have been merged for
    // some other reason. Nothing to report.
    if (rolesMatch(left.roleTitle, right.roleTitle)) continue;

    const similarity = roleSimilarity(left.roleTitle, right.roleTitle);
    if (similarity < ROLE_MATCH_THRESHOLD) continue;

    suspects.push({
      left: left.id,
      right: right.id,
      company: normalizeCompany(left.companyName),
      roles: [left.roleTitle, right.roleTitle],
      similarity,
    });
  }

  return suspects;
}
