/**
 * Write the labelling sheet from the current state (LOOP 3.3).
 *
 * Labelling is bounded work, not a data entry job. The sheet arrives filled in
 * already with what the pipeline currently believes, so it is corrected in
 * place rather than authored: fix a company, delete a row that should not
 * exist, move a message line from one group to another.
 *
 * Once labels exist, the sheet is written from the labels instead, and only
 * the rows the pipeline now disagrees with are called out. Corrections are
 * never overwritten by a later run.
 *
 *   npm run loop:review
 */
import fs from "node:fs";
import {
  REVIEW_SHEET,
  ensureLoopDir,
  deterministicSample,
  openWorkDb,
  readLabels,
  type GroupLabel,
} from "./common.mts";

const RECALL_SAMPLE = 25;

const db = openWorkDb();

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/[|\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function field(value: string | number | null): string {
  return value === null || value === "" ? "-" : String(value);
}

const applications = await db.application.findMany({
  include: {
    messages: {
      orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
      select: {
        gmailMessageId: true,
        subject: true,
        senderDomain: true,
        receivedAt: true,
        isSignificant: true,
      },
    },
  },
});

const messagesById = new Map(
  (
    await db.emailMessage.findMany({
      select: {
        gmailMessageId: true,
        subject: true,
        senderDomain: true,
        senderEmail: true,
        receivedAt: true,
        isSignificant: true,
        isApplicationRelated: true,
        classificationStatus: true,
        classificationError: true,
        applicationId: true,
      },
    })
  ).map((message) => [message.gmailMessageId, message]),
);

const labels = readLabels();
const seeded = labels.applications.groups.length > 0;

/** The group's id is its earliest message, so it never moves as labels grow. */
function groupIdFor(messages: string[]): string {
  return `g:${messages[0]}`;
}

type Block = {
  id: string;
  company: string | null;
  role: string | null;
  season: string | null;
  year: number | null;
  status: string | null;
  messages: string[];
  note: string | null;
};

const blocks: Block[] = [];

if (seeded) {
  // Grow the sheet from disagreements: the labels are the truth, and the only
  // thing worth reading is where the pipeline has since moved away from them.
  const labelled = new Set<string>();

  for (const group of labels.applications.groups) {
    for (const id of group.messages) labelled.add(id);

    const landed = new Set(
      group.messages
        .map((id) => messagesById.get(id)?.applicationId ?? null)
        .filter((value): value is number => value !== null),
    );

    blocks.push({
      ...group,
      note:
        landed.size > 1
          ? `the pipeline now splits this group across ${landed.size} applications`
          : null,
    });
  }

  for (const application of applications) {
    const ids = application.messages.map((message) => message.gmailMessageId);
    if (ids.every((id) => labelled.has(id))) continue;
    blocks.push({
      id: groupIdFor(ids),
      company: application.companyName,
      role: application.roleTitle,
      season: application.season,
      year: application.year,
      status: application.status,
      messages: ids,
      note: "new since the labels were written",
    });
  }
} else {
  for (const application of applications) {
    const ids = application.messages.map((message) => message.gmailMessageId);
    blocks.push({
      id: groupIdFor(ids),
      company: application.companyName,
      role: application.roleTitle,
      season: application.season,
      year: application.year,
      status: application.status,
      messages: ids,
      note: null,
    });
  }
}

blocks.sort((a, b) => (a.company ?? "").localeCompare(b.company ?? "") || a.id.localeCompare(b.id));

const lines: string[] = [];

lines.push("# Labelling sheet");
lines.push("");
lines.push(
  "This is the human surface. `npm run loop:label` reads it back into the two JSON files, so",
);
lines.push("nobody edits message ids by hand. Correct it in place:");
lines.push("");
lines.push("- **A wrong field**: edit the value. `-` means the field is genuinely empty.");
lines.push("- **Two rows that are one application**: move the message lines into one block and");
lines.push("  delete the empty block. A block with no message lines is dropped.");
lines.push("- **One row that is two applications**: cut message lines into a new `### g:<id>` block,");
lines.push("  naming it after its own earliest message id.");
lines.push("- **`sig:`** means *this email records a real new milestone*. A reminder, a resend, or a");
lines.push("  second copy of a notice already seen in this application is `sig:no`, however");
lines.push("  reasonable it looks read on its own.");
lines.push("- **Recall**: in the last two sections, flip `related:no` to `related:yes` for anything");
lines.push("  that really was about an application you submitted. That is the only way recall is");
lines.push("  ever measured (F7).");
lines.push("");
lines.push("A message id may appear in exactly one group. Two is an error, not a merge.");
lines.push("");
lines.push(
  seeded
    ? "Filled in from the labels you have already written. Blocks carrying a `note:` are the ones the pipeline has since moved away from."
    : "Filled in from what the pipeline currently believes. Nothing here is checked yet.",
);
lines.push("");
lines.push("## Applications");
lines.push("");

for (const block of blocks) {
  lines.push(`### ${block.id}`);
  if (block.note) lines.push(`note: ${block.note}`);
  lines.push(`- company: ${field(block.company)}`);
  lines.push(`- role: ${field(block.role)}`);
  lines.push(`- season: ${field(block.season)}`);
  lines.push(`- year: ${field(block.year)}`);
  lines.push(`- status: ${field(block.status)}`);
  for (const id of block.messages) {
    const message = messagesById.get(id);
    const known = labels.messages[id];
    const significant = known ? known.significant : Boolean(message?.isSignificant);
    lines.push(
      `- ${id} | sig:${significant ? "yes" : "no "} | ${message ? message.receivedAt.toISOString().slice(0, 10) : "?"} | ${clean(message?.senderDomain)} | ${clean(message?.subject)}`,
    );
  }
  lines.push("");
}

// Recall is invisible by construction: an application never ingested never
// appears. Sampling what the pipeline threw away is the only way to see it.
const notRelated = await db.emailMessage.findMany({
  where: { isApplicationRelated: false, classificationStatus: "OK" },
  select: { gmailMessageId: true, subject: true, senderEmail: true, receivedAt: true },
});

const sample = deterministicSample(notRelated, (message) => message.gmailMessageId, RECALL_SAMPLE);
sample.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());

