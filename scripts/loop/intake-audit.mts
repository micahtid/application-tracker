/**
 * What the search never asked for.
 *
 * > Recall is measured against the mailbox, not against the subset the search
 * > returned.
 *
 * Every quality metric in this project is computed over messages that were
 * fetched. The sweep is forty English phrases and thirty vendor domains, so a
 * mailbox in another language, at employers running their own careers systems,
 * returns nothing at all and the board is empty with every metric reading 1.000
 * because there is nothing in it to be wrong about. `recall.related` counts mail
 * the model wrongly threw away; it has never counted mail the search never
 * asked for, because that mail is not in the database to be counted.
 *
 * This is the only way to see it. Take the same window the sweep takes, list
 * everything in it, subtract what the sweep returned, sample what is left, and
 * ask the model whether any of it was application mail.
 *
 * Nothing is written to the scratch database. These messages are read, judged
 * and thrown away, because storing them would put mail on the board that the
 * pipeline never chose and every grouping metric would move for a reason that
 * has nothing to do with grouping.
 *
 *   npm run loop:intake-audit -- --budget 0.10 [--sample 40] [--skip 40]
 */
import type { gmail_v1 } from "googleapis";
import {
  INTAKE_AUDIT,
  arg,
  deterministicSample,
  openWorkDb,
  readJson,
  writeJson,
} from "./common.mts";
import { authorizedClient, gmailFor } from "@/lib/gmail/client";
import { buildQueries } from "@/lib/gmail/query";
import { extractBody, headerValue, parseSender } from "@/lib/gmail/body";
import { prefilter } from "@/lib/prefilter";
import { decryptSecret } from "@/lib/crypto";
import { adapterFor } from "@/lib/llm";
import type { Provider } from "@/lib/constants";
import { SYSTEM_PROMPT, buildUserContent } from "@/lib/llm/prompt";
import { MAX_MONTHS_BACK } from "@/lib/constants";

const budget = Number(arg("budget"));
if (!Number.isFinite(budget) || budget <= 0) {
  console.error("A paid pass has to name its price:  npm run loop:intake-audit -- --budget 0.10");
  process.exit(1);
}
const sampleSize = Number(arg("sample") ?? 40);
/**
 * How many of the deterministic sample to step over before reading.
 *
 * The sample is the ids that hash lowest, so two runs of the same size read
 * the same messages. That is what makes a reading reproducible and it is also
 * what stops a second run adding anything. Skipping the first N reads a
 * different, equally deterministic slice, so two runs can be added together
 * to tighten a bound rather than paying twice for the same answer.
 */
const skip = Number(arg("skip") ?? 0);

const db = openWorkDb();

const account = await db.gmailAccount.findFirst({ where: { isActive: true } });
const settings = await db.userSettings.findUnique({ where: { id: 1 } });
const apiKey = decryptSecret(settings?.llmApiKeyEncrypted ?? null);
const provider = settings?.llmProvider as Provider | undefined;

if (!account) {
  console.error("The scratch database carries no connected Gmail account.");
  process.exit(1);
}
if (!apiKey || !provider) {
  console.error("The scratch database carries no provider or API key, so nothing can be judged.");
  process.exit(1);
}

/** The same window the sweep uses, so the two sets are comparable. */
const floor = new Date();
floor.setMonth(floor.getMonth() - MAX_MONTHS_BACK);
const startDate =
  settings?.readFromDate && settings.readFromDate > floor ? settings.readFromDate : floor;

const gmail = gmailFor(await authorizedClient(account));

async function listIds(query: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const response: gmail_v1.Schema$ListMessagesResponse = (
      await gmail.users.messages.list({
        userId: "me",
        q: query,
        maxResults: 500,
        includeSpamTrash: true,
        pageToken,
      })
    ).data;
    for (const message of response.messages ?? []) if (message.id) ids.push(message.id);
    pageToken = response.nextPageToken ?? undefined;
  } while (pageToken);
  return ids;
}

function gmailDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("/");
}

