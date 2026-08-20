/**
 * L2. Run stage 3 again over chosen messages in the scratch database, then L1
 * (LOOP 3.6).
 *
 * This is the only command in the harness that costs money, so three things
 * hold:
 *
 *   - `CLASSIFIER_VERSION` is never touched. To make stage 3 run again the
 *     harness sets `classification_status` back to PENDING on the chosen
 *     messages **in loop/work.db only**. Raising the real constant would throw
 *     away the live cache and charge for a backfill nobody asked for.
 *   - Sampling is deterministic. `--sample N` takes the N messages whose
 *     gmail_message_id hashes lowest, so two runs of the same size read the
 *     same emails and their scores can be compared.
 *   - The budget is enforced, not advertised. There is no default: a paid pass
 *     has to name its price.
 *
 *   npm run loop:reclassify -- --budget 0.20 [--sample 40] [--failed-only]
 */
import { arg, deterministicSample, flag, openWorkDb } from "./common.mts";
import { decryptSecret } from "../../src/lib/crypto.ts";
import { adapterFor, type Provider } from "../../src/lib/llm/index.ts";
import { SYSTEM_PROMPT, buildUserContent } from "../../src/lib/llm/prompt.ts";
import { CLASSIFIER_VERSION } from "../../src/lib/constants.ts";
import { rebuildGrouping } from "../../src/lib/pipeline/rebuild.ts";

const budget = Number(arg("budget"));
if (!Number.isFinite(budget) || budget <= 0) {
  console.error("A paid pass has to name its price:  npm run loop:reclassify -- --budget 0.20");
  process.exit(1);
}

const db = openWorkDb();

const settings = await db.userSettings.findUnique({ where: { id: 1 } });
const apiKey = decryptSecret(settings?.llmApiKeyEncrypted ?? null);
const provider = settings?.llmProvider as Provider | undefined;

if (!apiKey || !provider) {
  console.error("The scratch database carries no provider or API key, so stage 3 cannot run.");
  process.exit(1);
}

const where = flag("failed-only")
  ? { classificationStatus: "FAILED" }
  : { classificationStatus: { in: ["OK", "FAILED"] } };

const all = await db.emailMessage.findMany({
  where,
  select: { id: true, gmailMessageId: true, subject: true, senderName: true, senderEmail: true, receivedAt: true, bodyText: true },
});

const sampleSize = arg("sample") ? Number(arg("sample")) : all.length;
const chosen = deterministicSample(all, (message) => message.gmailMessageId, sampleSize);

console.log(`${chosen.length} of ${all.length} messages chosen, budget $${budget.toFixed(4)}.`);

const adapter = adapterFor(provider);
let spent = 0;
let done = 0;
let skipped = 0;
let failed = 0;

// Serial on purpose. The budget can only be enforced by knowing what the last
// call cost before making the next one.
for (const message of chosen) {
  if (spent >= budget) { skipped += 1; continue; }

  try {
    const result = await adapter.classify(
      apiKey,
      SYSTEM_PROMPT,
      buildUserContent({
        senderName: message.senderName,
        senderEmail: message.senderEmail,
        subject: message.subject,
        receivedAt: message.receivedAt,
        bodyText: message.bodyText,
      }),
    );

    spent += result.usage.costUsd;
    await db.emailMessage.update({
      where: { id: message.id },
      data: {
        classificationStatus: "OK",
        classifierVersion: CLASSIFIER_VERSION,
        llmModel: result.usage.model,
        classificationError: null,
        isApplicationRelated: result.classification.isApplicationRelated,
        isSignificant: result.classification.isSignificant,
        emailTitle: result.classification.emailTitle,
        llmClassificationRaw: result.raw,
      },
    });
    await db.llmUsage.create({
      data: {
        model: result.usage.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        costUsd: result.usage.costUsd,
      },
    });
    done += 1;
  } catch (error) {
    failed += 1;
    const detail = error instanceof Error ? error.message : String(error);
    await db.emailMessage.update({
      where: { id: message.id },
      data: { classificationStatus: "FAILED", classificationError: detail.slice(0, 500) },
    });
  }

  if (done % 10 === 0) console.log(`  ${done} done, $${spent.toFixed(4)} spent`);
}

console.log(`Classified ${done}, failed ${failed}, skipped ${skipped} for want of budget.`);
console.log(`Spent $${spent.toFixed(4)} of $${budget.toFixed(4)}.`);

const rebuilt = await rebuildGrouping(db);
console.log(`Regrouped into ${rebuilt.applications} applications. Run npm run loop:score next.`);

await db.$disconnect();
