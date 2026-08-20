/**
 * Which labelled groups share a Gmail thread. A labelling aid: Gmail threads
 * by subject and participants, so two applications that were acknowledged with
 * the same wording arrive in one thread.
 *
 *   npx tsx scripts/loop/threads.mts
 */
import { openWorkDb, readLabels } from "./common.mts";

const db = openWorkDb();
const { applications } = readLabels();

const groupOf = new Map<string, string>();
const nameOf = new Map<string, string>();
for (const group of applications.groups) {
  nameOf.set(group.id, `${group.company} · ${(group.role ?? "-").slice(0, 40)}`);
  for (const id of group.messages) groupOf.set(id, group.id);
}

const messages = await db.emailMessage.findMany({
  select: { gmailMessageId: true, threadId: true, subject: true },
});

const byThread = new Map<string, string[]>();
for (const message of messages) {
  if (!message.threadId) continue;
  const group = groupOf.get(message.gmailMessageId);
  if (!group) continue;
  if (!byThread.has(message.threadId)) byThread.set(message.threadId, []);
  byThread.get(message.threadId)!.push(group);
}

let crossing = 0;
for (const [thread, groups] of byThread) {
  const distinct = [...new Set(groups)];
  if (distinct.length < 2) continue;
  crossing += 1;
  console.log(`thread ${thread} carries ${distinct.length} labelled applications:`);
  for (const group of distinct) console.log(`   ${nameOf.get(group)}`);
}

console.log(`\n${crossing} of ${byThread.size} threads carry more than one application.`);

await db.$disconnect();