// What the sweep asks for, and what is actually there.
const swept = new Set<string>();
for (const query of buildQueries(startDate)) {
  for (const id of await listIds(query)) swept.add(id);
}

const everything = await listIds(`in:anywhere -in:spam after:${gmailDate(startDate)}`);
const missed = everything.filter((id) => !swept.has(id));

console.log(`${everything.length} messages in the window, ${swept.size} returned by the sweep.`);
console.log(`${missed.length} the sweep never asked for. Sampling ${Math.min(sampleSize, missed.length)}.`);

const chosen = deterministicSample(missed, (id) => id, sampleSize + skip).slice(skip);

const adapter = adapterFor(provider);
let spent = 0;
let judged = 0;
let related = 0;
let skipped = 0;
const found: { id: string; sender: string; subject: string; company: string | null }[] = [];

for (const id of chosen) {
  if (spent >= budget) { skipped += 1; continue; }

  const message = (await gmail.users.messages.get({ userId: "me", id, format: "full" })).data;
  const payload = message.payload ?? undefined;
  const sender = parseSender(headerValue(payload, "From"));
  const subject = headerValue(payload, "Subject");

  // The prefilter is part of the intake, so a message it would have thrown
  // away counts as one the intake never asked for rather than one the model
  // rejected.
  const verdict = prefilter({ senderEmail: sender.email, senderDomain: sender.domain, subject });
  if (!verdict.keep) { judged += 1; continue; }

  try {
    const result = await adapter.classify(
      apiKey,
      SYSTEM_PROMPT,
      buildUserContent({
        senderName: sender.name,
        senderEmail: sender.email,
        subject,
        receivedAt: new Date(Number(message.internalDate ?? Date.now())),
        bodyText: extractBody(payload),
      }),
    );
    spent += result.usage.costUsd;
    judged += 1;
    if (result.classification.isApplicationRelated) {
      related += 1;
      found.push({
        id,
        sender: sender.email ?? "",
        subject: subject ?? "",
        company: result.classification.companyName,
      });
    }
  } catch (error) {
    console.error(`  ${id} could not be read: ${error instanceof Error ? error.message : error}`);
  }
}



// Added to whatever an earlier slice found, so the reading is over everything
// that has ever been sampled rather than over the last run alone.
const previous = readJson<{ sampled?: number; related?: number; costUsd?: number } | null>(
  INTAKE_AUDIT,
  null,
);
const totalSampled = (skip ? previous?.sampled ?? 0 : 0) + judged;
const totalRelated = (skip ? previous?.related ?? 0 : 0) + related;

writeJson(INTAKE_AUDIT, {
  at: new Date().toISOString(),
  window: startDate.toISOString().slice(0, 10),
  inWindow: everything.length,
  sweptBySearch: swept.size,
  neverAskedFor: missed.length,
  sampled: totalSampled,
  related: totalRelated,
  recall: totalSampled ? totalRelated / totalSampled : 0,
  costUsd: spent,
  found,
});

const recall = totalSampled ? totalRelated / totalSampled : 0;
console.log(`Judged ${judged}, of which ${related} were application mail.`);
console.log(`  over ${totalSampled} sampled in all, ${totalRelated} were application mail.`);
console.log(`  intake.audit_recall   ${recall.toFixed(3)}`);
if (skipped) console.log(`  ${skipped} were skipped for want of budget, so this reading is partial.`);
for (const row of found) console.log(`  missed: ${row.sender} | ${row.company ?? "?"} | ${row.subject}`);
// The audit writes no messages to the scratch database, but it does spend
// real money, and `cost.pass_usd` is the only number that can say what this
// loop cost. A spend nobody can see is the same problem as a guess nobody
// counts.
if (spent > 0) {
  await db.llmUsage.create({
    data: { model: "intake-audit", inputTokens: 0, outputTokens: 0, costUsd: spent },
  });
}

console.log(`Spent ${spent.toFixed(4)} of ${budget.toFixed(4)}.`);

await db.$disconnect();
