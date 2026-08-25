/**
 * Raise every floor the last scored pass earned.
 *
 * The ratchet was once kept by hand, which meant a pass that improved
 * something either moved its floor by hand or left it where
 * it was. A floor left behind is a floor that has stopped catching anything.
 *
 * Only ever upwards for a ratio and downwards for a count, so a floor records
 * the best any iteration has managed rather than the last thing that happened.
 * A floor that has to come *down* is a trade, and a trade is argued for in
 * writing by a person rather than applied by this.
 *
 *   npm run loop:ratchet
 */
import fs from "node:fs";
import { FLOORS, HISTORY, readJson, writeJson, type Half } from "./common.mts";

type Reading = { TUNE: number | null; HOLDOUT: number | null };
type Record_ = {
  iteration: string;
  metrics: Record<string, Reading>;
  counts: Record<string, unknown>;
};
type Floor = { TUNE?: number; HOLDOUT?: number; direction?: "up" | "down" };

const history = fs.readFileSync(HISTORY, "utf8").trim().split("\n");
const last = JSON.parse(history[history.length - 1]) as Record_;
const floors = readJson<Record<string, Floor>>(FLOORS, {});

const HALVES: Half[] = ["TUNE", "HOLDOUT"];
const round = (value: number) => Math.round(value * 1000) / 1000;
const moved: string[] = [];

function raise(metric: string, half: Half, value: number, better: (a: number, b: number) => boolean) {
  const entry = (floors[metric] ??= {});
  if (entry[half] === undefined || better(value, entry[half]!)) {
    moved.push(`${metric} ${half}: ${entry[half] ?? "none"} -> ${value}`);
    entry[half] = value;
  }
}

for (const [metric, halves] of Object.entries(last.metrics)) {
  if (floors[metric]?.direction === "down") continue;
  for (const half of HALVES) {
    const value = halves[half];
    if (value === null || value === undefined) continue;
    raise(metric, half, round(value), (a, b) => a > b);
  }
}

/** The counts, where a floor is a ceiling: fewer is better and more is a fall. */
const counts = last.counts as Record<string, { TUNE?: number; HOLDOUT?: number } | number>;
const CEILINGS: Record<string, { TUNE?: number; HOLDOUT?: number } | undefined> = {
  "group.split": counts.split as { TUNE: number; HOLDOUT: number },
  "group.merge": counts.merge as { TUNE: number; HOLDOUT: number },
  "fanout.events": { TUNE: counts.fanoutEvents as number },
  "dedupe.collisions": { TUNE: counts.dedupeCollisions as number },
  "alias.guessed": { TUNE: counts.aliasesGuessed as number },
  "drawer.duplicate_lines": { TUNE: counts.drawerDuplicateLines as number },
  "drawer.hidden": { TUNE: counts.drawerHidden as number },
  "classify.failed": { TUNE: counts.failures as number },
  "prefilter.false_drop": { TUNE: counts.falseDrops as number },
};

for (const [metric, value] of Object.entries(CEILINGS)) {
  if (floors[metric]?.direction !== "down") continue;
  for (const half of HALVES) {
    const reading = value?.[half];
    if (typeof reading !== "number") continue;
    raise(metric, half, reading, (a, b) => a < b);
  }
}

writeJson(FLOORS, floors);
console.log(`From iteration ${last.iteration}:`);
console.log(moved.length ? moved.map((line) => `  ${line}`).join("\n") : "  nothing to ratchet");
