/**
 * Compare the rebuilt board to the labels and write the scorecard (LOOP 3.4,
 * 3.5).
 *
 * Predicted applications and labelled groups share no identifier, so they are
 * lined up by message overlap. Every metric is computed only over labelled
 * things, and a metric computed over fewer than twenty of them is printed with
 * a warning rather than trusted.
 *
 * Two numbers are reported for everything: TUNE, 60% of the labelled groups,
 * and HOLDOUT, the other 40%, never looked at while a change is being
 * designed. A change that moves TUNE and not HOLDOUT is fitted to this one
 * mailbox and gets reverted.
 *
 *   npm run loop:score -- --iteration 0 --note "baseline"
 */
import fs from "node:fs";
import {
  FLOORS,
  HISTORY,
  INTAKE_AUDIT,
  LAST_RESULT,
  SCORECARD,
  SNAPSHOT_STATE,
  arg,
  ensureLoopDir,
  halfOf,
  labelRevision,
  openWorkDb,
  readJson,
  readLabels,
  type Half,
  type SnapshotState,
} from "./common.mts";
import { TITLE_KEYWORD_RULES, drawerTitle, drawerTree, shownIn } from "../../src/lib/drawer.ts";
import { classificationOf } from "../../src/lib/pipeline/recompute.ts";
import { normalizeCompany, sameEmployer } from "../../src/lib/normalize.ts";
import { GROUPING_VERSION, CLASSIFIER_VERSION } from "../../src/lib/constants.ts";
import { findSplitSuspects } from "../../src/lib/pipeline/duplicates.ts";

const MIN_TRUSTED = 20;
const HALVES: Half[] = ["TUNE", "HOLDOUT"];

const db = openWorkDb();
const { applications: applicationLabels, messages: messageLabels } = readLabels();

if (!applicationLabels.groups.length) {
  console.error("There are no labels yet. Run npm run loop:review, correct the sheet, then npm run loop:label.");
  process.exit(1);
}

/**
 * What the last replay recorded, including the counters Gate 9 requires.
 *
 * The counters describe things the pipeline did that no board can show
 * afterwards: a dedupe key made unique to get past a collision, an alias
 * written, a repair that fired. Every one of them is a decision the code could
 * not make honestly, so it is counted where it happens and reported here
 * (LOOP4 Decision 8). A counter nothing writes yet reads as a dash rather than
 * as a zero, because those are different claims.
 */
type Counters = Partial<{
  dedupeCollisions: number;
  aliasesWritten: number;
  aliasesGuessed: number;
  linksByReason: Record<string, number>;
  scoreTies: number;
  fanoutEvents: number;
  repairMerges: number;
  repairSplits: number;
  repairUnsettled: number;
  repairRegressions: number;
  adjudicateCalls: number;
  adjudicateCostUsd: number;
}>;

const replay = readJson<{
  stable?: boolean;
  correctionsPreserved?: number;
  applications?: unknown[];
  counters?: Counters;
  repairs?: { kind: "MERGE" | "SPLIT"; left: string[]; right: string[] }[];
}>(LAST_RESULT, {});

const counters: Counters = replay.counters ?? {};

// ---------------------------------------------------------------- the board

/**
 * The board, with each application's emails carrying the pairing's own parent
 * (LOOP4 Decision 1). One email held by two applications appears once in each,
 * under whatever line it sits below there.
 */
const applications = (
  await db.application.findMany({
    include: {
      memberships: {
        select: {
          parentMessageId: true,
          parentRelation: true,
          message: {
            select: {
              id: true,
              gmailMessageId: true,
              emailTitle: true,
              receivedAt: true,
              senderDomain: true,
              isSignificant: true,
              isApplicationRelated: true,
              llmClassificationRaw: true,
            },
          },
        },
      },
      statusHistory: { include: { message: { select: { gmailMessageId: true } } } },
    },
  })
).map((application) => ({
  ...application,
  messages: application.memberships
    .map((membership) => ({
      ...membership.message,
      parentMessageId: membership.parentMessageId,
      parentRelation: membership.parentRelation,
    }))
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || a.id - b.id),
}));

const allMessages = await db.emailMessage.findMany({
  select: {
    gmailMessageId: true,
    isApplicationRelated: true,
    classificationStatus: true,
    llmClassificationRaw: true,
    memberships: { select: { applicationId: true } },
  },
});

/**
 * Which labelled groups each message belongs to (LOOP4 5.1).
 *
 * A set rather than one value, because an email that covers two postings
 * belongs to both and the whole of Decision 1 is about being able to say so. A
 * message in one group, which is almost all of them, gives a set of one and
 * every metric below reads exactly as it did.
 */
const groupsOfMessage = new Map<string, Set<string>>();
const halfOfGroup = new Map<string, Half>();
for (const group of applicationLabels.groups) {
  halfOfGroup.set(group.id, halfOf(group.id));
  for (const id of group.messages) {
    if (!groupsOfMessage.has(id)) groupsOfMessage.set(id, new Set());
    groupsOfMessage.get(id)!.add(group.id);
  }
}

/**
 * The one group a per message metric counts a multi group message under.
 *
 * Every metric that asks a question about the email rather than about the
 * pairing needs one half to count it in, and counting it twice would weight it
 * double. The smallest id wins, so the answer never depends on sheet order.
 */
function groupOfMessage(id: string): string | undefined {
  const groups = groupsOfMessage.get(id);
  if (!groups?.size) return undefined;
  return [...groups].sort()[0];
}

