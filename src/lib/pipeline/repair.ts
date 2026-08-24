import type { Db } from "@/lib/db";
import { REOPEN_GAP_DAYS } from "@/lib/constants";
import {
  dedupeKey,
  requisitionNumbers,
  requisitionsDisagree,
  rolesMatch,
  sameEmployer,
} from "@/lib/normalize";
import { headState } from "./recompute";
import { messagesOf } from "./membership";
import type { PipelineCounters } from "./counters";

/**
 * LOOP4 Invariant 7. A grouping decision made on partial evidence is revisited
 * once when the evidence is complete, and never more than once.
 *
 * Stage 4 files each email against whatever exists at the moment it arrives,
 * which is correct and necessary and also greedy: two rows a later email proves
 * are one stay two, and one row a later email proves is two stays one. A
 * rebuild is no help, because it replays the same pass in the same order over
 * the same data and reproduces the same answer exactly. That is what makes it a
 * rebuild, and it is what makes it useless as a repair.
 *
 * This is the repair. It is the standard answer in the entity resolution
 * literature: pairwise decisions taken in arrival order accumulate errors no
 * pairwise decision can see, so the cluster is looked at again afterwards.
 *
 * **⚠ It is not iterative, and that is the whole design.** Merging two rows
 * pools their titles and their posting numbers, which can make the merged row a
 * split suspect, splitting it back, which makes the halves merge suspects
 * again. Nothing in the conditions forbids that cycle, so "run to a fixed point
 * with a small bound" is a hope rather than a termination argument. Instead:
 *
 *   1. Read the whole board once and work out every suspect from that one
 *      snapshot. Nothing computed later sees a change made earlier.
 *   2. Apply them lowest application id first, so the result never depends on
 *      row order.
 *   3. A row touched by one repair may not be touched again in the same pass.
 *   4. Recompute the affected rows once. Stop.
 *
 * Work a second pass would have found is counted as `repair.unsettled` and
 * reported rather than chased. Leftover work that is visible is better than a
 * fixed point that is not obviously the right board, and a non zero reading is
 * a finding about a matching rule rather than a reason to run this again.
 */

/** What the pass did, in enough detail for the scorer to judge it. */
export type RepairAction = {
  kind: "MERGE" | "SPLIT";
  /** The gmail ids on each side, so a judgement survives a rebuild renumbering. */
  left: string[];
  right: string[];
};

export type RepairOutcome = { actions: RepairAction[]; unsettled: number; touched: number[] };

/**
 * The links the repair may not undo (LOOP4 Decision 3).
 *
 * > A THREAD or REQUISITION link is evidence and the repair does not get to
 * > overrule evidence on the strength of a title comparison.
 *
 * Read as protecting what the employer's own system said, which is what those
 * two reasons record. Everything else was a comparison this pass is entitled to
 * revisit, including a link with no reason at all, which is a row carried over
 * from before reasons were written and about which nothing is known.
 */
const PROTECTED_REASONS = ["THREAD", "REQUISITION"];

type Snapshot = {
  id: number;
  companyNormalized: string;
  roleTitle: string | null;
  requisitions: Set<string>;
  ended: boolean;
  firstAt: number;
  lastAt: number;
  messages: { id: number; gmailMessageId: string; requisitions: Set<string>; reason: string | null }[];
};

async function readBoard(db: Db): Promise<Snapshot[]> {
  const applications = await db.application.findMany({ orderBy: { id: "asc" } });
  const board: Snapshot[] = [];

  for (const application of applications) {
    const messages = await messagesOf(db, application.id);
    if (!messages.length) continue;

    const memberships = await db.applicationMembership.findMany({
      where: { applicationId: application.id },
      select: { messageId: true, reason: true },
    });
    const reasonOf = new Map(memberships.map((row) => [row.messageId, row.reason]));

    const requisitions = new Set<string>();
    const detailed = messages.map((message) => {
      const own = requisitionNumbers(message.subject, message.bodyText);
      for (const value of own) requisitions.add(value);
      return {
        id: message.id,
        gmailMessageId: message.gmailMessageId,
        requisitions: own,
        reason: reasonOf.get(message.id) ?? null,
      };
    });

    const { status } = headState(messages);
    board.push({
      id: application.id,
      companyNormalized: application.companyNormalized,
      roleTitle: application.roleTitle,
      requisitions,
      ended: status === "ACCEPTED" || status === "REJECTED",
      firstAt: messages[0].receivedAt.getTime(),
      lastAt: messages[messages.length - 1].receivedAt.getTime(),
      messages: detailed,
    });
  }

  return board;
}

