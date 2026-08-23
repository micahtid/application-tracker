import type { Db } from "@/lib/db";
import { clearGrouping } from "./rebuild";

/**
 * Everything the syncs built, thrown away, so the next run reads the whole
 * mailbox again from an empty database.
 *
 * Kept: what a person put there by hand, which is the Gmail account, the API
 * key, the date to read from, and the usage total, since that records money
 * really spent.
 *
 * Gone: everything derived, which is the downloaded emails and their cached
 * model answers, the applications projected out of them, and the sync history,
 * whose absence is what makes the next run a FULL one. Corrections go with the
 * emails they anchor to, because a rescrape downloads the same mail under
 * fresh row ids (LOOP Invariant 1).
 */
export async function resetEverything(db: Db): Promise<void> {
  await clearGrouping(db);

  // Nesting is a message pointing at another message, so it is undone before
  // the rows themselves go.
  await db.emailMessage.updateMany({
    where: { parentMessageId: { not: null } },
    data: { parentMessageId: null, parentRelation: null },
  });
  await db.applicationCorrection.deleteMany({});
  await db.emailMessage.deleteMany({});

  // Usage rows survive this: sync_run_id is set to null rather than cascading,
  // so the all time total in Settings stays honest.
  await db.syncRun.deleteMany({});

  // A null version makes the first run after the reset group from scratch
  // rather than trusting a rebuild that happened before the wipe.
  await db.userSettings.updateMany({ data: { groupingVersion: null } });
}