const earliestOfGroup = new Map<string, number>();
for (const application of applications) {
  for (const message of application.messages) {
    for (const group of groupsOfMessage.get(message.gmailMessageId) ?? []) {
      const at = message.receivedAt.getTime();
      if (!earliestOfGroup.has(group) || at < earliestOfGroup.get(group)!) {
        earliestOfGroup.set(group, at);
      }
    }
  }
}

/** Ties go to the earliest message, so an alignment never depends on row order. */
function pickBest(counts: Map<string, number>, tieBreak: (key: string) => number): string | null {
  let best: string | null = null;
  let bestCount = 0;
  let bestTie = Number.POSITIVE_INFINITY;
  for (const [key, count] of counts) {
    const tie = tieBreak(key);
    if (count > bestCount || (count === bestCount && tie < bestTie)) {
      best = key;
      bestCount = count;
      bestTie = tie;
    }
  }
  return best;
}

type Aligned = { application: (typeof applications)[number]; overlap: number };

const groupToApplication = new Map<string, Aligned>();
const applicationToGroup = new Map<number, string>();
const groupsInApplication = new Map<number, Set<string>>();
const applicationsInGroup = new Map<string, Set<number>>();
const pairs: { group: string; application: (typeof applications)[number]; overlap: number }[] = [];

/**
 * A message labelled as belonging to more than one application is left out of
 * the alignment and out of `group.split` and `group.merge` (LOOP4 5.1).
 *
 * Those three ask which single row a message belongs in, which is the one
 * question a multi group message has no answer to. Counting it would make an
 * email that is filed correctly in both places read as a split, and an email
 * filed correctly in one read as a merge. It is measured instead by
 * `group.multi_message` and `group.message_accuracy`, which are set
 * comparisons and can say what actually happened.
 */
function belongsToOneGroup(id: string): boolean {
  return (groupsOfMessage.get(id)?.size ?? 0) === 1;
}

for (const application of applications) {
  const counts = new Map<string, number>();
  for (const message of application.messages) {
    if (!belongsToOneGroup(message.gmailMessageId)) continue;
    const group = groupOfMessage(message.gmailMessageId);
    if (!group) continue;
    counts.set(group, (counts.get(group) ?? 0) + 1);
    if (!applicationsInGroup.has(group)) applicationsInGroup.set(group, new Set());
    applicationsInGroup.get(group)!.add(application.id);
  }
  groupsInApplication.set(application.id, new Set(counts.keys()));

  const best = pickBest(counts, (key) => earliestOfGroup.get(key) ?? Number.POSITIVE_INFINITY);
  if (best) applicationToGroup.set(application.id, best);

  for (const [group, overlap] of counts) pairs.push({ group, application, overlap });
}

/**
 * The alignment is one to one. An application stands for exactly one labelled
 * group, and a group has at most one application standing for it.
 *
 * That is what makes a merge visible: when five labelled applications arrive
 * in one row, only the group with the most emails in it can claim that row,
 * and the other four are left with nothing, which is the truth. A many to one
 * alignment would let all five claim it and report a perfect score.
 */
pairs.sort(
  (a, b) =>
    b.overlap - a.overlap ||
    (a.application.messages[0]?.receivedAt.getTime() ?? 0) -
      (b.application.messages[0]?.receivedAt.getTime() ?? 0) ||
    a.group.localeCompare(b.group),
);

const takenApplications = new Set<number>();
for (const pair of pairs) {
  if (groupToApplication.has(pair.group) || takenApplications.has(pair.application.id)) continue;
  groupToApplication.set(pair.group, { application: pair.application, overlap: pair.overlap });
  takenApplications.add(pair.application.id);
}

// ---------------------------------------------------------------- counting

type Tally = { hit: number; total: number };
const empty = (): Record<Half, Tally> => ({ TUNE: { hit: 0, total: 0 }, HOLDOUT: { hit: 0, total: 0 } });

const metrics: Record<string, Record<Half, Tally>> = {
  "group.split": empty(),
  "group.merge": empty(),
  "group.exact": empty(),
  "group.message_accuracy": empty(),
  "group.multi_message": empty(),
  "fanout.precision": empty(),
  "outcome.accuracy": empty(),
  "identity.company": empty(),
  "identity.role_filled": empty(),
  "state.head": empty(),
  "state.milestone_precision": empty(),
  "stage.accuracy": empty(),
  "event.accuracy": empty(),
  "recall.related": empty(),
  "precision.related": empty(),
  "prefilter.false_drop": empty(),
  "tree.parent_accuracy": empty(),
  "tree.top_level_precision": empty(),
};

/**
 * Whether a row's company and a label's company are the same employer.
 *
 * Judged by the pipeline's own definition rather than by a stricter one. An
 * employer writes itself several ways across one hiring process, and
 * `sameEmployer` is what decides everywhere else in the code that two of those
 * ways are one employer. Scoring the same question more strictly counts a row
 * wrong for a spelling the pipeline is right to treat as the same name, and
 * makes the metric wobble every time a pass reads the header again.
 */
function namesOneEmployer(predicted: string | null, labelled: string | null): boolean {
  const left = normalizeCompany(predicted ?? "");
  const right = normalizeCompany(labelled ?? "");
  return left === right || sameEmployer(left, right);
}

function count(metric: string, half: Half, hit: boolean): void {
  metrics[metric][half].total += 1;
  if (hit) metrics[metric][half].hit += 1;
}

const messageState = new Map(allMessages.map((message) => [message.gmailMessageId, message]));

