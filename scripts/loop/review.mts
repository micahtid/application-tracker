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
  LABEL_EVENTS,
  LABEL_OUTCOMES,
  LABEL_STAGES,
  type GroupLabel,
} from "./common.mts";
import { classificationOf } from "../../src/lib/pipeline/recompute.ts";

const RECALL_SAMPLE = 25;

const db = openWorkDb();

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/[|\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function field(value: string | number | null): string {
  return value === null || value === "" ? "-" : String(value);
}

const applications = (
  await db.application.findMany({
    include: {
      memberships: {
        select: {
          message: {
            select: {
              gmailMessageId: true,
              subject: true,
              senderDomain: true,
              receivedAt: true,
              isSignificant: true,
            },
          },
        },
      },
    },
  })
).map((application) => ({
  ...application,
  messages: application.memberships
    .map((membership) => membership.message)
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime()),
}));

const messagesById = new Map(
  (
    await db.emailMessage.findMany({
      select: {
        id: true,
        gmailMessageId: true,
        subject: true,
        senderDomain: true,
        senderEmail: true,
        receivedAt: true,
        isSignificant: true,
        isApplicationRelated: true,
        classificationStatus: true,
        classificationError: true,
        memberships: { select: { applicationId: true, parentMessageId: true } },
        llmClassificationRaw: true,
      },
    })
  ).map((message) => [message.gmailMessageId, message]),
);

