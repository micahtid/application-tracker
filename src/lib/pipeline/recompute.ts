import type { EmailMessage } from "@prisma/client";
import type { Db } from "@/lib/db";
import { parseClassification, type Classification } from "@/lib/llm";
import { dedupeKey, normalizeCompany, normalizeSubject, requisitionNumbers } from "@/lib/normalize";
import { vendorForDomain } from "@/lib/ats";
import type { Status } from "@/lib/constants";

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

  // Which emails are repeats of an earlier one, and therefore which of them
  // record a milestone. This is the first point in the pipeline where the
  // other emails of an application are visible: the model sees one email at a
  // time and no thread context (D17), which is what stops company names
  // bleeding between emails, but it also means a resend looks exactly like the
  // original to it. It answers "significant" both times, and it is right both
  // times, because read on its own the email really is significant.
  const firstSaid = new Map<string, number>();
  const repeats = new Map<number, number | null>();

  for (const message of messages) {
    const said = classificationOf(message);
    if (!said?.isSignificant) {
      repeats.set(message.id, null);
      continue;
    }

    // The state has to match as well as the wording. Two rounds that happen to
    // share a subject are two rounds, and they will differ in status or stage.
    const key = [said.status, said.stageDetail ?? "", normalizeSubject(message.subject)].join("|");
    const earlier = firstSaid.get(key);

    repeats.set(message.id, earlier ?? null);
    if (earlier === undefined) firstSaid.set(key, message.id);
  }

  for (const message of messages) {
    const repeatOf = repeats.get(message.id) ?? null;
    if (message.repeatOfMessageId !== repeatOf) {
      await db.emailMessage.update({ where: { id: message.id }, data: { repeatOfMessageId: repeatOf } });
    }
  }

  // History is rewritten from the whole set rather than added to as emails
  // arrive, so the first occurrence always survives whatever order they came
  // in, and a message that stops being a repeat gets its milestone back.
  await db.applicationStatusHistory.deleteMany({ where: { applicationId } });
  for (const message of messages) {
    const said = classificationOf(message);
    if (!said?.isSignificant || repeats.get(message.id)) continue;
    await db.applicationStatusHistory.create({
      data: { applicationId, messageId: message.id, status: said.status, detectedAt: message.receivedAt },
    });
  }

  const history = await db.applicationStatusHistory.findMany({
    where: { applicationId },
    orderBy: [{ detectedAt: "desc" }],
    include: { message: true },
  });

  // An acknowledgement of receipt is a floor, not a stage. Systems send
  // "we have your application" at any point, often after an assessment has
  // already been set, and it says nothing about how far along the application
  // is. So once an application has moved past being merely submitted, a later
  // bare acknowledgement does not move it back. Anything that is an actual
  // outcome still wins on date alone.
  const oldestFirst = [...history].reverse();
  const movedOn = oldestFirst.findIndex((row) => row.status !== "APPLIED");
  const meaningful =
    movedOn === -1
      ? history
      : history.filter(
          (row) =>
            row.status !== "APPLIED" ||
            row.detectedAt.getTime() < oldestFirst[movedOn].detectedAt.getTime(),
        );

  const newest = meaningful.length
    ? meaningful
        .filter((row) => row.detectedAt.getTime() === meaningful[0].detectedAt.getTime())
        .sort(
          (a, b) =>
            TIE_ORDER.indexOf(a.status as Status) - TIE_ORDER.indexOf(b.status as Status),
        )[0]
    : null;

  const status = (newest?.status as Status) ?? "APPLIED";
  const stageDetail =
    status === "IN_PROGRESS" && newest ? classificationOf(newest.message)?.stageDetail ?? null : null;

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