// group.split and group.exact, one row per labelled group.
for (const group of applicationLabels.groups) {
  const half = halfOfGroup.get(group.id)!;
  const spread = applicationsInGroup.get(group.id) ?? new Set();

  count("group.split", half, spread.size <= 1);

  const aligned = groupToApplication.get(group.id);
  const predicted = aligned
    ? new Set(aligned.application.messages.map((message) => message.gmailMessageId))
    : new Set<string>();
  const labelled = new Set(group.messages);
  const exact =
    predicted.size === labelled.size && [...labelled].every((id) => predicted.has(id));
  count("group.exact", half, exact);

  if (aligned) {
    const application = aligned.application;
    count(
      "identity.company",
      half,
      namesOneEmployer(application.companyName, group.company),
    );
    // Scoped to applications where some email does say, because no algorithm
    // can invent a role no email states.
    if (group.role) count("identity.role_filled", half, Boolean(application.roleTitle));
    if (group.status) count("state.head", half, application.status === group.status);
  }
}

/**
 * Which applications actually hold each message.
 *
 * Read off the board rather than off `application_id`, because from Iteration
 * 5 belonging is a row of its own and a message may be held by two rows. Today
 * it is always a set of nought or one, and every metric below reads exactly as
 * it did.
 */
const applicationsHolding = new Map<string, Set<number>>();
for (const application of applications) {
  for (const message of application.messages) {
    const held = applicationsHolding.get(message.gmailMessageId) ?? new Set<number>();
    held.add(application.id);
    applicationsHolding.set(message.gmailMessageId, held);
  }
}

