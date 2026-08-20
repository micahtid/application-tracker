/**
 * What changed since the last replay, row by row (LOOP 3.6).
 *
 * Rows are lined up by their earliest message rather than by id, because a
 * rebuild renumbers everything. A row that gained or lost an email, changed
 * status, or appeared or vanished is what this prints.
 *
 *   npm run loop:diff
 */
import fs from "node:fs";
import { LAST_RESULT, readJson } from "./common.mts";
import type { ProjectedApplication } from "./projection.mts";

const PREVIOUS = LAST_RESULT.replace(/\.json$/, ".previous.json");

if (!fs.existsSync(PREVIOUS)) {
  console.log("There is no earlier replay to compare against yet. Run npm run loop:replay twice.");
  process.exit(0);
}

type Result = { applications: ProjectedApplication[] };

const before = readJson<Result>(PREVIOUS, { applications: [] }).applications;
const after = readJson<Result>(LAST_RESULT, { applications: [] }).applications;

const key = (row: ProjectedApplication) => row.messages[0] ?? `${row.companyNormalized}|${row.role}`;

const beforeByKey = new Map(before.map((row) => [key(row), row]));
const afterByKey = new Map(after.map((row) => [key(row), row]));

const label = (row: ProjectedApplication) =>
  `${row.company}${row.role ? ` · ${row.role.slice(0, 60)}` : ""}`;

let changes = 0;

for (const [id, row] of afterByKey) {
  if (!beforeByKey.has(id)) {
    console.log(`+ new    ${label(row)}  (${row.messages.length} emails)`);
    changes += 1;
  }
}

for (const [id, row] of beforeByKey) {
  if (!afterByKey.has(id)) {
    console.log(`- gone   ${label(row)}  (was ${row.messages.length} emails)`);
    changes += 1;
  }
}

for (const [id, now] of afterByKey) {
  const then = beforeByKey.get(id);
  if (!then) continue;

  const notes: string[] = [];
  if (then.company !== now.company) notes.push(`company "${then.company}" -> "${now.company}"`);
  if (then.role !== now.role) notes.push(`role "${then.role ?? "-"}" -> "${now.role ?? "-"}"`);
  if (then.status !== now.status) notes.push(`status ${then.status} -> ${now.status}`);
  if (then.stageDetail !== now.stageDetail) {
    notes.push(`stage ${then.stageDetail ?? "-"} -> ${now.stageDetail ?? "-"}`);
  }
  if (then.messages.length !== now.messages.length) {
    notes.push(`emails ${then.messages.length} -> ${now.messages.length}`);
  }
  if (then.milestones.length !== now.milestones.length) {
    notes.push(`milestones ${then.milestones.length} -> ${now.milestones.length}`);
  }

  if (notes.length) {
    console.log(`~ ${label(now)}`);
    for (const note of notes) console.log(`    ${note}`);
    changes += 1;
  }
}

console.log(
  changes
    ? `\n${changes} row${changes === 1 ? "" : "s"} changed. ${before.length} applications before, ${after.length} after.`
    : `Nothing changed. ${after.length} applications, both times.`,
);
