/**
 * Shared plumbing for the loop harness.
 *
 * Everything here is deterministic on purpose. A score is only worth reading
 * when the only thing that moved between two runs is the change being tested,
 * so nothing in the harness may depend on the clock, on a random number, or on
 * the order rows happen to come back in.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

export const ROOT = process.cwd();
export const LOOP_DIR = path.join(ROOT, "loop");
export const WORK_DB = path.join(LOOP_DIR, "work.db");
export const LIVE_DB = path.join(ROOT, "prisma", "tracker.db");
export const REVIEW_SHEET = path.join(LOOP_DIR, "review.md");
export const LABELS_APPLICATIONS = path.join(LOOP_DIR, "labels.applications.json");
export const LABELS_MESSAGES = path.join(LOOP_DIR, "labels.messages.json");
export const SCORECARD = path.join(LOOP_DIR, "scorecard.md");
export const HISTORY = path.join(LOOP_DIR, "history.jsonl");
export const LAST_RESULT = path.join(LOOP_DIR, "last-result.json");
export const REPORT = path.join(LOOP_DIR, "report.md");
/** What was true of the live database at the moment the copy was taken. */
export const SNAPSHOT_STATE = path.join(LOOP_DIR, "snapshot.json");
/** The floor every inherited metric may not fall below. */
export const FLOORS = path.join(LOOP_DIR, "floors.json");
/**
 * What the sampled intake audit found. Its own file rather
 * than a line in the replay, because it is bought rather than computed and a
 * free iteration has to be able to report the last reading without paying for
 * a new one.
 */
export const INTAKE_AUDIT = path.join(LOOP_DIR, "intake-audit.json");

export function ensureLoopDir(): void {
  fs.mkdirSync(LOOP_DIR, { recursive: true });
}

/** Prisma wants a URL. On Windows a bare path is read relative to the schema. */
export function dbUrl(file: string): string {
  return `file:${file.replace(/\\/g, "/")}`;
}

export function openDb(file: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: dbUrl(file) } } });
}

export function openWorkDb(): PrismaClient {
  if (!fs.existsSync(WORK_DB)) {
    throw new Error("There is no loop/work.db yet. Run npm run loop:snapshot first.");
  }
  return openDb(WORK_DB);
}

/**
 * FNV-1a, 32 bit. Any stable hash would do. What matters is that it is written
 * here rather than taken from the runtime, so the tune and hold out split can
 * never drift between machines or between versions of Node.
 */