function sameSet(left: Set<number>, right: Set<number>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

/** The rows a message ought to be in: the aligned row of each group it is labelled in. */
function expectedApplications(id: string): Set<number> | null {
  const expected = new Set<number>();
  for (const group of groupsOfMessage.get(id) ?? []) {
    const aligned = groupToApplication.get(group)?.application.id;
    if (aligned === undefined) return null;              // no row stands for that group at all
    expected.add(aligned);
  }
  return expected.size ? expected : null;
}

/**
 * group.message_accuracy, one row per labelled message, as a set comparison
 * (LOOP4 5.1).
 *
 * A whole group counts as wrong the moment one of its emails lands elsewhere,
 * so `group.exact` cannot tell a row that is one email out from a row that is
 * entirely wrong. This one can, which is what makes a partial improvement
 * visible. It compares sets rather than values so that an email belonging to
 * two applications is right only when it is filed against both, and an email
 * belonging to one is still wrong the moment it is filed against two.
 */
const messagesInGroups = [...new Set(applicationLabels.groups.flatMap((group) => group.messages))];

for (const id of messagesInGroups) {
  const half = halfOfGroup.get(groupOfMessage(id)!)!;
  const expected = expectedApplications(id);
  const held = applicationsHolding.get(id) ?? new Set<number>();
  count("group.message_accuracy", half, expected !== null && sameSet(held, expected));
}

/**
 * group.multi_message, over the messages a label says cover more than one
 * application (LOOP4 5.2).
 *
 * The share of them filed against every one of their applications. Nothing but
 * the schema can move this: with one nullable column on the message there is
 * no way to file an email against two rows, so it reads 0 until Iteration 5
 * makes the answer expressible and Iteration 6 makes it happen.
 */
for (const id of messagesInGroups) {
  if (belongsToOneGroup(id)) continue;
  const half = halfOfGroup.get(groupOfMessage(id)!)!;
  const expected = expectedApplications(id);
  const held = applicationsHolding.get(id) ?? new Set<number>();
  count("group.multi_message", half, expected !== null && sameSet(held, expected));
}

/**
 * fanout.precision and fanout.events, the other direction of the same question
 * (LOOP4 5.2).
 *
 * `group.multi_message` reads the labels and asks whether every email that
 * covers two applications reached both. These read the board and ask whether
 * every email the board put in two places belonged in both. One is recall and
 * the other is precision, and a rule that fanned out everything would score
 * perfectly on the first alone.
 *
 * Both are read off the board rather than off a counter, because what matters
 * is where the emails ended up rather than how many times a branch was taken.
 */
const fannedOut = [...applicationsHolding.entries()].filter(([, held]) => held.size > 1);

for (const [id, held] of fannedOut) {
  const group = groupOfMessage(id);
  if (!group) continue;                                  // unlabelled: counted, not judged
  const expected = expectedApplications(id);
  count("fanout.precision", halfOfGroup.get(group)!, expected !== null && sameSet(held, expected));
}

// group.merge, one row per application that holds any labelled message.
for (const application of applications) {
  const groups = groupsInApplication.get(application.id) ?? new Set();
  if (!groups.size) continue;
  const half = halfOfGroup.get(applicationToGroup.get(application.id)!)!;
  count("group.merge", half, groups.size <= 1);
}

// state.milestone_precision, one row per milestone actually written.
for (const application of applications) {
  for (const row of application.statusHistory) {
    const label = messageLabels[row.message.gmailMessageId];
    const group = groupOfMessage(row.message.gmailMessageId);
    if (!label || !group) continue;
    count("state.milestone_precision", halfOfGroup.get(group)!, label.significant);
  }
}

// sig.f1, over every labelled message the pipeline could have written a
// milestone for. A repeat that writes no milestone is the true negative the
// whole of Invariant 3 is about.
const wroteMilestone = new Set<string>();
for (const application of applications) {
  for (const row of application.statusHistory) wroteMilestone.add(row.message.gmailMessageId);
}

const confusion: Record<Half, { tp: number; fp: number; fn: number }> = {
  TUNE: { tp: 0, fp: 0, fn: 0 },
  HOLDOUT: { tp: 0, fp: 0, fn: 0 },
};

for (const group of applicationLabels.groups) {
  const half = halfOfGroup.get(group.id)!;
  for (const id of group.messages) {
    const label = messageLabels[id];
    if (!label) continue;
    const predicted = wroteMilestone.has(id);
    if (predicted && label.significant) confusion[half].tp += 1;
    else if (predicted && !label.significant) confusion[half].fp += 1;
    else if (!predicted && label.significant) confusion[half].fn += 1;
  }
}

// recall.related and prefilter.false_drop, over what the pipeline may never
// have seen at all.


for (const [id, label] of Object.entries(messageLabels)) {
  if (!label.related) continue;
  const group = groupOfMessage(id);
  const half = group ? halfOfGroup.get(group)! : "TUNE";
  const state = messageState.get(id);
  count("recall.related", half, Boolean(state?.isApplicationRelated && state.memberships.length));
  if (state?.classificationStatus === "SKIPPED_PREFILTER") count("prefilter.false_drop", half, false);
}
for (const [id, label] of Object.entries(messageLabels)) {
  const state = messageState.get(id);
  if (!label.related && state?.classificationStatus === "SKIPPED_PREFILTER") {
    count("prefilter.false_drop", "TUNE", true);
  }
}

/**
 * precision.related, the other direction of the same gate (LOOP3 5.2).
 *
 * `recall.related` has always counted mail wrongly thrown away and nothing
 * counted mail wrongly let in, so a change that loosens the gate could only
 * ever look like an improvement. Every one of these is labelled by hand out of
 * mail the pipeline already rejected, so none of them sits in a labelled
 * group and there is no half to put them in. They all count as TUNE, exactly
 * as the false drops do.
 */
for (const [id, label] of Object.entries(messageLabels)) {
  if (label.related) continue;
  const state = messageState.get(id);
  count("precision.related", "TUNE", !state?.isApplicationRelated);
}

/**
 * stage.accuracy and event.accuracy, over the emails a label answers for.
 *
 * The stored answer is the model's, read back through the same parser the
 * board reads it through, so what is scored is what a person would see rather
 * than what the raw JSON happens to hold.
 */
/**
 * Read from every message rather than from the ones that reached a row.
 *
 * These three ask what the model answered about an email, which is a question
 * about the classifier alone. Reading them off the board conflated that with
 * whether the email was grouped at all: an email the pipeline calls
 * application mail and then attaches to nothing scored as a classification
 * miss, when the classification was right and the grouping was what failed.
 */
const storedMessages = new Map(
  allMessages.map((message) => [message.gmailMessageId, message] as const),
);

for (const [id, label] of Object.entries(messageLabels)) {
  const group = groupOfMessage(id);
  if (!group) continue;
  const half = halfOfGroup.get(group)!;
  // Read back through the pipeline's own parser, so a missing answer scores as
  // a miss rather than as the fallback the parser would have supplied had the
  // model given one.
  const said = classificationOf(storedMessages.get(id) ?? { llmClassificationRaw: null });

  if (label.stage) count("stage.accuracy", half, said?.stageDetail === label.stage);
  if (label.event) count("event.accuracy", half, said?.emailEvent === label.event);

  /**
   * outcome.accuracy, over the emails that announced an ending (LOOP4 5.2).
   *
   * Read off the stored answer the same way, and typed as an addition the
   * classification does not carry yet: until Iteration 8 there is no field to
   * read, so every labelled ending scores as a miss. That is the defect being
   * measured rather than a fault in the reading, and a metric that only
   * starts existing once it passes would never have shown V2 at all.
   */
  if (label.outcome) {
    const stored = (said as (typeof said & { outcome?: string | null }) | null)?.outcome ?? null;
    count("outcome.accuracy", half, stored === label.outcome);
  }
}

// The tree and the drawer. Two different questions, counted separately.
//
//   tree.parent_accuracy  reads the stored parent, so it says whether the
//                         pipeline worked out the right shape.
//   tree.top_level_precision and drawer.hidden read the drawer, so they say
//                         whether that shape reaches a person.

const gmailIdOfRow = new Map<number, string>();
for (const application of applications) {
  for (const message of application.messages) gmailIdOfRow.set(message.id, message.gmailMessageId);
}

/**
 * The parent worked out for each email, in each application that holds it.
 *
 * Keyed by the pairing rather than by the email, because the drawer parent is
 * a fact about the pairing: an email in two applications sits under a
 * different line in each (LOOP4 Decision 1). Today one column holds it, so
 * both entries carry the same value and the reading is unchanged.
 */
const computedParent = new Map<string, string | null>();
const pairKey = (applicationId: number, gmailMessageId: string) => `${applicationId}:${gmailMessageId}`;
for (const application of applications) {
  for (const message of application.messages) {
    computedParent.set(
      pairKey(application.id, message.gmailMessageId),
      message.parentMessageId === null ? null : gmailIdOfRow.get(message.parentMessageId) ?? null,
    );
  }
}

/**
 * Every (application, email) pairing a label states, with where the email sits
 * in that application's drawer.
 *
 * A message in one group states one pairing and reads exactly as it did. A
 * message in two states two, and each is scored against the row that stands
 * for its own group, which is the only way an email in two drawers can be
 * scored at all.
 */
type LabelledPair = { message: string; group: string; parent: string | null; relation: string | null };
const labelledPairs: LabelledPair[] = [];
for (const [id, label] of Object.entries(messageLabels)) {
  if (!groupsOfMessage.has(id)) continue;
  if (label.groups?.length) {
    for (const membership of label.groups) {
      labelledPairs.push({
        message: id,
        group: membership.id,
        parent: membership.parent,
        relation: membership.relation,
      });
    }
    continue;
  }
  labelledPairs.push({
    message: id,
    group: groupOfMessage(id)!,
    parent: label.parent ?? null,
    relation: label.relation ?? null,
  });
}

/** Broken down by relation, so nesting a reminder and nesting a completion
 *  notice can be told apart even though one rule does both (LOOP2 4.2). */
const parentByRelation = new Map<string, Tally>();
let hidden = 0;
/**
 * Nested lines that read exactly as a line already shown above them in the
 * same drawer (LOOP3 5.2).
 *
 * A drawer that says the same six words three times has told the reader
 * nothing twice. Counted over the composed titles rather than the stored ones,
 * because the composed title is what a person actually reads.
 */
let duplicateLines = 0;
const topLevelSpread = new Map<number, number>();

for (const application of applications) {
  const tree = drawerTree(application.messages);
  const shown = new Set(shownIn(tree).map((message) => message.gmailMessageId));
  const related = application.messages.filter((message) => message.isApplicationRelated);

  hidden += related.filter((message) => !shown.has(message.gmailMessageId)).length;
  topLevelSpread.set(tree.length, (topLevelSpread.get(tree.length) ?? 0) + 1);

  const above = new Set<string>();
  for (const node of tree) {
    above.add(drawerTitle(node.message));
    for (const child of node.children) {
      const title = drawerTitle(child.message);
      if (above.has(title)) duplicateLines += 1;
      above.add(title);
    }
  }

  // Read against the pairing this drawer is: an email in two applications may
  // rightly hold its own line in one and sit under a line in the other. Where
  // the email belongs to one group, which is every email but a handful, the
  // pairing is that group and the reading is unchanged.
  const standsFor = applicationToGroup.get(application.id);
  for (const node of tree) {
    const id = node.message.gmailMessageId;
    if (!messageLabels[id]) continue;
    const pair =
      labelledPairs.find((row) => row.message === id && row.group === standsFor) ??
      labelledPairs.find((row) => row.message === id && row.group === groupOfMessage(id));
    if (!pair) continue;
    count("tree.top_level_precision", halfOfGroup.get(pair.group)!, !pair.parent);
  }
}

for (const pair of labelledPairs) {
  if (!pair.parent) continue;
  const aligned = groupToApplication.get(pair.group)?.application.id;
  const hit =
    aligned !== undefined && computedParent.get(pairKey(aligned, pair.message)) === pair.parent;
  count("tree.parent_accuracy", halfOfGroup.get(pair.group)!, hit);

  const relation = pair.relation ?? "UPDATE";
  const tally = parentByRelation.get(relation) ?? { hit: 0, total: 0 };
  tally.total += 1;
  if (hit) tally.hit += 1;
  parentByRelation.set(relation, tally);
}

// ---------------------------------------------------------------- reporting

function ratio(tally: Tally): number | null {
  return tally.total ? tally.hit / tally.total : null;
}

function f1(half: Half): number | null {
  const { tp, fp, fn } = confusion[half];
  if (!tp && !fp && !fn) return null;
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  return precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
}

function show(value: number | null, total: number): string {
  if (value === null) return "—";
  const text = value.toFixed(3);
  return total < MIN_TRUSTED ? `${text} ⚠` : text;
}

const relatedMessages = allMessages.filter((message) => message.isApplicationRelated).length;
const labelledMessages = Object.keys(messageLabels).length;
// Distinct messages rather than memberships: one email may belong to two
// groups, and counting it twice put labels.coverage above 100%.
const groupedLabels = new Set(applicationLabels.groups.flatMap((group) => group.messages)).size;

const failures = await db.emailMessage.count({ where: { classificationStatus: "FAILED" } });
const suspects = await findSplitSuspects(db);
/**
 * What this loop has spent, rather than what the mailbox has ever spent.
 *
 * `llm_usage` is copied into the scratch database along with everything else,
 * so its sum is the whole history of classification and reads the same however
 * little an iteration bought. loop:snapshot records that total when it takes
 * the copy; the difference since is the only number that can mean "this
 * iteration was free" (LOOP2 2).
 */
const cost = await db.llmUsage.aggregate({ _sum: { costUsd: true } });
const snapshot = readJson<SnapshotState | null>(SNAPSHOT_STATE, null);
const spentThisPass = (cost._sum.costUsd ?? 0) - (snapshot?.costUsdBefore ?? 0);

const iteration = arg("iteration") ?? "?";
const note = arg("note") ?? "";
const revision = labelRevision();

// The counts that are counts rather than ratios read better as raw numbers.
const splitCount = {
  TUNE: metrics["group.split"].TUNE.total - metrics["group.split"].TUNE.hit,
  HOLDOUT: metrics["group.split"].HOLDOUT.total - metrics["group.split"].HOLDOUT.hit,
};
const mergeCount = {
  TUNE: metrics["group.merge"].TUNE.total - metrics["group.merge"].TUNE.hit,
  HOLDOUT: metrics["group.merge"].HOLDOUT.total - metrics["group.merge"].HOLDOUT.hit,
};
const falseDrops = Object.entries(messageLabels).filter(
  ([id, label]) => label.related && messageState.get(id)?.classificationStatus === "SKIPPED_PREFILTER",
).length;

/**
 * repair.regressions, judged against the labels rather than against a counter
 * (LOOP4 5.2).
 *
 * A merge is a regression when it joined two emails the labels put in different
 * applications. A split is one when it separated two the labels put together.
 * Read off the actions the pass recorded rather than off the board, because the
 * board afterwards cannot say which row a repair produced.
 */
const repairRegressions = (replay.repairs ?? []).filter((action) => {
  const groupsOf = (ids: string[]) =>
    new Set(ids.flatMap((id) => [...(groupsOfMessage.get(id) ?? [])]));
  const left = groupsOf(action.left);
  const right = groupsOf(action.right);
  if (!left.size || !right.size) return false;          // unlabelled: counted, not judged
  const shared = [...left].some((group) => right.has(group));
  return action.kind === "MERGE" ? !shared : shared;
}).length;

/** A counter nothing writes yet reads as a dash. Nought is a different claim. */
function countOf(name: keyof Counters): string {
  const value = counters[name];
  return typeof value === "number" ? String(value) : "—";
}

/**
 * What the last intake audit found (LOOP4 Decision 9).
 *
 * The one number in this project measured against the mailbox rather than
 * against the subset the sweep returned. Written by its own command, because
 * it costs money and a scored run may not spend without being asked.
 */
const audit = readJson<{ recall: number; sampled: number; related: number; at: string } | null>(
  INTAKE_AUDIT,
  null,
);

type Row = { metric: string; tune: string; holdout: string; target: string };

const rows: Row[] = [
  { metric: "group.split", tune: String(splitCount.TUNE), holdout: String(splitCount.HOLDOUT), target: "0" },
  { metric: "group.merge", tune: String(mergeCount.TUNE), holdout: String(mergeCount.HOLDOUT), target: "0" },
  ...(
    [
      ["group.exact", "≥ 0.95"],
      ["group.message_accuracy", "≥ 0.99"],
      ["group.multi_message", "1.000"],
      ["fanout.precision", "1.000, may not fall"],
      ["outcome.accuracy", "≥ 0.95"],
      ["identity.company", "≥ 0.95"],
      ["identity.role_filled", "1.0"],
      ["state.head", "≥ 0.95"],
      ["state.milestone_precision", "≥ 0.98"],
      ["stage.accuracy", "≥ 0.95"],
      ["event.accuracy", "≥ 0.95"],
      ["recall.related", "1.0"],
      ["precision.related", "1.0"],
    ] as const
  ).map(([metric, target]) => ({
    metric,
    tune: show(ratio(metrics[metric].TUNE), metrics[metric].TUNE.total),
    holdout: show(ratio(metrics[metric].HOLDOUT), metrics[metric].HOLDOUT.total),
    target,
  })),
  {
    metric: "sig.f1",
    tune: show(f1("TUNE"), confusion.TUNE.tp + confusion.TUNE.fp + confusion.TUNE.fn),
    holdout: show(f1("HOLDOUT"), confusion.HOLDOUT.tp + confusion.HOLDOUT.fp + confusion.HOLDOUT.fn),
    target: "≥ 0.9",
  },
  { metric: "prefilter.false_drop", tune: String(falseDrops), holdout: "—", target: "0" },
  {
    metric: "rebuild.stable",
    tune: replay.stable === undefined ? "—" : replay.stable ? "1.0" : "0.0",
    holdout: "—",
    target: "1.0",
  },
  {
    metric: "corrections.preserved",
    tune: replay.correctionsPreserved === undefined ? "—" : replay.correctionsPreserved.toFixed(3),
    holdout: "—",
    target: "1.0",
  },
  {
    metric: "labels.coverage",
    tune: `${((groupedLabels / Math.max(relatedMessages, 1)) * 100).toFixed(0)}% of related mail`,
    holdout: `${applicationLabels.groups.length} groups`,
    target: "grows",
  },
  { metric: "group.split_suspects", tune: String(suspects.length), holdout: "—", target: "advisory" },
  { metric: "classify.failed", tune: String(failures), holdout: "—", target: "0" },
  /**
   * Gate 9's counters (LOOP4 Decision 8). Every one of these records a
   * decision the code could not make honestly, and a dash means nothing has
   * been written to count it yet rather than that it happened nought times.
   */
  { metric: "fanout.events", tune: String(fannedOut.length), holdout: "—", target: "1 here, and it is a ceiling" },
  { metric: "repair.merges", tune: countOf("repairMerges"), holdout: "—", target: "advisory" },
  { metric: "repair.splits", tune: countOf("repairSplits"), holdout: "—", target: "advisory" },
  { metric: "repair.regressions", tune: replay.repairs ? String(repairRegressions) : "—", holdout: "—", target: "0" },
  { metric: "repair.unsettled", tune: countOf("repairUnsettled"), holdout: "—", target: "advisory, watched" },
  { metric: "dedupe.collisions", tune: countOf("dedupeCollisions"), holdout: "—", target: "0" },
  { metric: "alias.guessed", tune: countOf("aliasesGuessed"), holdout: "—", target: "0" },
  { metric: "alias.written", tune: countOf("aliasesWritten"), holdout: "—", target: "advisory, watched" },
  { metric: "link.scored", tune: String(counters.linksByReason?.SCORE ?? "—"), holdout: "—", target: "advisory, watched" },
  { metric: "adjudicate.calls", tune: countOf("adjudicateCalls"), holdout: "—", target: "under 5% of related mail" },
  {
    metric: "intake.audit_recall",
    tune: audit ? audit.recall.toFixed(3) : "—",
    holdout: "—",
    target: "the prediction is that it will not be 0",
  },
  { metric: "cost.pass_usd", tune: spentThisPass.toFixed(4), holdout: "—", target: "0 unless the prompt changed" },
  {
    metric: "tree.parent_accuracy",
    tune: show(ratio(metrics["tree.parent_accuracy"].TUNE), metrics["tree.parent_accuracy"].TUNE.total),
    holdout: show(ratio(metrics["tree.parent_accuracy"].HOLDOUT), metrics["tree.parent_accuracy"].HOLDOUT.total),
    target: "≥ 0.95",
  },
  {
    metric: "tree.top_level_precision",
    tune: show(ratio(metrics["tree.top_level_precision"].TUNE), metrics["tree.top_level_precision"].TUNE.total),
    holdout: show(ratio(metrics["tree.top_level_precision"].HOLDOUT), metrics["tree.top_level_precision"].HOLDOUT.total),
    target: "≥ 0.95",
  },
  { metric: "drawer.hidden", tune: String(hidden), holdout: "—", target: "0" },
  { metric: "drawer.duplicate_lines", tune: String(duplicateLines), holdout: "—", target: "0" },
  {
    metric: "title.keyword_rules",
    tune: String(TITLE_KEYWORD_RULES.length),
    holdout: "—",
    target: "0 from iteration 2",
  },
  { metric: "drawer.top_level", tune: spread(topLevelSpread), holdout: "—", target: "no row above the states it reached" },
];

/** `37×1 10×2 3×3`: how many rows show how many top level lines. */
function spread(counts: Map<number, number>): string {
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([lines, rows]) => `${rows}×${lines}`)
    .join(" ") || "—";
}

