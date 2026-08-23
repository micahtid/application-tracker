import type { EmailMessage } from "@prisma/client";
import type { Db } from "@/lib/db";
import { parseClassification, type Classification } from "@/lib/llm";
import {
  dedupeKey,
  hasReminderMarker,
  normalizeCompany,
  normalizeSubject,
  requisitionNumbers,
} from "@/lib/normalize";
import { vendorForDomain } from "@/lib/ats";
import type { StageDetail, Status } from "@/lib/constants";

/**
 * Stage 5. Every field on a row is worked out from its emails and
 * rewritten whenever that set changes. Nothing is written once and frozen.
 *
 *   Identity comes from the oldest email. State comes from the newest
 *   significant one.
 */

/** The saved model answer for one email, or null when there is not one. */
export function classificationOf(message: { llmClassificationRaw: string | null }): Classification | null {
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
 * to win on date alone.
 */
const TIE_ORDER: Status[] = ["ACCEPTED", "REJECTED", "IN_PROGRESS", "APPLIED"];

/**
 * The name the employer used most often across this application's emails.
 *
 * One employer writes itself several ways, so the oldest email is no more
 * authoritative than any other and the commonest wording wins. Ties go to the
 * earliest, so the answer depends only on the set of emails and never on the
 * order they were processed in.
 */
function commonestCompanyName(messages: EmailMessage[]): string | null {
  const counts = new Map<string, { count: number; first: number }>();

  messages.forEach((message, index) => {
    const name = classificationOf(message)?.companyName;
    if (!name) return;
    const seen = counts.get(name);
    if (seen) seen.count += 1;
    else counts.set(name, { count: 1, first: index });
  });

  let best: string | null = null;
  let bestCount = 0;
  let bestFirst = Number.POSITIVE_INFINITY;

  for (const [name, seen] of counts) {
    if (seen.count > bestCount || (seen.count === bestCount && seen.first < bestFirst)) {
      best = name;
      bestCount = seen.count;
      bestFirst = seen.first;
    }
  }

  return best;
}

/**
 * The value from the oldest email that states this field, rather than the
 * value on the oldest email full stop (LOOP Invariant 4).
 *
 * "Oldest wins" is right for a conflict and wrong for an absence: an email
 * saying nothing about the role does not disagree with one that does. Working
 * per field keeps the answer dependent only on the set of emails.
 */
function firstStated<T>(
  messages: EmailMessage[],
  pick: (classification: Classification) => T | null | undefined,
): T | null {
  for (const message of messages) {
    const said = classificationOf(message);
    if (!said) continue;
    const value = pick(said);
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

export type TreeNode = { parent: number | null; relation: string | null };

/**
 * Where every email of an application sits in its drawer (LOOP2 Invariant 3).
 *
 * One line for each state the application reached, which is the earliest email
 * stating that state. Every other email sits under the line for its own state.
 * No wording is compared, no threshold and nothing to tune: the model already
 * answered `status` and `stage_detail` for each email.
 *
 * Four properties follow rather than needing enforcing. The order emails
 * arrived in does not matter, so a rebuild reproduces the tree exactly. A
 * parent is always strictly earlier, so a loop is impossible. A parent is the
 * first of its state and so has no parent itself, making the tree one level
 * deep. And nothing is left homeless, because every email has a state and
 * every state has an earliest email.
 *
 * The relation is read off the wording, for display only, so a wrong one is
 * cosmetic and never structural.
 */
export function treeIn(messages: EmailMessage[]): Map<number, TreeNode> {
  const firstOfState = new Map<string, EmailMessage>();
  const subjectsInState = new Map<string, Set<string>>();
  const tree = new Map<number, TreeNode>();

  for (const message of messages) {
    const said = classificationOf(message);
    const state = [said?.status ?? "APPLIED", said?.stageDetail ?? ""].join("|");
    const subject = normalizeSubject(message.subject);

    const parent = firstOfState.get(state);
    if (!parent) {
      firstOfState.set(state, message);
      subjectsInState.set(state, new Set([subject]));
      tree.set(message.id, { parent: null, relation: null });
      continue;
    }

    // REPEAT is tested before REMINDER because a resend often carries a nudge
    // marker as well, and it is the one of the two that carries any weight
    // beyond the chip it draws: history is written by everything except it.
    const seen = subjectsInState.get(state)!;
    const relation = seen.has(subject) ? "REPEAT" : hasReminderMarker(message.subject) ? "REMINDER" : "UPDATE";
    seen.add(subject);

    tree.set(message.id, { parent: parent.id, relation });
  }

  return tree;
}

/**
 * The emails that record a change of state: significant, and not a repeat of
 * one already seen in this application.
 *
 * Two separate questions. Where an email sits in the drawer is the tree above.
 * Whether it records a change of state is this. The model sees one email at a
 * time with no thread context, which is what stops company names bleeding
 * between emails, but it also means a resend looks like the original and is
 * called significant both times. Only the whole set can tell.
 */
export function milestonesIn(messages: EmailMessage[]): { message: EmailMessage; status: Status }[] {
  const tree = treeIn(messages);
  const out: { message: EmailMessage; status: Status }[] = [];

  for (const message of messages) {
    const said = classificationOf(message);
    if (!said?.isSignificant || tree.get(message.id)?.relation === "REPEAT") continue;
    out.push({ message, status: said.status as Status });
  }

  return out;
}

export type HeadState = { status: Status; stageDetail: StageDetail | null };

/**
 * What state an application is in, worked out from its emails alone.
 *
 * Pure, and called from both stages on purpose. Stage 5 asks what the row
 * should say. Stage 4 asks what a candidate row is waiting on, and cannot read
 * the `status` column for it: that column is written when a row is created and
 * not rewritten until stage 5, which runs after the whole matching pass. Mid
 * pass it is out of date.
 */
export function headState(messages: EmailMessage[]): HeadState {
  const milestones = milestonesIn(messages);

  // An acknowledgement of receipt is a floor, not a stage: systems send "we
  // have your application" at any point, often after an assessment is already
  // set. So once an application has moved past being submitted, a later bare
  // acknowledgement does not move it back. Real outcomes still win on date.
  const movedOn = milestones.findIndex((row) => row.status !== "APPLIED");
  const meaningful =
    movedOn === -1
      ? milestones
      : milestones.filter(
          (row) =>
            row.status !== "APPLIED" ||
            row.message.receivedAt.getTime() < milestones[movedOn].message.receivedAt.getTime(),
        );

  if (!meaningful.length) return { status: "APPLIED", stageDetail: null };

  const latest = Math.max(...meaningful.map((row) => row.message.receivedAt.getTime()));
  const newest = meaningful
    .filter((row) => row.message.receivedAt.getTime() === latest)
    .sort((a, b) => TIE_ORDER.indexOf(a.status) - TIE_ORDER.indexOf(b.status))[0];

  const status = newest.status;
  return {
    status,
    stageDetail:
      status === "IN_PROGRESS" ? (classificationOf(newest.message)?.stageDetail as StageDetail | null) ?? null : null,
  };
}

export async function recomputeApplication(db: Db, applicationId: number): Promise<void> {
  const application = await db.application.findUnique({ where: { id: applicationId } });
  if (!application) return;

  const messages = await db.emailMessage.findMany({
    where: { applicationId },
    orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
  });

  // An application is a view of its emails. With none left, there is nothing to
  // view, and the hand made corrections on it have nothing to correct.
  if (!messages.length) {
    await db.application.delete({ where: { id: applicationId } });
    return;
  }

  const oldest = messages[0];
  const identity = classificationOf(oldest);

  const companyName = commonestCompanyName(messages) ?? identity?.companyName ?? application.companyName;
  const companyNormalized = normalizeCompany(companyName);

  // The tree is rewritten from the whole set on every recalculation and never
  // authored, exactly like every other field on a row.
  const tree = treeIn(messages);

  for (const message of messages) {
    const node = tree.get(message.id) ?? { parent: null, relation: null };
    if (message.parentMessageId !== node.parent || message.parentRelation !== node.relation) {
      await db.emailMessage.update({
        where: { id: message.id },
        data: { parentMessageId: node.parent, parentRelation: node.relation },
      });
    }
  }

  // History is rewritten from the whole set rather than added to as emails
  // arrive, so the first occurrence always survives whatever order they came
  // in, and a message that stops being a repeat gets its milestone back.
  await db.applicationStatusHistory.deleteMany({ where: { applicationId } });
  for (const milestone of milestonesIn(messages)) {
    await db.applicationStatusHistory.create({
      data: {
        applicationId,
        messageId: milestone.message.id,
        status: milestone.status,
        detectedAt: milestone.message.receivedAt,
      },
    });
  }

  const { status, stageDetail } = headState(messages);

  const atsVendor =
    messages.map((message) => vendorForDomain(message.senderDomain)).find(Boolean) ?? null;

  const data = {
    companyName,
    companyNormalized,
    companyDomain: firstStated(messages, (said) => said.companyDomain),
    roleTitle: firstStated(messages, (said) => said.roleTitle),
    season: firstStated(messages, (said) => said.season),
    year: firstStated(messages, (said) => said.year),
    status,
    stageDetail,
    firstEmailAt: oldest.receivedAt,
    latestEmailAt: messages[messages.length - 1].receivedAt,
    atsVendor,
    confidence: identity?.confidenceScore ?? null,
  };

  const requisitions = new Set<string>();
  for (const message of messages) {
    for (const value of requisitionNumbers(message.subject, message.bodyText)) requisitions.add(value);
  }

  const key = dedupeKey({
    companyNormalized,
    roleTitle: data.roleTitle,
    season: data.season,
    year: data.year,
    requisitions,
  });

  try {
    await db.application.update({ where: { id: applicationId }, data: { ...data, dedupeKey: key } });
  } catch {
    // The unique rule on dedupe_key is an alarm, not the thing that prevents
    // duplicates. Keeping the row distinct lets the sync finish; the
    // collision is what the alarm was for.
    await db.application.update({
      where: { id: applicationId },
      data: { ...data, dedupeKey: `${key}#${applicationId}` },
    });
  }
}

/** Recalculates several applications, skipping ids that appear twice. */
export async function recomputeAll(db: Db, ids: Iterable<number>): Promise<void> {
  for (const id of new Set(ids)) await recomputeApplication(db, id);
}
