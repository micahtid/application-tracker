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
  LABEL_EVENTS,
  LABEL_STAGES,
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
/** The line an indented line below it belongs to. Cleared by every new group. */
let lastTopLevel: string | null = null;

const FIELD = /^-\s*(company|role|season|year|status)\s*:\s*(.*)$/i;
const GROUPED = /^-\s*([0-9a-f]{6,32})\s*\|(.*)$/i;
const SAMPLED = /^-\s*([0-9a-f]{6,32})\s*\|\s*related\s*:\s*(yes|no)\b\s*\|(.*)$/i;

/**
 * The `key:value` chips a message line carries, read in whatever order they
 * appear and stopping at the first thing that is not one.
 *
 * Written as a scan rather than as one long pattern because the sheet gained
 * two chips in LOOP3 and will gain more. A pattern that spells out every
 * combination has to be rewritten each time, and the failure when it is not is
 * a line silently read as unparseable prose.
 */
const CHIP = /^\s*(sig|stage|event|rel)\s*:\s*([A-Za-z_-]*)\s*$/;

function chipsOf(tail: string): { chips: Map<string, string>; unknown: string | null } {
  const chips = new Map<string, string>();
  for (const part of tail.split("|")) {
    const match = part.match(CHIP);
    if (!match) break;                       // the date and the subject, from here on
    const [, key, value] = match;
    if (chips.has(key.toLowerCase())) return { chips, unknown: `${key} appears twice` };
    chips.set(key.toLowerCase(), value.trim());
  }
  return { chips, unknown: null };
}

/** `-` is how every field on the sheet says "genuinely empty". */
function oneOf(raw: string | undefined, allowed: readonly string[]): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === "" || raw === "-") return null;
  const upper = raw.toUpperCase();
  return allowed.includes(upper) ? upper : undefined;
}

/**
 * Two spaces means "shown under the nearest line above with less indentation".
 * Anything deeper is an error rather than a deeper tree, because the drawer is
 * one level and a grandchild would have no meaning to read (LOOP2 3.2 rule 3).
 */
const INDENT = 2;

function value(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === "" || trimmed === "-" ? null : trimmed;
}

function closeGroup(): void {
  lastTopLevel = null;
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

    const [, id, tail] = messageMatch;
    const { chips, unknown } = chipsOf(tail);
    if (unknown) { problems.push(`line ${at}: ${unknown}`); return; }

    const sig = chips.get("sig");
    if (sig !== "yes" && sig !== "no") {
      problems.push(`line ${at}: sig: must be yes or no, not "${sig ?? ""}"`);
      return;
    }
    const rel = chips.get("rel");
    if (rel !== undefined && !["REPEAT", "REMINDER", "UPDATE"].includes(rel.toUpperCase())) {
      problems.push(`line ${at}: rel: "${rel}" is not REPEAT, REMINDER or UPDATE`);
      return;
    }

    const stage = oneOf(chips.get("stage"), LABEL_STAGES);
    if (stage === undefined && chips.has("stage")) {
      problems.push(`line ${at}: stage: "${chips.get("stage")}" is not one of ${LABEL_STAGES.join(", ")}`);
      return;
    }
    const event = oneOf(chips.get("event"), LABEL_EVENTS);
    if (event === undefined && chips.has("event")) {
      problems.push(`line ${at}: event: "${chips.get("event")}" is not one of ${LABEL_EVENTS.join(", ")}`);
      return;
    }

    const already = seenIn.get(id);
    if (already) {
      problems.push(`line ${at}: message ${id} is in both ${already} and ${current.id}`);
      return;
    }

    const depth = line.length - line.trimStart().length;
    if (depth % INDENT) {
      problems.push(`line ${at}: indented ${depth} spaces, which is not a whole number of levels`);
      return;
    }
    if (depth > INDENT) {
      problems.push(`line ${at}: indented ${depth} spaces. The drawer is one level deep, so a child of a child is an error`);
      return;
    }
    if (depth === INDENT && !lastTopLevel) {
      problems.push(`line ${at}: indented, but there is no line above it in this group to sit under`);
      return;
    }
    const parent = depth === INDENT ? lastTopLevel : null;
    if (rel && !parent) {
      problems.push(`line ${at}: rel: on a line that is not indented. A relation without a parent is half a fact`);
      return;
    }

    seenIn.set(id, current.id);
    current.messages.push(id);
    if (!parent) lastTopLevel = id;
    messages[id] = {
      related: true,
      significant: sig.toLowerCase() === "yes",
      parent,
      relation: parent ? (rel ? rel.toUpperCase() : "UPDATE") : null,
      stage: stage ?? null,
      event: event ?? null,
    };
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
    parent: null,
    relation: null,
    stage: null,
    event: null,
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
const children = Object.values(messages).filter((label) => label.parent).length;
const relatedSampled = Object.values(messages).filter((label) => label.related).length - grouped;

console.log(`Wrote ${LABELS_APPLICATIONS}`);
console.log(`      ${LABELS_MESSAGES}`);
console.log(`  ${groups.length} groups over ${grouped} messages`);
console.log(`  ${children} of them are shown under an earlier email, ${grouped - children} hold a line of their own`);
console.log(`  ${Object.keys(messages).length} messages labelled in total`);
console.log(
  `  ${Object.values(messages).filter((label) => label.stage).length} carry a stage, ${Object.values(messages).filter((label) => label.event).length} carry an event`,
);
console.log(`  ${relatedSampled} of the sampled not related messages were marked related after all`);