const lines: string[] = [];
lines.push(`# Scorecard — iteration ${iteration}`);
lines.push("");
lines.push(`- labels: revision \`${revision}\`, ${applicationLabels.groups.length} groups over ${groupedLabels} messages, ${labelledMessages} messages labelled in total`);
lines.push(`- board: ${applications.length} applications over ${relatedMessages} related messages`);
lines.push(`- versions: CLASSIFIER_VERSION ${CLASSIFIER_VERSION}, GROUPING_VERSION ${GROUPING_VERSION}`);
if (note) lines.push(`- note: ${note}`);
lines.push("");
lines.push("| Metric | TUNE | HOLDOUT | Target |");
lines.push("|---|---|---|---|");
for (const row of rows) lines.push(`| \`${row.metric}\` | ${row.tune} | ${row.holdout} | ${row.target} |`);
lines.push("");
lines.push(`⚠ marks a metric computed over fewer than ${MIN_TRUSTED} labelled things. Read it, do not trust it.`);
lines.push("");
if (parentByRelation.size) {
  lines.push(
    "`tree.parent_accuracy` by relation: " +
      [...parentByRelation.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([relation, tally]) => `${relation} ${tally.hit}/${tally.total}`)
        .join(", "),
  );
  lines.push("");
}

/**
 * Gate 5, the ratchet. Every inherited metric has a floor and none of them may
 * fall below it. Written down rather than remembered, because LOOP2 changes
 * code that ten scored iterations already tuned, and a trade has to be argued
 * for in writing rather than noticed later.
 */
