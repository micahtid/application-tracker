import type { Db } from "@/lib/db";
import {
  ROLE_MATCH_THRESHOLD,
  normalizeCompany,
  requisitionNumbers,
  requisitionsDisagree,
  roleSimilarity,
  rolesMatch,
  sameEmployer,
} from "@/lib/normalize";

/**
 * The duplicate alarm that can actually fire (LOOP Invariant 6).
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

export async function findSplitSuspects(db: Db): Promise<SplitSuspect[]> {
  const applications = await db.application.findMany({
    orderBy: { id: "asc" },
    include: { messages: { select: { subject: true, bodyText: true } } },
  });

  const requisitions = applications.map((application) => {
    const all = new Set<string>();
    for (const message of application.messages) {
      for (const value of requisitionNumbers(message.subject, message.bodyText)) all.add(value);
    }
    return all;
  });

  const suspects: SplitSuspect[] = [];

  for (let i = 0; i < applications.length; i += 1) {
    for (let j = i + 1; j < applications.length; j += 1) {
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
  }

  return suspects;
}
