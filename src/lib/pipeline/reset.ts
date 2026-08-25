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
 * fresh row ids.
 */
export async function resetEverything(db: Db): Promise<void> {
  // Nesting used to be a message pointing at another message and needed
  // undoing by hand before the rows could go. It now lives on the membership,
  // which `clearGrouping` deletes outright, so there is nothing left to undo.
  await clearGrouping(db);

  await db.applicationCorrection.deleteMany({});
  await db.emailMessage.deleteMany({});

  // Usage rows survive this: sync_run_id is set to null rather than cascading,
  // so the all time total in Settings stays honest.
  await db.syncRun.deleteMany({});

  // A null version makes the first run after the reset group from scratch
  // rather than trusting a rebuild that happened before the wipe.
  await db.userSettings.updateMany({ data: { groupingVersion: null } });
}