type Floor = { TUNE?: number; HOLDOUT?: number; direction?: "up" | "down" };
const floors = readJson<Record<string, Floor>>(FLOORS, {});
const readings: Record<string, { TUNE: number | null; HOLDOUT: number | null }> = {
  ...Object.fromEntries(
    Object.entries(metrics).map(([name, halves]) => [
      name,
      { TUNE: ratio(halves.TUNE), HOLDOUT: ratio(halves.HOLDOUT) },
    ]),
  ),
  "sig.f1": { TUNE: f1("TUNE"), HOLDOUT: f1("HOLDOUT") },
  "group.split": { TUNE: splitCount.TUNE, HOLDOUT: splitCount.HOLDOUT },
  "group.merge": { TUNE: mergeCount.TUNE, HOLDOUT: mergeCount.HOLDOUT },
  "prefilter.false_drop": { TUNE: falseDrops, HOLDOUT: null },
  "classify.failed": { TUNE: failures, HOLDOUT: null },
  "rebuild.stable": { TUNE: replay.stable === undefined ? null : replay.stable ? 1 : 0, HOLDOUT: null },
  "corrections.preserved": { TUNE: replay.correctionsPreserved ?? null, HOLDOUT: null },
  "cost.pass_usd": { TUNE: spentThisPass, HOLDOUT: null },
  "drawer.hidden": { TUNE: hidden, HOLDOUT: null },
  "drawer.duplicate_lines": { TUNE: duplicateLines, HOLDOUT: null },
  "title.keyword_rules": { TUNE: TITLE_KEYWORD_RULES.length, HOLDOUT: null },
  // Gate 9's counters. A counter nothing writes yet reads null and is skipped
  // by the ratchet, which is what stops a floor being held against a number
  // that does not exist.
  "fanout.events": { TUNE: fannedOut.length, HOLDOUT: null },
  "repair.merges": { TUNE: counters.repairMerges ?? null, HOLDOUT: null },
  "repair.splits": { TUNE: counters.repairSplits ?? null, HOLDOUT: null },
  "repair.regressions": { TUNE: replay.repairs ? repairRegressions : null, HOLDOUT: null },
  "repair.unsettled": { TUNE: counters.repairUnsettled ?? null, HOLDOUT: null },
  "dedupe.collisions": { TUNE: counters.dedupeCollisions ?? null, HOLDOUT: null },
  "alias.guessed": { TUNE: counters.aliasesGuessed ?? null, HOLDOUT: null },
  "alias.written": { TUNE: counters.aliasesWritten ?? null, HOLDOUT: null },
  "link.scored": { TUNE: counters.linksByReason?.SCORE ?? null, HOLDOUT: null },
  "adjudicate.calls": { TUNE: counters.adjudicateCalls ?? null, HOLDOUT: null },
  "intake.audit_recall": { TUNE: audit?.recall ?? null, HOLDOUT: null },
};

