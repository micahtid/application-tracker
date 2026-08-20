/**
 * Read the edited sheet back into the two label files (LOOP 3.3).
 *
 * The sheet is the human surface and the JSON is the machine one. Anything the
 * parser cannot read is reported by line rather than guessed at, and a message
 * that appears in two groups is an error, not a merge.
 *
 *   npm run loop:label
 */
import fs from "node:fs";
import {
  LABELS_APPLICATIONS,
  LABELS_MESSAGES,
  REVIEW_SHEET,
  labelRevision,
  writeJson,
  type GroupLabel,
  type MessageLabels,
} from "./common.mts";

if (!fs.existsSync(REVIEW_SHEET)) {
  console.error(`There is no ${REVIEW_SHEET}. Run npm run loop:review first.`);
  process.exit(1);
}

const text = fs.readFileSync(REVIEW_SHEET, "utf8");
const lines = text.split(/\r?\n/);

const problems: string[] = [];
const groups: GroupLabel[] = [];
const messages: MessageLabels = {};
const seenIn = new Map<string, string>();

type Section = "none" | "applications" | "notRelated" | "prefilter" | "failed";
let section: Section = "none";
let current: GroupLabel | null = null;

const FIELD = /^-\s*(company|role|season|year|status)\s*:\s*(.*)$/i;
const GROUPED = /^-\s*([0-9a-f]{6,32})\s*\|\s*sig\s*:\s*(yes|no)\b\s*\|(.*)$/i;
const SAMPLED = /^-\s*([0-9a-f]{6,32})\s*\|\s*related\s*:\s*(yes|no)\b\s*\|(.*)$/i;

function value(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === "" || trimmed === "-" ? null : trimmed;
}

function closeGroup(): void {
  if (!current) return;
  // A block with no message lines is dropped: that is how a row that should
  // not exist is deleted.
  if (current.messages.length) groups.push(current);
  current = null;
}

lines.forEach((line, index) => {
  const at = index + 1;
  const trimmed = line.trim();

  if (/^##\s+Applications\b/i.test(trimmed)) { closeGroup(); section = "applications"; return; }
  if (/^##\s+Not related\b/i.test(trimmed)) { closeGroup(); section = "notRelated"; return; }
  if (/^##\s+Prefilter drops\b/i.test(trimmed)) { closeGroup(); section = "prefilter"; return; }
  if (/^##\s+Failed classification\b/i.test(trimmed)) { closeGroup(); section = "failed"; return; }
  if (/^#\s/.test(trimmed)) { closeGroup(); section = "none"; return; }

  if (section === "none" || section === "failed") return;

  if (/^###\s+/.test(trimmed)) {
    closeGroup();
    const id = trimmed.replace(/^###\s+/, "").trim();
    if (!id) problems.push(`line ${at}: a group heading with no id`);
    current = { id, messages: [], company: null, role: null, season: null, year: null, status: null };
    return;
  }

  if (!trimmed.startsWith("-")) return;                 // prose, notes, blank

  if (section === "applications") {
    const fieldMatch = trimmed.match(FIELD);
    if (fieldMatch) {
      if (!current) { problems.push(`line ${at}: a field outside any group`); return; }
      const [, name, raw] = fieldMatch;
      const parsed = value(raw);
      switch (name.toLowerCase()) {
        case "company": current.company = parsed; break;
        case "role": current.role = parsed; break;
        case "season": current.season = parsed; break;
        case "status": current.status = parsed ? parsed.toUpperCase() : null; break;
        case "year": {
          if (parsed === null) current.year = null;
          else if (/^\d{4}$/.test(parsed)) current.year = Number(parsed);
          else problems.push(`line ${at}: year "${parsed}" is not a four digit year`);
          break;
        }
      }
      return;
    }

    const messageMatch = trimmed.match(GROUPED);
    if (!messageMatch) { problems.push(`line ${at}: cannot read "${trimmed.slice(0, 60)}"`); return; }
    if (!current) { problems.push(`line ${at}: a message outside any group`); return; }

    const [, id, sig] = messageMatch;
    const already = seenIn.get(id);
    if (already) {
      problems.push(`line ${at}: message ${id} is in both ${already} and ${current.id}`);
      return;
    }
    seenIn.set(id, current.id);
    current.messages.push(id);
    messages[id] = { related: true, significant: sig.toLowerCase() === "yes" };
    return;
  }

  // The two recall sections. Only the related flag is labelled here.
  const sampledMatch = trimmed.match(SAMPLED);
  if (!sampledMatch) { problems.push(`line ${at}: cannot read "${trimmed.slice(0, 60)}"`); return; }

  const [, id, related] = sampledMatch;
  if (seenIn.has(id)) {
    problems.push(`line ${at}: message ${id} is both grouped and listed as not related`);
    return;
  }
  messages[id] = {
    related: related.toLowerCase() === "yes",
    significant: false,
    why: section === "prefilter" ? "dropped by the prefilter" : "judged not related",
  };
});

closeGroup();

const ids = new Set(groups.map((group) => group.id));
if (ids.size !== groups.length) problems.push("two groups share an id");

if (problems.length) {
  console.error(`${problems.length} problem${problems.length === 1 ? "" : "s"} in ${REVIEW_SHEET}:`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("Nothing was written.");
  process.exit(1);
}

writeJson(LABELS_APPLICATIONS, { revision: "pending", groups });
writeJson(LABELS_MESSAGES, messages);
// Written twice: the revision is a fingerprint of the files themselves, so it
// can only be worked out once they exist.
writeJson(LABELS_APPLICATIONS, { revision: labelRevision(), groups });

const grouped = groups.reduce((total, group) => total + group.messages.length, 0);
const relatedSampled = Object.values(messages).filter((label) => label.related).length - grouped;

console.log(`Wrote ${LABELS_APPLICATIONS}`);
console.log(`      ${LABELS_MESSAGES}`);
console.log(`  ${groups.length} groups over ${grouped} messages`);
console.log(`  ${Object.keys(messages).length} messages labelled in total`);
console.log(`  ${relatedSampled} of the sampled not related messages were marked related after all`);
