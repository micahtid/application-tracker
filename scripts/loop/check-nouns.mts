/**
 * Gate 2: no proper nouns in the diff.
 *
 * Reads every company name and sender domain out of the local database and
 * searches the added lines of the working diff for them. A hit fails the gate,
 * so it is impossible to hardcode an employer or an employer's mail domain and
 * have the change pass.
 *
 * Three details keep it from crying wolf, because plenty of real employers are
 * named after ordinary English words, and those words have innocent uses in
 * code:
 *
 *   - Matching is on whole words, ignoring case, and a one word name only
 *     counts when it appears capitalised the way it does in the mailbox, or
 *     inside a string literal. The same word lower case in a sentence is fine.
 *   - Names of two words or more are matched in full, which is where the real
 *     risk lies anyway. Nobody hardcodes the first word of a trading firm's
 *     name on its own. They hardcode the whole thing.
 *   - The loop planning documents, loop/ and the label files are excluded,
 *     since naming real employers is their whole job: a plan that could not
 *     say which two rows a defect is about would not be a plan.
 *
 * This comment is itself subject to the gate, which is the point: the check
 * refuses to describe itself using the names it exists to keep out.
 *
 * A hit that cannot be avoided is waived with a `// loop allow: <word>, <why>`
 * comment on the line.
 *
 *   npm run check:nouns
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { LIVE_DB, WORK_DB, openDb } from "./common.mts";
import { ATS_DOMAINS, ATS_VENDORS } from "@/lib/ats";

const EXCLUDED = [/^LOOP\d*\.md$/, /^loop\//, /^prisma\/.*\.db/, /^PRD\.md$/, /^PLANNING\.md$/, /^README\.md$/];

/**
 * The one standing exception. The vendor list names intermediaries rather than
 * employers, and it is already spelled out in PRD 3.3.
 */
const ALLOWED = new Set<string>([
  ...ATS_VENDORS.map((entry) => entry.vendor.toLowerCase()),
  ...ATS_DOMAINS,
]);

function git(...args: string[]): string {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

type AddedLine = { file: string; line: number; text: string };

function addedLines(): AddedLine[] {
  const out: AddedLine[] = [];

  const diff = git("diff", "HEAD", "--unified=0", "--no-color");
  let file = "";
  let lineNumber = 0;
  for (const raw of diff.split(/\r?\n/)) {
    if (raw.startsWith("+++ b/")) { file = raw.slice(6); continue; }
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) { lineNumber = Number(hunk[1]); continue; }
    if (raw.startsWith("+") && !raw.startsWith("+++")) {
      out.push({ file, line: lineNumber, text: raw.slice(1) });
      lineNumber += 1;
    }
  }

  // A brand new file has no diff context, so every line of it is an added line.
  for (const untracked of git("ls-files", "--others", "--exclude-standard").split(/\r?\n/)) {
    if (!untracked) continue;
    if (!fs.existsSync(untracked) || fs.statSync(untracked).isDirectory()) continue;
    if (/\.(db|db-journal|png|jpg|ico|lock)$/.test(untracked)) continue;
    const text = fs.readFileSync(untracked, "utf8");
    text.split(/\r?\n/).forEach((line, index) => {
      out.push({ file: untracked, line: index + 1, text: line });
    });
  }

  return out.filter((added) => added.file && !EXCLUDED.some((pattern) => pattern.test(added.file)));
}

const dbFile = fs.existsSync(WORK_DB) ? WORK_DB : LIVE_DB;
const db = openDb(dbFile);

const companies = new Set<string>();
for (const row of await db.application.findMany({ select: { companyName: true } })) {
  companies.add(row.companyName);
}
for (const row of await db.emailMessage.findMany({
  where: { llmClassificationRaw: { not: null } },
  select: { llmClassificationRaw: true },
})) {
  try {
    const name = JSON.parse(row.llmClassificationRaw!).company_name;
    if (typeof name === "string" && name.trim()) companies.add(name.trim());
  } catch {
    // A raw answer that will not parse has no company name to protect.
  }
}