const falls: string[] = [];
for (const [metric, floor] of Object.entries(floors)) {
  for (const half of HALVES) {
    const limit = floor[half];
    const value = readings[metric]?.[half];
    if (limit === undefined || value === null || value === undefined) continue;
    // "down" is for the counts, where a floor is a ceiling: fewer is better.
    // Half a digit of slack, because a floor is quoted at the three decimals
    // the scorecard prints and the reading behind it carries more.
    const slack = 5e-4;
    const fell = floor.direction === "down" ? value > limit + slack : value < limit - slack;
    if (fell) falls.push(`\`${metric}\` ${half} is ${value} against a floor of ${limit}`);
  }
}

lines.push("## The ratchet");
lines.push("");
if (!Object.keys(floors).length) {
  lines.push(`No floors are recorded yet. Write ${FLOORS.replace(process.cwd(), ".")} to hold Gate 5.`);
} else if (falls.length) {
  lines.push("**Gate 5 is not met.** A metric a previous iteration earned has fallen:");
  lines.push("");
  for (const fall of falls) lines.push(`- ${fall}`);
  lines.push("");
  lines.push("Either the change is reverted, or the trade is written down in the report with its reason.");
} else {
  lines.push(`Held. ${Object.keys(floors).length} inherited metrics are at or above their floor.`);
}
lines.push("");

