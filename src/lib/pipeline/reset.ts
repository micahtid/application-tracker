import type { Db } from "@/lib/db";

/**
 * Everything the syncs have built, thrown away, so the next run starts from an
 * empty database and reads the whole mailbox again.
 *
 * What is kept is what a person put there by hand: the Gmail account, the API
 * key, the date to read from, and the usage total, which records money that was
 * really spent and is not undone by forgetting the emails it paid for.
 *
 * What goes is everything derived: the downloaded emails and the cached model
 * answers beside them, the applications projected out of those emails, and the
 * sync history, whose absence is what makes the next run a FULL one.
 *
 * Corrections go with the emails they are anchored to. A rescrape downloads the
 * same mail under fresh row ids, so an anchor kept behind would point at a row
 * that no longer exists (LOOP Invariant 1).
 */
export async function resetEverything(db: Db): Promise<void> {
  // Detach first, so deleting the applications cannot take a message with it,
  // the same order the grouping rebuild uses.
  await db.emailMessage.updateMany({
    where: { applicationId: { not: null } },
    data: { applicationId: null },
  });
  await db.applicationStatusHistory.deleteMany({});
  await db.application.deleteMany({});
  await db.companyAlias.deleteMany({});

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