export function hash32(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 60% of labelled groups tune, the other 40% held out. */
export const TUNE_SHARE = 60;

export type Half = "TUNE" | "HOLDOUT";

export function halfOf(groupId: string): Half {
  return hash32(groupId) % 100 < TUNE_SHARE ? "TUNE" : "HOLDOUT";
}

/** Reads a JSON file, or returns the fallback when it is not there yet. */
export function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export function writeJson(file: string, value: unknown): void {
  ensureLoopDir();
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

export type MessageLabel = {
  related: boolean;
  /** True when this email records a real new milestone, rather than repeating one. */
  significant: boolean;
  /**
   * The email whose line in the drawer this one is shown under, or null when it
   * holds a line of its own. A different question from `significant`, and both
   * are labelled, because one decides where an email is shown and the other
   * decides whether it records a change of state.
   */
  parent?: string | null;
  /** REPEAT | REMINDER | UPDATE. Null exactly when `parent` is null. */
  relation?: string | null;
  /**
   * What this email asks of the applicant, and what kind of report it is. Both
   * are null on an email they do not apply to, and both are labelled from the
   * email itself rather than from anything the pipeline
   * currently answers, which is the only thing that makes a paid pass
   * judgeable rather than a matter of opinion.
   */
  stage?: string | null;
  event?: string | null;
  /**
   * Which ending this application reached, on the email that announced it.
   * Null on every email that announces no ending, which is almost all of them.
   * Labelled from the email rather than from anything the
   * pipeline can currently store, because a stored value that says one word
   * for three different endings is the thing being measured.
   */
  outcome?: string | null;
  /**
   * Every group this email belongs to, when it belongs to more than one.
   * Absent on almost every message, and read only where it is set. Derived
   * from the sheet rather than written by hand: an email listed
   * under two blocks is one that covers two applications.
   *
   * It holds the whole pairing rather than the group id alone, because a
   * drawer parent is a fact about the pairing and not about the email: an
   * email in two applications sits under a different line in each, which is
   * the whole argument for the membership table.
   */
  groups?: { id: string; parent: string | null; relation: string | null }[] | null;
  why?: string;
};

/**
 * The vocabulary the labels are written in, taken from what the hiring world
 * does rather than from anything this mailbox happens to contain.
 *
 * It lives here rather than in `@/lib/constants` because the labels describe
 * the hiring world and the constants describe what the pipeline can currently
 * say. A label the code cannot yet produce is exactly the thing being
 * measured.
 */
export const LABEL_STAGES = [
  "ASSESSMENT",          // something marked, with right answers
  "RECORDED_INTERVIEW",  // something completed alone, reviewed later by a person
  "INTERVIEW",           // something scheduled, live, with a person
  "VERIFICATION",        // something supplied or consented to, checked rather than judged
] as const;

export const LABEL_EVENTS = [
  "CONFIRMATION",  // something the applicant did has been received
  "INVITATION",    // the applicant is asked to do something
  "REMINDER",      // the applicant has already been asked, and this repeats the ask
  "COMPLETION",    // something the applicant did is finished or has been received
  "REQUEST",       // something is needed from the applicant before this can proceed
  "CANCELLATION",  // something already arranged is now not happening
  "DECISION",      // an outcome, in either direction
  "UPDATE",        // anything else, and the defined fallback
] as const;

/**
 * Which ending an application reached.
 *
 * The same partition idea as the stages: defined by what happened rather than
 * by what anybody called it. Four of these are stored ACCEPTED today and three
 * are stored REJECTED, which is why the labels have to be able to say them
 * before the pipeline can be judged on them at all.
 */
export const LABEL_OUTCOMES = [
  "OFFER_EXTENDED",         // an offer is on the table and unanswered
  "OFFER_ACCEPTED",         // the applicant took it
  "OFFER_DECLINED",         // the applicant turned it down
  "OFFER_RESCINDED",        // the employer took it back
  "REJECTED_BY_EMPLOYER",   // turned down
  "WITHDRAWN_BY_APPLICANT", // the applicant pulled out
  "POSTING_CANCELLED",      // the role went away, nobody was turned down
] as const;

/** What loop:snapshot recorded about the live database when it took the copy. */
export type SnapshotState = { at: string; costUsdBefore: number };

export type GroupLabel = {
  id: string;
  messages: string[];
  company: string | null;
  role: string | null;
  season: string | null;
  year: number | null;
  status: string | null;
};

export type ApplicationLabels = { revision: string; groups: GroupLabel[] };
export type MessageLabels = Record<string, MessageLabel>;

export function readLabels(): { applications: ApplicationLabels; messages: MessageLabels } {
  return {
    applications: readJson<ApplicationLabels>(LABELS_APPLICATIONS, { revision: "none", groups: [] }),
    messages: readJson<MessageLabels>(LABELS_MESSAGES, {}),
  };
}

/**
 * A short fingerprint of the label files, recorded on every scorecard. An
 * iteration that disagrees with a label is sometimes the label being wrong, so
 * a score is only comparable to another one taken against the same labels.
 */
export function labelRevision(): string {
  const parts = [LABELS_APPLICATIONS, LABELS_MESSAGES].map((file) =>
    fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "",
  );
  return hash32(parts.join(" ")).toString(16).padStart(8, "0");
}

/**
 * `--sample N` takes the N ids that hash lowest, so two runs of the same size
 * read the same emails. A random sample would make every difference ambiguous.
 */
export function deterministicSample<T>(items: T[], keyOf: (item: T) => string, n: number): T[] {
  return [...items]
    .map((item) => ({ item, key: hash32(keyOf(item)) }))
    .sort((a, b) => a.key - b.key || keyOf(a.item).localeCompare(keyOf(b.item)))
    .slice(0, n)
    .map((row) => row.item);
}

export function arg(name: string): string | null {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  const inline = process.argv.find((value) => value.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : null;
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** yyyy-mm-dd, in UTC, so a scorecard reads the same wherever it is opened. */
export function day(value: Date): string {
  return value.toISOString().slice(0, 10);
}