const domains = new Set<string>();
for (const row of await db.emailMessage.findMany({
  where: { senderDomain: { not: null } },
  select: { senderDomain: true },
})) {
  if (row.senderDomain) domains.add(row.senderDomain.toLowerCase());
}
await db.$disconnect();

/** Domains are matched whole, including every parent of a subdomain. */
const domainNeedles = new Set<string>();
for (const domain of domains) {
  const parts = domain.split(".");
  for (let i = 0; i < parts.length - 1; i += 1) {
    const candidate = parts.slice(i).join(".");
    if (candidate.includes(".") && !ALLOWED.has(candidate)) domainNeedles.add(candidate);
  }
}

type Needle = { text: string; kind: "company" | "domain"; multiWord: boolean };

const needles: Needle[] = [];
for (const company of companies) {
  const words = company.split(/\s+/).filter(Boolean);
  if (!words.length) continue;
  if (ALLOWED.has(company.toLowerCase())) continue;
  needles.push({ text: company, kind: "company", multiWord: words.length > 1 });
}
for (const domain of domainNeedles) {
  needles.push({ text: domain, kind: "domain", multiWord: true });
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type Hit = { file: string; line: number; needle: string; kind: string; text: string };

const hits: Hit[] = [];

for (const added of addedLines()) {
  const waived = added.text.match(/\/\/\s*loop allow:\s*([^,]+)/i);
  const waiver = waived ? waived[1].trim().toLowerCase() : null;

  for (const needle of needles) {
    if (waiver && waiver === needle.text.toLowerCase()) continue;

    if (needle.multiWord) {
      const pattern = new RegExp(`(?<![\\w.-])${escape(needle.text)}(?![\\w-])`, "i");
      if (pattern.test(added.text)) {
        hits.push({ ...added, needle: needle.text, kind: needle.kind, text: added.text.trim() });
      }
      continue;
    }

    // A one word employer only counts capitalised the way the mailbox writes
    // it, or inside a string literal. Anything else is an ordinary English word.
    const exact = new RegExp(`(?<![\\w-])${escape(needle.text)}(?![\\w-])`);
    if (!exact.test(added.text)) continue;

    const inLiteral = new RegExp(`["'\`][^"'\`]*(?<![\\w-])${escape(needle.text)}(?![\\w-])[^"'\`]*["'\`]`, "i");
    const capitalised = new RegExp(`(?<![\\w-])${escape(needle.text)}(?![\\w-])`).test(added.text);
    if (inLiteral.test(added.text) || capitalised) {
      hits.push({ ...added, needle: needle.text, kind: needle.kind, text: added.text.trim() });
    }
  }
}

// A waiver only counts when it names something the gate would actually have
// stopped. A line merely describing the syntax is not a waiver.
const known = new Set(needles.map((needle) => needle.text.toLowerCase()));
const waivers = addedLines().filter((added) => {
  const match = added.text.match(/\/\/\s*loop allow:\s*([^,]+)/i);
  return match ? known.has(match[1].trim().toLowerCase()) : false;
});

if (hits.length) {
  console.error(`Gate 2 failed. ${hits.length} proper noun${hits.length === 1 ? "" : "s"} in the added lines:`);
  for (const hit of hits) {
    console.error(`  ${hit.file}:${hit.line}  ${hit.kind} "${hit.needle}"`);
    console.error(`    ${hit.text.slice(0, 110)}`);
  }
  console.error("");
  console.error("If the sentence describing this change needs a proper noun, the change is patchwork.");
  console.error("Write the general rule instead, or waive the line with: // loop allow: <word>, <why>");
  process.exit(1);
}

console.log(`Gate 2 passed. ${needles.length} names and domains checked against the added lines.`);
if (waivers.length) {
  console.log(`${waivers.length} waiver${waivers.length === 1 ? "" : "s"}:`);
  for (const waiver of waivers) console.log(`  ${waiver.file}:${waiver.line}  ${waiver.text.trim()}`);
}
console.log(`(names read from ${path.relative(process.cwd(), dbFile)})`);
