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
import { LAST_RESULT, LOOP_DIR, openWorkDb, writeJson } from "./common.mts";
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

  const applications = await db.application.findMany({
    include: { messages: { orderBy: [{ receivedAt: "asc" }, { id: "asc" }], select: { id: true } } },
  });

  const busiest = applications
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

const started = Date.now();
const first = await rebuildGrouping(db);
const firstBoard = await projectApplications(db);

// Twice, because "running it again changes nothing" is the property the whole
// harness rests on. If it does not hold, no score below means anything.
const second = await rebuildGrouping(db);
const secondBoard = await projectApplications(db);

const stable = JSON.stringify(firstBoard) === JSON.stringify(secondBoard);

const corrections = await db.applicationCorrection.count();
const resolved = await resolveCorrections(db);
const preserved = corrections ? resolved.size / corrections : 1;

const attachedMessages = await db.emailMessage.count({ where: { applicationId: { not: null } } });
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
for (const note of result.notes) console.log(`  note: ${note}`);
console.log(`Wrote ${LAST_RESULT.replace(LOOP_DIR, "loop")} in ${result.ms} ms.`);

await db.$disconnect();
