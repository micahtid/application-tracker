import type { Db } from "@/lib/db";
import type { Status } from "@/lib/constants";
import { messagesOf } from "./membership";
import { plural, verb } from "@/lib/text";

/**
 * The two corrections made by hand: hide a row, or override its status. They
 * are the only values in the application table not worked out from the emails,
 * which is why a rebuild deletes everything except these.
 *
 * A correction is keyed by its anchor, the oldest message in the application
 * when it was made, so it follows that message into whichever rebuilt row now
 * holds it.
 */

export type ResolvedCorrection = {
  applicationId: number;
  anchorMessageId: number;
  isHidden: boolean;
  statusOverride: Status | null;
  /** True when the row the anchor landed in no longer looks like the one corrected. */
  adrift: boolean;
  /** Corrections on the same row that an later one has superseded. Kept, but inert. */
  superseded: number;
};

/** Nothing set: what a row with no correction on it looks like. */
export const NO_CORRECTION = { isHidden: false, statusOverride: null } as const;

function sameText(left: string | null, right: string | null): boolean {
  return (left ?? "").trim().toLowerCase() === (right ?? "").trim().toLowerCase();
}

/**
 * Every correction, lined up against the application its anchor message now
 * sits in. When two corrected rows merge, both records survive: the most
 * recent one applies and the older one stays recorded but inert.
 */
export async function resolveCorrections(db: Db): Promise<Map<number, ResolvedCorrection>> {
  const corrections = await db.applicationCorrection.findMany({
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    include: { message: { select: { memberships: { select: { applicationId: true } } } } },
  });
  if (!corrections.length) return new Map();

  const applications = await db.application.findMany({
    select: { id: true, companyNormalized: true, roleTitle: true },
  });
  const byId = new Map(applications.map((row) => [row.id, row]));

  const resolved = new Map<number, ResolvedCorrection>();

  for (const correction of corrections) {
    // A correction follows its anchor into whichever row now holds it, and an
    // anchor may in principle be held by more than one. In practice it never
    // is: fan out only reaches a row already waiting on a step, so a fanned
    // out email always has an earlier email above it and can never be the
    // oldest message of anything.
    for (const { applicationId } of correction.message.memberships) {
      const application = byId.get(applicationId);
      const adrift = Boolean(
        application &&
          (!sameText(correction.companySnapshot, application.companyNormalized) ||
            !sameText(correction.roleSnapshot, application.roleTitle)),
      );

      // Ordered oldest first, so a later write simply replaces the winner and
      // counts the one it displaced.
      const previous = resolved.get(applicationId);
      resolved.set(applicationId, {
        applicationId,
        anchorMessageId: correction.anchorMessageId,
        isHidden: correction.isHidden,
        statusOverride: (correction.statusOverride as Status | null) ?? null,
        adrift,
        superseded: previous ? previous.superseded + 1 : 0,
      });
    }
  }

  return resolved;
}

/**
 * Records a correction against the application's oldest message. The snapshot
 * is what the row said at the time, so a later rebuild can tell whether the
 * anchor still lands somewhere the correction fits.
 */
export async function saveCorrection(
  db: Db,
  applicationId: number,
  patch: { isHidden?: boolean; statusOverride?: Status | null },
): Promise<ResolvedCorrection | null> {
  const application = await db.application.findUnique({ where: { id: applicationId } });
  if (!application) return null;

  const anchor = (await messagesOf(db, applicationId))[0];
  if (!anchor) return null;

  const current = await resolveCorrections(db);
  const existing = current.get(applicationId);

  const isHidden = patch.isHidden ?? existing?.isHidden ?? false;
  const statusOverride =
    "statusOverride" in patch ? patch.statusOverride ?? null : existing?.statusOverride ?? null;

  const snapshot = {
    isHidden,
    statusOverride,
    companySnapshot: application.companyNormalized,
    roleSnapshot: application.roleTitle,
  };

  await db.applicationCorrection.upsert({
    where: { anchorMessageId: anchor.id },
    create: { anchorMessageId: anchor.id, ...snapshot },
    update: snapshot,
  });

  return {
    applicationId,
    anchorMessageId: anchor.id,
    isHidden,
    statusOverride,
    adrift: false,
    superseded: existing && existing.anchorMessageId !== anchor.id ? existing.superseded + 1 : 0,
  };
}

/**
 * One line per correction that came out of a rebuild somewhere it no longer
 * obviously fits. Reported on the same path as a merge collision, so it is
 * visible rather than applied without a word.
 */
export async function correctionNotes(db: Db): Promise<string[]> {
  const resolved = await resolveCorrections(db);
  const notes: string[] = [];

  for (const correction of resolved.values()) {
    if (correction.adrift) {
      notes.push(
        `A correction has moved to a row that now reads differently (application ${correction.applicationId}). Check it still says what you meant.`,
      );
    }
    if (correction.superseded) {
      notes.push(
        `${plural(correction.superseded, "older correction")} on application ${correction.applicationId} ${verb(correction.superseded, "is", "are")} now inert because the rows they were made on have merged.`,
      );
    }
  }

  return notes;
}
