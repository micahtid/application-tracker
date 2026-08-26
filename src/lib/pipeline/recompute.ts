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
import { emptyCounters, type PipelineCounters } from "./counters";
import { messagesOf } from "./membership";
import {
  STALE_AFTER_DAYS,
  hasEnded,
  type Outcome,
  type StageDetail,
  type Status,
  termBucket,
} from "@/lib/constants";

/**
 * Stage 5. Every field on a row is worked out from its emails and
 * rewritten whenever that set changes. Nothing is written once and frozen.
 *
 *   Identity comes from the oldest email. State comes from the newest
 *   significant one.
 */

/**
 * Answers already worked out, keyed by the message object they came from.
 *
 * One pass over one application asks for the same message eight or more times,
 * and the answer only depends on `llmClassificationRaw`. A message object is
 * read from the database and never edited afterwards, so a cached answer
 * cannot go stale. The map is weak, so an answer is dropped as soon as the
 * message it belongs to is.
 */
const parsedClassifications = new WeakMap<object, Classification | null>();

/** The saved model answer for one email, or null when there is not one. */
export function classificationOf(message: { llmClassificationRaw: string | null }): Classification | null {
  const cached = parsedClassifications.get(message);
  if (cached !== undefined) return cached;

  let parsed: Classification | null = null;
  if (message.llmClassificationRaw) {
    try {
      parsed = parseClassification(JSON.parse(message.llmClassificationRaw));
    } catch {
      parsed = null;
    }
  }

  parsedClassifications.set(message, parsed);
  return parsed;
}

/**
 * Only used when two status rows carry the exact same timestamp. It never
 * decides between stages, because a rejection arriving after an interview has
 * to win on date alone.
 */
const TIE_ORDER: Status[] = ["ACCEPTED", "REJECTED", "IN_PROGRESS", "APPLIED"];

/**
 * The name the employer used most often across a set of emails.
 *
 * One employer writes itself several ways, so the oldest email is no more
 * authoritative than any other and the commonest wording wins. Ties go to the
 * earliest email and a dead heat to the lower name, so the answer depends only
 * on the set of emails and never on the order they came back in.
 *
 * Two callers give it two sets. `recomputeApplication` gives it one row's
 * emails, which is what a row's `company_name` is. `displayCompanyNames` gives
 * it every email at one employer, which is the one name the board draws that
 * employer under. One rule, two scopes.
 */
export function commonestCompanyName(
  messages: { receivedAt: Date; llmClassificationRaw: string | null }[],
): string | null {
  const counts = new Map<string, { count: number; first: number }>();

  for (const message of messages) {
    const name = classificationOf(message)?.companyName;
    if (!name) continue;
    const at = message.receivedAt.getTime();
    const seen = counts.get(name);
    if (seen) {
      seen.count += 1;
      seen.first = Math.min(seen.first, at);
    } else {
      counts.set(name, { count: 1, first: at });
    }
  }

  let best: string | null = null;
  let bestCount = 0;
  let bestFirst = Number.POSITIVE_INFINITY;

  for (const [name, seen] of counts) {
    const better =
      seen.count > bestCount ||
      (seen.count === bestCount && seen.first < bestFirst) ||
      (seen.count === bestCount && seen.first === bestFirst && name < (best ?? ""));
    if (better) {
      best = name;
      bestCount = seen.count;
      bestFirst = seen.first;
    }
  }

  return best;
}

/**
 * The value from the oldest email that states this field, rather than the
 * value on the oldest email full stop.
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
 * Where every email of an application sits in its drawer.
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

export type HeadState = {
  status: Status;
  stageDetail: StageDetail | null;
  /**
   * Which ending the application reached, read off the same newest significant
   * email the status comes from. Present only on a status that is an ending,
   * exactly as `stageDetail` is present only on one that is not, so the two
   * can never both be claiming the row at once.
   */
  outcome: Outcome | null;
};

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

  if (!meaningful.length) return { status: "APPLIED", stageDetail: null, outcome: null };

  const latest = Math.max(...meaningful.map((row) => row.message.receivedAt.getTime()));
  const newest = meaningful
    .filter((row) => row.message.receivedAt.getTime() === latest)
    .sort((a, b) => TIE_ORDER.indexOf(a.status) - TIE_ORDER.indexOf(b.status))[0];

  const status = newest.status;
  const said = classificationOf(newest.message);
  const ended = hasEnded(status);
  return {
    status,
    stageDetail: status === "IN_PROGRESS" ? (said?.stageDetail as StageDetail | null) ?? null : null,
    outcome: ended ? said?.outcome ?? null : null,
  };
}