lines.push(`## Not related (${sample.length} of ${notRelated.length}, sampled)`);
lines.push("");
lines.push("The pipeline judged every one of these to be nothing to do with an application.");
lines.push("");
for (const message of sample) {
  const known = labels.messages[message.gmailMessageId];
  const related = known ? known.related : false;
  lines.push(
    `- ${message.gmailMessageId} | related:${related ? "yes" : "no "} | ${message.receivedAt.toISOString().slice(0, 10)} | ${clean(message.senderEmail)} | ${clean(message.subject)}`,
  );
}
lines.push("");

const dropped = await db.emailMessage.findMany({
  where: { classificationStatus: "SKIPPED_PREFILTER" },
  select: { gmailMessageId: true, subject: true, senderEmail: true, receivedAt: true, classificationError: true },
  orderBy: { receivedAt: "asc" },
});

lines.push(`## Prefilter drops (${dropped.length})`);
lines.push("");
lines.push("Thrown away before the model ever saw them. A wrong drop here is invisible on the board.");
lines.push("");
for (const message of dropped) {
  const known = labels.messages[message.gmailMessageId];
  const related = known ? known.related : false;
  lines.push(
    `- ${message.gmailMessageId} | related:${related ? "yes" : "no "} | ${message.receivedAt.toISOString().slice(0, 10)} | ${clean(message.classificationError)} | ${clean(message.subject)}`,
  );
}
lines.push("");

const failed = await db.emailMessage.findMany({
  where: { classificationStatus: "FAILED" },
  select: { gmailMessageId: true, subject: true, senderEmail: true, classificationError: true },
});

if (failed.length) {
  lines.push(`## Failed classification (${failed.length}) — not labelled, listed so it is visible`);
  lines.push("");
  for (const message of failed) {
    lines.push(`- ${message.gmailMessageId} | ${clean(message.senderEmail)} | ${clean(message.subject)}`);
    lines.push(`  ${clean(message.classificationError)}`);
  }
  lines.push("");
}

ensureLoopDir();
fs.writeFileSync(REVIEW_SHEET, lines.join("\n"));

console.log(`Wrote ${REVIEW_SHEET}`);
console.log(`  ${blocks.length} application blocks`);
console.log(`  ${sample.length} sampled not related, ${dropped.length} prefilter drops, ${failed.length} failed`);
console.log(seeded ? "  seeded from the existing labels" : "  seeded from the current pipeline output");

await db.$disconnect();
