/**
 * Print the stored text of chosen emails. A labelling aid, nothing more: the
 * sheet shows subjects, and a subject is often not enough to tell a resend
 * from a second application.
 *
 *   npx tsx scripts/loop/show.mts <gmail_message_id> ...
 *   npx tsx scripts/loop/show.mts --like "notion"
 */
import { arg, openWorkDb } from "./common.mts";

const db = openWorkDb();
const like = arg("like");
const ids = process.argv.slice(2).filter((value) => /^[0-9a-f]{6,32}$/.test(value));
const chars = Number(arg("chars") ?? 700);

const messages = await db.emailMessage.findMany({
  where: like
    ? { OR: [{ subject: { contains: like } }, { senderEmail: { contains: like } }] }
    : { gmailMessageId: { in: ids } },
  orderBy: [{ receivedAt: "asc" }],
  select: {
    gmailMessageId: true,
    receivedAt: true,
    senderEmail: true,
    subject: true,
    bodyText: true,
    memberships: { select: { applicationId: true } },
    llmClassificationRaw: true,
  },
});

for (const message of messages) {
  console.log("=".repeat(78));
  console.log(`${message.gmailMessageId}  ${message.receivedAt.toISOString()}  app=${message.memberships.map((m) => m.applicationId).join(",") || "none"}`);
  console.log(`${message.senderEmail}`);
  console.log(`${message.subject}`);
  const raw = message.llmClassificationRaw ? JSON.parse(message.llmClassificationRaw) : null;
  if (raw) {
    console.log(
      `model: company=${raw.company_name} role=${raw.role_title} status=${raw.status} sig=${raw.is_significant}`,
    );
  }
  console.log("-".repeat(78));
  console.log((message.bodyText ?? "").replace(/\s+/g, " ").slice(0, chars));
  console.log("");
}

await db.$disconnect();
