import type { EmailMessage } from "@prisma/client";
import type { Db } from "@/lib/db";
import type { LinkReason } from "./counters";

/**
 * The only two ways anything reads which emails belong to which applications
 * (LOOP4 Decision 1).
 *
 * `application_id` used to sit on the message and every read was a
 * `findMany({ where: { applicationId } })` scattered across five files. Adding
 * a membership table beside that column would have left every one of those
 * reads seeing one application's worth of a fanned out email and nothing
 * anywhere would have said so. Dropping the column turned each of them into a
 * compile error, and they all come back through here.
 */

/**
 * One email as it appears inside one application.
 *
 * The message's own fields, plus the two that belong to the pairing rather
 * than to the email. An email in two applications yields two of these, with
 * the same `id` and different parents, which is exactly the fact the old shape
 * could not hold.
 */
export type MessageInApplication = EmailMessage & {
  parentMessageId: number | null;
  parentRelation: string | null;
};

/** Every email of an application, oldest first, as every call site wants. */
export async function messagesOf(db: Db, applicationId: number): Promise<MessageInApplication[]> {
  const memberships = await db.applicationMembership.findMany({
    where: { applicationId },
    include: { message: true },
  });

  return memberships
    .map((membership) => ({
      ...membership.message,
      parentMessageId: membership.parentMessageId,
      parentRelation: membership.parentRelation,
    }))
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || a.id - b.id);
}

/**
 * The other direction, which is new: every application an email belongs to.
 *
 * Nought, one, or more than one. Nought is an email nothing has claimed, one is
 * every ordinary email, and more than one is what Decision 2 creates.
 */
export async function applicationsOf(db: Db, messageId: number): Promise<number[]> {
  const memberships = await db.applicationMembership.findMany({
    where: { messageId },
    select: { applicationId: true },
    orderBy: { applicationId: "asc" },
  });
  return memberships.map((membership) => membership.applicationId);
}

/** Whether any email of this application shares the thread, and which row. */
export async function applicationForThread(db: Db, threadId: string): Promise<number | null> {
  const membership = await db.applicationMembership.findFirst({
    where: { message: { threadId } },
    orderBy: [{ message: { receivedAt: "asc" } }, { id: "asc" }],
    select: { applicationId: true },
  });
  return membership?.applicationId ?? null;
}

/**
 * Records that an email belongs to an application, with what made the link.
 *
 * Idempotent on the pair, so a rerun over an already grouped mailbox changes
 * nothing. The reason is only written when the link is created: a link that
 * already exists was made by whatever made it, and overwriting that with a
 * weaker reason would launder a guess into evidence.
 */
export async function link(
  db: Db,
  applicationId: number,
  messageId: number,
  reason: LinkReason,
): Promise<void> {
  await db.applicationMembership.upsert({
    where: { applicationId_messageId: { applicationId, messageId } },
    create: { applicationId, messageId, reason },
    update: {},
  });
}

/** Messages carrying no membership at all: application mail nothing has claimed. */
export async function unclaimedMessages(db: Db, where: object = {}): Promise<EmailMessage[]> {
  return db.emailMessage.findMany({
    where: { ...where, memberships: { none: {} } },
    orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
  });
}
