/**
 * Copy the live database to loop/work.db (LOOP 3).
 *
 * The loop never writes to the live database. Every iteration wipes and
 * rebuilds its scratch copy instead, so a bad iteration cannot damage the
 * board being used.
 *
 *   npm run loop:snapshot [-- --force]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import {
  LIVE_DB,
  LOOP_DIR,
  SNAPSHOT_STATE,
  WORK_DB,
  dbUrl,
  ensureLoopDir,
  flag,
  openDb,
  writeJson,
} from "./common.mts";

if (!fs.existsSync(LIVE_DB)) {
  console.error(`There is no database at ${LIVE_DB}.`);
  process.exit(1);
}

// SQLite will happily copy a file a sync is still writing, and the loop would
// then be scoring a torn database rather than the board.
const live = openDb(LIVE_DB);
const open = await live.syncRun.findFirst({ where: { status: "RUNNING" } });

/**
 * What every classification ever run has cost, read before the copy is taken.
 *
 * `llm_usage` is a ledger the scratch database inherits along with everything
 * else, so summing it after a pass gives the total spend of the mailbox's whole
 * history rather than the price of the pass. Recording the total here is what
 * lets `cost.pass_usd` be the difference, and therefore lets "it read 0" mean
 * "this iteration bought nothing".
 */
const spentBefore = (await live.llmUsage.aggregate({ _sum: { costUsd: true } }))._sum.costUsd ?? 0;
await live.$disconnect();

if (open && !flag("force")) {
  console.error(
    `Sync run ${open.id} is still RUNNING. Close the app and let it finish, or pass --force if you know it is stale.`,
  );
  process.exit(1);
}

ensureLoopDir();

for (const suffix of ["", "-journal", "-wal", "-shm"]) {
  const source = LIVE_DB + suffix;
  const target = WORK_DB + suffix;
  if (fs.existsSync(source)) fs.copyFileSync(source, target);
  else if (fs.existsSync(target)) fs.rmSync(target);
}

// The copy has to be at the schema the code expects. A change that adds a
// column arrives in the live database through a migration, and the scratch
// copy is a copy of whatever the live database was when it was taken.
execFileSync("npx", ["prisma", "migrate", "deploy"], {
  env: { ...process.env, DATABASE_URL: dbUrl(WORK_DB) },
  stdio: ["ignore", "ignore", "inherit"],
  shell: true,
});

writeJson(SNAPSHOT_STATE, { at: new Date().toISOString(), costUsdBefore: spentBefore });

const size = fs.statSync(WORK_DB).size;
console.log(`Copied ${LIVE_DB}`);
console.log(`     to ${WORK_DB}  (${(size / 1024).toFixed(0)} kB)`);
console.log(`Classification has cost ${spentBefore.toFixed(4)} so far. cost.pass_usd counts from here.`);
console.log(`Everything the loop produces stays under ${LOOP_DIR}, which is gitignored.`);