function sharesRequisition(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

/** Decision 3's five conditions, all of which have to hold. */
function shouldMerge(left: Snapshot, right: Snapshot): boolean {
  if (!sameEmployer(left.companyNormalized, right.companyNormalized)) return false;
  if (!sharesRequisition(left.requisitions, right.requisitions) && !rolesMatch(left.roleTitle, right.roleTitle)) {
    return false;
  }
  if (requisitionsDisagree(left.requisitions, right.requisitions)) return false;
  // Two rows that have both ended are two applications that both ended. There
  // is nothing a merge could be putting right.
  if (left.ended && right.ended) return false;

  // Invariant 4 again, between rows rather than between an email and a row: an
  // application that ended and then went quiet for a season is finished, and
  // whatever came later is a new one.
  const [earlier, later] = left.firstAt <= right.firstAt ? [left, right] : [right, left];
  const gapDays = (later.firstAt - earlier.lastAt) / 86_400_000;
  if (earlier.ended && gapDays > REOPEN_GAP_DAYS) return false;

  return true;
}

/**
 * A row holding two disjoint sets of posting numbers is two applications.
 *
 * That already contradicts the matching rules, which refuse to attach an email
 * quoting a number the row disagrees with, so it should never happen. The
 * repair is where you find out that it did.
 */
function splitOf(row: Snapshot): { left: number[]; right: number[] } | null {
  const numbered = row.messages.filter((message) => message.requisitions.size);
  if (numbered.length < 2) return null;

  const first = numbered[0].requisitions;
  const away = numbered.filter((message) => !sharesRequisition(message.requisitions, first));
  if (!away.length) return null;

  // Evidence the repair may not overrule stays where it is, and a split that
  // cannot move all of its emails is not a split at all.
  if (away.some((message) => PROTECTED_REASONS.includes(message.reason ?? ""))) return null;

  const moving = new Set(away.map((message) => message.id));
  return {
    left: row.messages.filter((message) => !moving.has(message.id)).map((message) => message.id),
    right: away.map((message) => message.id),
  };
}

export async function repairGrouping(
  db: Db,
  counters: PipelineCounters,
): Promise<RepairOutcome> {
  const board = await readBoard(db);
  const byId = new Map(board.map((row) => [row.id, row]));

  // Everything is worked out from this one snapshot, before anything is
  // applied, so no suspect can be an artefact of a change made in this pass.
  const merges: [number, number][] = [];
  for (let i = 0; i < board.length; i += 1) {
    for (let j = i + 1; j < board.length; j += 1) {
      if (shouldMerge(board[i], board[j])) merges.push([board[i].id, board[j].id]);
    }
  }

  const splits: { id: number; left: number[]; right: number[] }[] = [];
  for (const row of board) {
    const parts = splitOf(row);
    if (parts) splits.push({ id: row.id, ...parts });
  }

  const actions: RepairAction[] = [];
  const touchedOnce = new Set<number>();
  const touched = new Set<number>();
  let unsettled = 0;

  // Lowest application id first, so the result never depends on row order.
  for (const [leftId, rightId] of merges.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    if (touchedOnce.has(leftId) || touchedOnce.has(rightId)) {
      unsettled += 1;
      continue;
    }
    touchedOnce.add(leftId);
    touchedOnce.add(rightId);

    const left = byId.get(leftId)!;
    const right = byId.get(rightId)!;

    // Every membership is repointed rather than dropped, so nothing is undone
    // and the protected reasons never come into it. A message already on the
    // left, which fan out can produce, keeps the membership it has.
    for (const message of right.messages) {
      await db.applicationMembership.upsert({
        where: { applicationId_messageId: { applicationId: leftId, messageId: message.id } },
        create: { applicationId: leftId, messageId: message.id, reason: message.reason },
        update: {},
      });
    }
    await db.applicationMembership.deleteMany({ where: { applicationId: rightId } });
    await db.applicationStatusHistory.deleteMany({ where: { applicationId: rightId } });
    await db.application.delete({ where: { id: rightId } });

    actions.push({
      kind: "MERGE",
      left: left.messages.map((message) => message.gmailMessageId),
      right: right.messages.map((message) => message.gmailMessageId),
    });
    counters.repairMerges += 1;
    touched.add(leftId);
  }

  for (const split of splits.sort((a, b) => a.id - b.id)) {
    if (touchedOnce.has(split.id)) {
      unsettled += 1;
      continue;
    }
    touchedOnce.add(split.id);

    const row = byId.get(split.id)!;
    const moving = new Set(split.right);

    // A key nothing else can hold. Stage 5 works out the real one from the
    // emails as soon as it runs.
    const fresh = await db.application.create({
      data: {
        companyName: row.companyNormalized,
        companyNormalized: row.companyNormalized,
        dedupeKey: `${dedupeKey({ companyNormalized: row.companyNormalized, roleTitle: null, season: null, year: null })}#split:${split.right[0]}`,
      },
    });

    await db.applicationMembership.updateMany({
      where: { applicationId: split.id, messageId: { in: [...moving] } },
      data: { applicationId: fresh.id, parentMessageId: null, parentRelation: null },
    });

    const gmailIdOf = new Map(row.messages.map((message) => [message.id, message.gmailMessageId]));
    actions.push({
      kind: "SPLIT",
      left: split.left.map((id) => gmailIdOf.get(id)!),
      right: split.right.map((id) => gmailIdOf.get(id)!),
    });
    counters.repairSplits += 1;
    touched.add(split.id);
    touched.add(fresh.id);
  }

  counters.repairUnsettled += unsettled;
  return { actions, unsettled, touched: [...touched] };
}
