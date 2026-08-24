/**
 * L1. Wipe what was derived, then group and recompute the whole message set
 * again, oldest first (LOOP 3, step 2).
 *
 * Free and about two seconds, because it reads the emails and the cached model
 * answers already on disk and never calls Gmail or a model. Every iteration
 * starts from nothing, so a score always describes the rules as they stand
 * rather than the order they were introduced in.
 *
 *   npm run loop:replay
 */
import fs from "node:fs";
import {
  LAST_RESULT,
  LOOP_DIR,
  SNAPSHOT_STATE,
  arg,
  openWorkDb,
  readJson,
  writeJson,
  type SnapshotState,
} from "./common.mts";
import { decryptSecret } from "../../src/lib/crypto.ts";
import type { Provider } from "../../src/lib/constants.ts";
import { adjudicatorFor } from "../../src/lib/pipeline/adjudicator.ts";
import { messagesOf } from "../../src/lib/pipeline/membership.ts";
import type { Adjudicator } from "../../src/lib/pipeline/match.ts";
import { projectApplications } from "./projection.mts";
import { rebuildGrouping } from "../../src/lib/pipeline/rebuild.ts";
import { resolveCorrections } from "../../src/lib/pipeline/corrections.ts";

const db = openWorkDb();

/**
 * `corrections.preserved` needs corrections to preserve. The live mailbox may
 * carry none, so the harness plants two against the rows with the most emails
 * and then checks they find their way home. They are planted once and left
 * alone afterwards, so every later iteration measures the same two.
 */
async function plantProbeCorrections(): Promise<number> {
  const existing = await db.applicationCorrection.count();
  if (existing) return existing;

  const applications = await db.application.findMany({ select: { id: true, companyNormalized: true, roleTitle: true } });

  const withMessages = [];
  for (const application of applications) {
    withMessages.push({ ...application, messages: await messagesOf(db, application.id) });
  }

  const busiest = withMessages
    .filter((application) => application.messages.length > 1)
    .sort(
      (a, b) => b.messages.length - a.messages.length || a.companyNormalized.localeCompare(b.companyNormalized),
    )
    .slice(0, 2);

  for (const [index, application] of busiest.entries()) {
    await db.applicationCorrection.create({
      data: {
        anchorMessageId: application.messages[0].id,
        isHidden: index === 0,
        statusOverride: index === 1 ? "ACCEPTED" : null,
        companySnapshot: application.companyNormalized,
        roleSnapshot: application.roleTitle,
      },
    });
  }

  return busiest.length;
}

const planted = await plantProbeCorrections();

/**
 * The replay is free, and stays free unless it is asked to pay.
 *
 * `--adjudicate <cap>` is the only way a rebuild ever calls a model, and it
 * exists so LOOP4 iteration 9 can be measured rather than assumed. Without it
 * every iteration reads answers already on disk and `cost.pass_usd` reads 0,
 * which is what makes "this iteration was free" checkable rather than claimed.
 */
const adjudicateCap = arg("adjudicate") ? Number(arg("adjudicate")) : 0;
let adjudicator: Adjudicator | undefined;

if (adjudicateCap > 0) {
  const settings = await db.userSettings.findUnique({ where: { id: 1 } });
  const apiKey = decryptSecret(settings?.llmApiKeyEncrypted ?? null);
  const provider = settings?.llmProvider as Provider | undefined;
  if (!apiKey || !provider) {
    console.error("The scratch database carries no provider or API key, so nothing can be asked.");
    process.exit(1);
  }
  // A paid pass moves the marker before it buys anything, so cost.pass_usd is
  // the price of this pass rather than of every pass since the snapshot.
  const ledger = (await db.llmUsage.aggregate({ _sum: { costUsd: true } }))._sum.costUsd ?? 0;
  const state = readJson<SnapshotState | null>(SNAPSHOT_STATE, null);
  writeJson(SNAPSHOT_STATE, { at: state?.at ?? new Date().toISOString(), costUsdBefore: ledger });
  adjudicator = adjudicatorFor(db, provider, apiKey, adjudicateCap);
  console.log(`Adjudication is on, capped at ${adjudicateCap.toFixed(4)}.`);
}

const started = Date.now();
const first = await rebuildGrouping(db, adjudicator);
const firstBoard = await projectApplications(db);

// Twice, because "running it again changes nothing" is the property the whole
// harness rests on. If it does not hold, no score below means anything.
const second = await rebuildGrouping(db);
const secondBoard = await projectApplications(db);

const stable = JSON.stringify(firstBoard) === JSON.stringify(secondBoard);

if (first.counters.adjudicateCalls) {
  await db.llmUsage.create({
    data: {
      model: "adjudicator",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: first.counters.adjudicateCostUsd,
    },
  });
}

const corrections = await db.applicationCorrection.count();
const resolved = await resolveCorrections(db);
const preserved = corrections ? resolved.size / corrections : 1;

// Distinct messages rather than memberships: from LOOP4 iteration 5 one
// email may be held by two applications, and counting the links would report
// more attached mail than the mailbox contains.
const attachedMessages = await db.emailMessage.count({ where: { memberships: { some: {} } } });
const relatedMessages = await db.emailMessage.count({ where: { isApplicationRelated: true } });

const result = {
  at: new Date().toISOString(),
  ms: Date.now() - started,
  stable,
  correctionsPlanted: planted,
  correctionsPreserved: preserved,
  applicationsCreated: first.created,
  attachedMessages,
  relatedMessages,
  notes: [...new Set([...first.notes, ...second.notes])],
  // From the first rebuild alone. The second exists only to prove that running
  // it again changes nothing, and adding its tally to the first would report
  // every guess twice (LOOP4 Decision 8).
  counters: first.counters,
  repairs: first.repairs,
  applications: firstBoard,
};

// The previous result is kept beside the new one so loop:diff can say what
// changed, row by row.
if (fs.existsSync(LAST_RESULT)) {
  fs.copyFileSync(LAST_RESULT, LAST_RESULT.replace(/\.json$/, ".previous.json"));
}
writeJson(LAST_RESULT, result);

console.log(`Rebuilt ${firstBoard.length} applications from ${attachedMessages} attached messages.`);
console.log(`  ${relatedMessages} messages are application related.`);
console.log(`  rebuild.stable          ${stable ? "1.0" : "0.0"}`);
console.log(`  corrections.preserved   ${preserved.toFixed(3)}  (${resolved.size} of ${corrections})`);
console.log(
  `  links by reason         ${Object.entries(first.counters.linksByReason).filter(([, n]) => n).map(([reason, n]) => `${reason} ${n}`).join(", ")}`,
);
console.log(
  `  guesses                 ${first.counters.scoreTies} score ties, ${first.counters.aliasesGuessed} of ${first.counters.aliasesWritten} aliases unwitnessed, ${first.counters.dedupeCollisions} key collisions`,
);
for (const note of result.notes) console.log(`  note: ${note}`);
console.log(`Wrote ${LAST_RESULT.replace(LOOP_DIR, "loop")} in ${result.ms} ms.`);

await db.$disconnect();