/** The stage the pipeline currently reads on an email, offered as a starting point. */
function stageOf(id: string): string | null {
  const message = messagesById.get(id);
  if (!message) return null;
  return classificationOf(message)?.stageDetail ?? null;
}

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
  const groupOfLabelled = new Map<string, string>();

  for (const group of labels.applications.groups) {
    for (const id of group.messages) {
      labelled.add(id);
      groupOfLabelled.set(id, group.id);
    }

    const landed = new Set(
      group.messages
        .flatMap((id) => messagesById.get(id)?.memberships.map((m) => m.applicationId) ?? []),
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
    // A message already judged not related keeps that answer wherever the
    // pipeline has since put it. Listing it inside an application block would
    // ask the opposite question, and reading the sheet back would silently
    // flip the label to "related" because that is what the section means.
    const ids = application.messages
      .map((message) => message.gmailMessageId)
      .filter((id) => labels.messages[id]?.related !== false);

    // Only the ones nobody has answered yet. Listing the whole row would
    // repeat lines that already sit in a labelled block, and a repeated line
    // now says something: that the email covers two applications (LOOP4 5.1).
    // The block it belongs beside is named instead, so it can be moved there.
    const fresh = ids.filter((id) => !labelled.has(id));
    if (!fresh.length) continue;

    const beside = [...new Set(ids.filter((id) => labelled.has(id)).map((id) => groupOfLabelled.get(id)))];
    blocks.push({
      id: groupIdFor(fresh),
      company: application.companyName,
      role: application.roleTitle,
      season: application.season,
      year: application.year,
      status: application.status,
      messages: fresh,
      note: beside.length
        ? `new since the labels were written. The rest of this row is already labelled in ${beside.join(", ")}, so these lines probably belong there`
        : "new since the labels were written",
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

/**
 * The group's messages in reading order: every line that holds a line of its
 * own, oldest first, each followed by the lines shown under it.
 *
 * A label wins over the pipeline wherever one exists, because the labels are
 * the truth and the sheet is how they are corrected. Where none exists the
 * pipeline's answer is offered as a starting point, exactly as `sig:` is.
 */
function treeOf(ids: string[]): [string, string | null][] {
  const byGmailId = new Map(ids.map((id) => [id, messagesById.get(id)]));
  const rowIdToGmailId = new Map<number, string>();
  for (const [id, message] of byGmailId) if (message) rowIdToGmailId.set(message.id, id);

  const parentOf = new Map<string, string | null>();
  for (const id of ids) {
    const known = labels.messages[id];
    if (known && known.parent !== undefined) {
      parentOf.set(id, known.parent && byGmailId.has(known.parent) ? known.parent : null);
      continue;
    }
    // The first membership's parent. A message in two applications sits
    // under a different line in each, and the sheet shows it once per block,
    // so the block being written is the one whose parent belongs here.
    const parent = byGmailId.get(id)?.memberships[0]?.parentMessageId ?? null;
    parentOf.set(id, parent === null ? null : rowIdToGmailId.get(parent) ?? null);
  }

  // One level deep, always. A parent that is itself shown under something else
  // would make the sheet unreadable, so the grandchild is lifted to its
  // grandparent rather than dropped.
  for (const id of ids) {
    const parent = parentOf.get(id);
    if (parent && parentOf.get(parent)) parentOf.set(id, parentOf.get(parent)!);
  }

  const at = (id: string) => byGmailId.get(id)?.receivedAt.getTime() ?? 0;
  const order = (a: string, b: string) => at(a) - at(b) || a.localeCompare(b);

  const out: [string, string | null][] = [];
  for (const id of [...ids].filter((id) => !parentOf.get(id)).sort(order)) {
    out.push([id, null]);
    for (const child of ids.filter((other) => parentOf.get(other) === id).sort(order)) {
      out.push([child, id]);
    }
  }
  // A child whose parent is not in this group at all still has to be shown.
  for (const id of ids) if (!out.some(([shown]) => shown === id)) out.push([id, null]);
  return out;
}

/**
 * Application mail that reached no row at all.
 *
 * It appears in no application block, because there is no application, and in
 * no recall section, because the model did call it application mail. So
 * without this it appears nowhere and cannot be labelled, which makes the one
 * failure it represents invisible to every metric: an email the pipeline
 * agreed was about an application and then lost.
 */
const orphans = await db.emailMessage.findMany({
  where: { isApplicationRelated: true, memberships: { none: {} }, classificationStatus: "OK" },
  orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
  select: { gmailMessageId: true },
});

for (const orphan of orphans) {
  const id = orphan.gmailMessageId;
  if (seeded && labels.messages[id]) continue;
  const said = classificationOf(messagesById.get(id) ?? { llmClassificationRaw: null });
  blocks.push({
    id: groupIdFor([id]),
    company: said?.companyName ?? null,
    role: said?.roleTitle ?? null,
    season: said?.season ?? null,
    year: said?.year ?? null,
    status: said?.status ?? null,
    messages: [id],
    note: "the pipeline calls this application mail and then attaches it to no row at all",
  });
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
lines.push("- **Indentation** is the other question, and a different one: *where is this email shown*.");
lines.push("  Two spaces means this email is shown under the nearest line above it with less");
lines.push("  indentation, because it reports on that email's step rather than starting one of its");
lines.push("  own. Move a line and change its indentation together. A child of a child is an error,");
lines.push("  not a deeper tree.");
lines.push("- **`stage:`** is what this email asks the applicant to go and do, and `-` means it asks");
lines.push(`  for nothing. One of ${LABEL_STAGES.join(", ")}, defined by what the`);
lines.push("  applicant has to do rather than by what the employer called it: a test with right");
lines.push("  answers, something recorded alone and reviewed later, something live with a person,");
lines.push("  or something supplied and checked rather than judged.");
lines.push("- **`event:`** is what kind of report the email is, and `-` means none of them fit.");
lines.push(`  One of ${LABEL_EVENTS.join(", ")}.`);
lines.push("- **`outcome:`** is which ending the application reached, and `-` means it reached none,");
lines.push("  which is the answer on almost every email. One of");
lines.push(`  ${LABEL_OUTCOMES.join(", ")}.`);
lines.push("- **`rel:`** rides on indented lines only, and says which kind of report it is:");
lines.push("  `REPEAT` for the same notice sent again, `REMINDER` for a nudge about it, `UPDATE`");
lines.push("  for anything else. It is a chip in the drawer and nothing else depends on it.");
lines.push("- **Recall**: in the last two sections, flip `related:no` to `related:yes` for anything");
lines.push("  that really was about an application you submitted. That is the only way recall is");
lines.push("  ever measured (F7).");
lines.push("");
lines.push("A message that genuinely covers two applications is listed under both blocks, carrying the");
lines.push("same chips on each line. That is the only reason to list one twice, and it is what gives");
lines.push("`group.multi_message` a denominator (LOOP4 5.1).");
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
  for (const [id, parent] of treeOf(block.messages)) {
    const message = messagesById.get(id);
    const known = labels.messages[id];
    const significant = known ? known.significant : Boolean(message?.isSignificant);
    const relation = parent ? ` rel:${known?.relation ?? "UPDATE"} |` : "";
    // Seeded from the label where one exists, and from the pipeline's own
    // answer where none does, exactly as `sig:` is. The pipeline has no answer
    // for the event at all yet, so that one starts empty and is written by
    // hand once (LOOP3 5.1).
    const stage = known?.stage !== undefined ? known.stage : stageOf(id);
    const event = known?.event !== undefined ? known.event : null;
    const outcome = known?.outcome !== undefined ? known.outcome : null;
    lines.push(
      `${parent ? "  " : ""}- ${id} | sig:${significant ? "yes" : "no "} | stage:${field(stage ?? null)} | event:${field(event ?? null)} | outcome:${field(outcome ?? null)} |${relation} ${message ? message.receivedAt.toISOString().slice(0, 10) : "?"} | ${clean(message?.senderDomain)} | ${clean(message?.subject)}`,
    );
  }
  lines.push("");
}

// Recall is invisible by construction: an application never ingested never
// appears. Sampling what the pipeline threw away is the only way to see it.
//
// Everything already judged not related is listed too, whatever the pipeline
// now says about it. That is what `precision.related` is counted over, and a
// message that quietly left the sheet when the model changed its mind would
// take the label with it and shrink the metric that exists to notice.
const notRelated = await db.emailMessage.findMany({
  where: {
    OR: [
      { isApplicationRelated: false, classificationStatus: "OK" },
      { gmailMessageId: { in: Object.entries(labels.messages).filter(([, l]) => !l.related).map(([id]) => id) } },
    ],
  },
  select: { gmailMessageId: true, subject: true, senderEmail: true, receivedAt: true, isApplicationRelated: true },
});

// A message already moved into a group has been answered: the label says it
// is related, whatever the model said. Listing it again under "not related"
// asks the same question twice and reads back as a contradiction.
const settled = new Set(labels.applications.groups.flatMap((group) => group.messages));
const candidates = notRelated.filter((message) => !settled.has(message.gmailMessageId));

// Every message already answered stays on the sheet, and the sample tops the
// list up to its usual size out of the ones nobody has looked at yet.
const answered = candidates.filter((message) => labels.messages[message.gmailMessageId]);
const sample = [
  ...answered,
  ...deterministicSample(
    candidates.filter((message) => !labels.messages[message.gmailMessageId]),
    (message) => message.gmailMessageId,
    Math.max(0, RECALL_SAMPLE - answered.length),
  ),
];
sample.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());

lines.push(`## Not related (${sample.length} of ${notRelated.length}, sampled)`);
lines.push("");
lines.push("The pipeline judged every one of these to be nothing to do with an application.");
lines.push("");
for (const message of sample) {
  const known = labels.messages[message.gmailMessageId];
  const related = known ? known.related : false;
  // The pipeline disagreeing with a label here is the whole of
  // `precision.related`, so it is called out rather than left to be noticed.
  const disputed = message.isApplicationRelated ? " | the pipeline now calls this application mail" : "";
  lines.push(
    `- ${message.gmailMessageId} | related:${related ? "yes" : "no "} | ${message.receivedAt.toISOString().slice(0, 10)} | ${clean(message.senderEmail)} | ${clean(message.subject)}${disputed}`,
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