// The disagreements themselves, which is what the triage step actually reads.
if (suspects.length) {
  lines.push("## Rows that look like one application split in two");
  lines.push("");
  lines.push("Advisory. Nothing acts on these; they are the pairs a rule change would next reach.");
  lines.push("");
  for (const suspect of suspects) {
    lines.push(`- **${suspect.company}**, titles score ${suspect.similarity.toFixed(2)}`);
    lines.push(`  - ${suspect.roles[0] ?? "(no role)"}`);
    lines.push(`  - ${suspect.roles[1] ?? "(no role)"}`);
  }
  lines.push("");
}

lines.push("## Where it disagrees with the labels");
lines.push("");
for (const group of applicationLabels.groups) {
  const half = halfOfGroup.get(group.id)!;
  const spread = applicationsInGroup.get(group.id) ?? new Set();
  const aligned = groupToApplication.get(group.id);
  const problems: string[] = [];

  if (spread.size > 1) problems.push(`split across ${spread.size} applications`);
  if (!spread.size) problems.push("no message of this group reached the board");
  if (aligned) {
    const groups = groupsInApplication.get(aligned.application.id) ?? new Set();
    if (groups.size > 1) problems.push(`shares a row with ${groups.size - 1} other labelled group(s)`);
    if (!namesOneEmployer(aligned.application.companyName, group.company)) {
      problems.push(`company "${aligned.application.companyName}" not "${group.company}"`);
    }
    if (group.role && !aligned.application.roleTitle) problems.push("role is empty but an email states it");
    if (group.status && aligned.application.status !== group.status) {
      problems.push(`status ${aligned.application.status} not ${group.status}`);
    }
    const repeats = aligned.application.statusHistory.filter((row) => {
      const label = messageLabels[row.message.gmailMessageId];
      return label && !label.significant;
    }).length;
    if (repeats) problems.push(`${repeats} milestone(s) are repeats`);
  }

  if (problems.length) {
    lines.push(`- **${group.company ?? "?"}** ${group.role ? `· ${group.role}` : ""} \`${group.id}\` (${half})`);
    for (const problem of problems) lines.push(`  - ${problem}`);
  }
}
lines.push("");

ensureLoopDir();
fs.writeFileSync(SCORECARD, lines.join("\n"));

const record = {
  iteration,
  at: new Date().toISOString(),
  labelRevision: revision,
  classifierVersion: CLASSIFIER_VERSION,
  groupingVersion: GROUPING_VERSION,
  note,
  applications: applications.length,
  groups: applicationLabels.groups.length,
  metrics: Object.fromEntries([
    ...Object.entries(metrics).map(([name, halves]) => [
      name,
      { TUNE: ratio(halves.TUNE), HOLDOUT: ratio(halves.HOLDOUT) },
    ]),
    ["sig.f1", { TUNE: f1("TUNE"), HOLDOUT: f1("HOLDOUT") }],
  ]),
  counts: {
    split: splitCount,
    merge: mergeCount,
    falseDrops,
    failures,
    splitSuspects: suspects.length,
    drawerHidden: hidden,
    drawerDuplicateLines: duplicateLines,
    titleKeywordRules: TITLE_KEYWORD_RULES.length,
    drawerTopLevel: Object.fromEntries(topLevelSpread),
    parentByRelation: Object.fromEntries(parentByRelation),
    fanoutEvents: fannedOut.length,
    ...counters,
  },
  intakeAuditRecall: audit?.recall ?? null,
  stable: replay.stable ?? null,
  correctionsPreserved: replay.correctionsPreserved ?? null,
  costUsd: spentThisPass,
  costUsdTotal: cost._sum.costUsd ?? 0,
  floorsHeld: falls.length === 0,
};
fs.appendFileSync(HISTORY, JSON.stringify(record) + "\n");

console.log(lines.slice(0, 8 + rows.length).join("\n"));
console.log(`\nWrote ${SCORECARD} and appended to ${HISTORY}.`);

await db.$disconnect();
