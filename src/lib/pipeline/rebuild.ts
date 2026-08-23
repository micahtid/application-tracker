import type { Db } from "@/lib/db";
import { GROUPING_VERSION } from "@/lib/constants";
import { attachClassified } from "./match";
import { recomputeAll } from "./recompute";
import { correctionNotes } from "./corrections";

/**
 * The application table is a projection of the messages (LOOP Invariant 1), so
 * clearing everything derived and grouping the set again, oldest first, gives
 * the same board back.
 *
 * This is how a changed stage 4 or 5 rule reaches mail that is already grouped
 * wrong: stage 4 groups as it goes and never revisits a decision.
 *
 * No Gmail, no model, no cost. The emails and their cached model answers are
 * exactly what is not wiped.
 */

export type RebuildOutcome = {
  applications: number;
  attached: number;
  created: number;
  notes: string[];
};

/**
 * Everything grouping produced, removed. The messages and their saved model
 * answers stay. Messages are detached first, so deleting an application cannot
 * take one with it. The alias table goes too: it only records pairs an earlier
 * run matched, so keeping it would carry a grouping decision across the wipe.
 */
export async function clearGrouping(db: Db): Promise<void> {
  await db.emailMessage.updateMany({
    where: { applicationId: { not: null } },
    data: { applicationId: null },
  });
  await db.applicationStatusHistory.deleteMany({});
  await db.application.deleteMany({});
  await db.companyAlias.deleteMany({});
}

export async function rebuildGrouping(db: Db): Promise<RebuildOutcome> {
  await clearGrouping(db);

  const matched = await attachClassified(db);

  const all = await db.application.findMany({ select: { id: true } });
  await recomputeAll(db, all.map((row) => row.id));

  const applications = await db.application.count();

  return {
    applications,
    attached: matched.attached,
    created: matched.created,
    notes: await correctionNotes(db),
  };
}

/**
 * Rebuilds once when the grouping rules have moved on, and does nothing when
 * they have not. The same idiom `classifier_version` uses for the
 * classification cache, so there is one concept here rather than two.
 */
export async function rebuildIfStale(db: Db): Promise<RebuildOutcome | null> {
  const settings = await db.userSettings.findFirst({ where: { id: 1 } });
  if (settings?.groupingVersion === GROUPING_VERSION) return null;

  const outcome = await rebuildGrouping(db);

  await db.userSettings.upsert({
    where: { id: 1 },
    create: { id: 1, groupingVersion: GROUPING_VERSION },
    update: { groupingVersion: GROUPING_VERSION },
  });

  return outcome;
}
