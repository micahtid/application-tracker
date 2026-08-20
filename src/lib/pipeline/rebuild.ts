import type { Db } from "@/lib/db";
import { GROUPING_VERSION } from "@/lib/constants";
import { attachClassified } from "./match";
import { recomputeAll } from "./recompute";
import { correctionNotes } from "./corrections";

/**
 * The application table is a projection of the messages (LOOP Invariant 1).
 * Clearing everything derived and grouping the whole message set again, oldest
 * first, therefore gives the same board back.
 *
 * This is how a change to a stage 4 or 5 rule reaches a board that is already
 * grouped wrong. Without it a better matching rule would only help mail that
 * has not arrived yet, because stage 4 groups as it goes and never revisits a
 * decision it has made.
 *
 * No Gmail, no model, no cost. The emails and the cached model answers beside
 * them are exactly what is *not* wiped.
 */

export type RebuildOutcome = {
  applications: number;
  attached: number;
  created: number;
  notes: string[];
};

export async function rebuildGrouping(db: Db): Promise<RebuildOutcome> {
  // Detach first, so deleting the applications cannot take a message with it.
  await db.emailMessage.updateMany({
    where: { applicationId: { not: null } },
    data: { applicationId: null },
  });
  await db.applicationStatusHistory.deleteMany({});
  await db.application.deleteMany({});
  // The alias table is derived too: it only ever records pairs an earlier run
  // matched, so keeping it would carry a grouping decision across the rebuild.
  await db.companyAlias.deleteMany({});

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
 * Rebuilds once when the grouping rules have moved on, and does nothing at all
 * when they have not. The same idiom `classifier_version` already uses for the
 * classification cache (Part 9), so there is one concept here rather than two.
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
