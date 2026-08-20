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
 * Stage 5 (3.6). Every field on a row is worked out from its emails and
 * rewritten whenever that set changes. Nothing is written once and frozen.
 *
 *   Identity comes from the oldest email. State comes from the newest
 *   significant one.
 */

/** The saved model answer for one email, or null when there is not one. */
export function classificationOf(message: EmailMessage): Classification | null {
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
 * to win on date alone (3.6).
 */
const TIE_ORDER: Status[] = ["ACCEPTED", "REJECTED", "IN_PROGRESS", "APPLIED"];

/**
 * The name the employer used most often across this application's emails.
 *
 * One employer writes itself several ways over one hiring process, and the
 * headers genuinely support all of them, so the oldest email is no more
 * authoritative about the name than any other. Counting is: the wording the
 * employer reached for most is the wording to show. Ties go to the earliest,
 * so the answer depends only on the set of emails and never on the order they
 * were processed in.
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
 * "The oldest email wins" is the right rule for a conflict. It is the wrong
 * rule for an absence: an email that says nothing about the role is not
 * disagreeing with one that does. Working per field rather than per email
 * keeps the property that matters, which is that the answer still depends only
 * on the set of emails and never on the order they arrived in.
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
 * A drawer shows one line for each state the application reached, which is the
 * earliest email that stated that state. Every other email is shown under the
 * line for its own state.
 *
 * That is the whole rule. It compares no wording to decide the nesting, has no
 * threshold, no keyword list and nothing to tune, because the pipeline already
 * knows which stage of which application every email is about: the model
 * answers `status` and `stage_detail` on each one, and that answer is trusted
 * enough to drive the whole board's state already.
 *
 * Four things follow from it rather than having to be enforced. It does not
 * depend on the order emails arrived in, so a rebuild reproduces it exactly. A
 * parent is always strictly earlier, so a loop is impossible. A parent is
 * always the first of its state and therefore has no parent of its own, so the
 * tree is one level deep. And nothing is ever left without a home, because
 * every email has a state and every state has an earliest email.
 *
 * The relation is then read off the wording, for display only. A wrong one is a
 * cosmetic bug and never a structural one.
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
 * The two questions stay apart, which is what they always were. Where an email
 * sits in the drawer is the tree above. Whether it records a change of state is
 * this, and it is unchanged: the model sees one email at a time and no thread
 * context (D17), which is what stops company names bleeding between emails, but
 * it also means a resend looks exactly like the original to it. It answers
 * "significant" both times, and it is right both times, because read on its own
 * the email really is significant. Only the whole set can tell.
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
 * Pure, and called from both stages on purpose. Stage 5 asks it what the row
 * should say. Stage 4 asks it what a candidate row is waiting on, and it
 * cannot read the `status` column to find out: that column is written when a
 * row is created and not touched again until stage 5, which runs after the
 * whole matching pass has finished. Half way through a pass the column is
 * therefore hours out of date, and an email arriving now would be measured
 * against the state the row was in when it was made.
 *
 * One definition, used by the stage that decides where an email goes and by
 * the stage that decides what the row says.
 */
export function headState(messages: EmailMessage[]): HeadState {
  const milestones = milestonesIn(messages);

  // An acknowledgement of receipt is a floor, not a stage. Systems send
  // "we have your application" at any point, often after an assessment has
  // already been set, and it says nothing about how far along the application
  // is. So once an application has moved past being merely submitted, a later
  // bare acknowledgement does not move it back. Anything that is an actual
  // outcome still wins on date alone.
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
  // authored, exactly like every other field on a row (PRD 3.6).
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
    // duplicates (3.5). Keeping the row distinct lets the sync finish; the
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