/**
 * Whether a row has gone quiet.
 *
 * Every board of this kind fills with rows acknowledged once and never
 * mentioned again. They read APPLIED for ever, sort into the middle of the
 * list, and crowd out the handful that are live.
 *
 * **Silence is not something an email says**, so this is never asked of the
 * model: no model reading one email can tell you that nothing followed it. It
 * is a fact about the set, worked out here beside `headState`. It is also not
 * stored, because it changes with the date rather than with the mail, and a
 * stored value would be out of date the day after it was written.
 *
 * An application that has ended is never stale. It is finished, which is a
 * different thing from being ignored.
 */
export function isStale(
  state: { status: string; latestEmailAt: Date | null },
  now: Date,
): boolean {
  if (hasEnded(state.status)) return false;
  if (!state.latestEmailAt) return false;
  return (now.getTime() - state.latestEmailAt.getTime()) / 86_400_000 > STALE_AFTER_DAYS;
}

export async function recomputeApplication(
  db: Db,
  applicationId: number,
  counters: PipelineCounters = emptyCounters(),
): Promise<void> {
  const application = await db.application.findUnique({ where: { id: applicationId } });
  if (!application) return;

  const messages = await messagesOf(db, applicationId);

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

  // Written on the membership rather than on the message, because where an
  // email sits in a drawer is a fact about the pairing: the same email in two
  // applications sits under a different line in each.
  //
  // Only the rows that actually moved are written, and they go in one round
  // trip rather than one each.
  const moved = messages
    .map((message) => ({ message, node: tree.get(message.id) ?? { parent: null, relation: null } }))
    .filter(
      ({ message, node }) =>
        message.parentMessageId !== node.parent || message.parentRelation !== node.relation,
    );

  if (moved.length) {
    await db.$transaction(
      moved.map(({ message, node }) =>
        db.applicationMembership.update({
          where: { applicationId_messageId: { applicationId, messageId: message.id } },
          data: { parentMessageId: node.parent, parentRelation: node.relation },
        }),
      ),
    );
  }

  // History is rewritten from the whole set rather than added to as emails
  // arrive, so the first occurrence always survives whatever order they came
  // in, and a message that stops being a repeat gets its milestone back.
  //
  // The delete and the write go in one transaction, so a crash cannot leave an
  // application with the old history gone and no new history in its place.
  const history = milestonesIn(messages).map((milestone) => ({
    applicationId,
    messageId: milestone.message.id,
    status: milestone.status,
    detectedAt: milestone.message.receivedAt,
  }));

  await db.$transaction([
    db.applicationStatusHistory.deleteMany({ where: { applicationId } }),
    db.applicationStatusHistory.createMany({ data: history }),
  ]);

  const { status, stageDetail, outcome } = headState(messages);

  const term = firstStated(messages, (said) => said.term);

  const atsVendor =
    messages.map((message) => vendorForDomain(message.senderDomain)).find(Boolean) ?? null;

  const data = {
    companyName,
    companyNormalized,
    companyDomain: firstStated(messages, (said) => said.companyDomain),
    roleTitle: firstStated(messages, (said) => said.roleTitle),
    // The words an email used, kept as it used them, and the bucket derived
    // from them. The bucket is display only; matching and the identity key
    // both read the term.
    term,
    season: termBucket(term),
    year: firstStated(messages, (said) => said.year),
    status,
    stageDetail,
    outcome,
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
    term: data.term,
    year: data.year,
    requisitions,
  });

  try {
    await db.application.update({ where: { id: applicationId }, data: { ...data, dedupeKey: key } });
  } catch {
    // The unique rule on dedupe_key is an alarm, not the thing that prevents
    // duplicates. Keeping the row distinct lets the sync finish, and the count
    // is what makes the collision visible. Without it this catch would hide
    // the very bug the rule exists to report.
    counters.dedupeCollisions += 1;
    await db.application.update({
      where: { id: applicationId },
      data: { ...data, dedupeKey: `${key}#${applicationId}` },
    });
  }
}

/** Recalculates several applications, skipping ids that appear twice. */
export async function recomputeAll(
  db: Db,
  ids: Iterable<number>,
): Promise<PipelineCounters> {
  const counters = emptyCounters();
  for (const id of new Set(ids)) await recomputeApplication(db, id, counters);
  return counters;
}
