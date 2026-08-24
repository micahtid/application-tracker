/**
 * Company name cleaning and loose role comparison.
 * Both are deliberately plain: predictable beats clever when a wrong match
 * silently splits or merges applications.
 */

const LEGAL_ENDINGS = [
  "inc", "inc.", "llc", "l.l.c", "ltd", "ltd.", "limited", "corp", "corp.",
  "corporation", "co", "co.", "company", "plc", "gmbh", "ag", "sa", "s.a",
  "nv", "bv", "ab", "oy", "as", "pty", "pte", "llp", "lp", "group", "holdings",
];

export function normalizeCompany(name: string): string {
  let value = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")   // fold accents
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")       // collapse punctuation
    .trim();

  if (value.startsWith("the ")) value = value.slice(4);

  const words = value.split(" ").filter(Boolean);
  while (words.length > 1 && LEGAL_ENDINGS.includes(words[words.length - 1])) words.pop();

  // Removing a legal ending can leave the word that joined it to the name
  // hanging off the end, which is how "X & Co." becomes "x and". A connector
  // with nothing after it is not part of anybody's name.
  while (words.length > 1 && CONNECTORS.includes(words[words.length - 1])) words.pop();

  return words.join(" ");
}

const CONNECTORS = ["and", "of", "the", "for"];

/**
 * Whether two normalised names mean the same employer (LOOP Invariant 2).
 *
 * True when one name's words are all present in the other, or when the two are
 * equal once spaces are removed. One employer writes itself several ways over
 * one hiring process, so the variation is absorbed here rather than asked of
 * the model. Sharing a first word is not enough on its own: the role
 * comparison still has to agree before anything is merged.
 */
export function sameEmployer(left: string, right: string): boolean {
  if (!left || !right) return false;
  if (left === right) return true;

  const a = new Set(left.split(" ").filter(Boolean));
  const b = new Set(right.split(" ").filter(Boolean));
  const contains = (bigger: Set<string>, smaller: Set<string>) =>
    [...smaller].every((token) => bigger.has(token));

  if (contains(a, b) || contains(b, a)) return true;

  // Some employers write themselves as one word and their systems write them
  // as two, which no comparison of tokens can see through.
  return left.replace(/ /g, "") === right.replace(/ /g, "");
}

/** Every leading run of tokens: "a b c" gives "a", "a b", "a b c". */
export function namePrefixes(normalized: string): string[] {
  const tokens = normalized.split(" ").filter(Boolean);
  return tokens.map((_, index) => tokens.slice(0, index + 1).join(" "));
}

const ROLE_NOISE = new Set([
  "intern", "internship", "interns", "co", "op", "coop", "program", "programme",
  "summer", "spring", "fall", "winter",
  "the", "a", "an", "and", "for", "of", "at", "in", "to", "role", "position",
  "opportunity", "job", "opening", "i", "ii", "iii", "new", "grad", "student",
]);

/**
 * A year in a job title, matched as a shape rather than listed (LOOP3
 * Invariant 1). A list of named years expires: once past the last one, two
 * emails about one posting stop matching and one application becomes two, on a
 * date rather than in a mailbox.
 *
 * Posting numbers are longer, and are read separately by `requisitionNumbers`.
 */
const YEAR = /^\d{4}$/;

function roleTokens(role: string): Set<string> {
  return new Set(
    role
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((word) => word && !ROLE_NOISE.has(word) && !YEAR.test(word)),
  );
}

/**
 * 0 to 1, by shared words: what the two titles share over every word either
 * uses. Symmetric on purpose. Measuring against the shorter title would make a
 * generic two word posting a subset of every detailed one at the employer, and
 * the words only one side has are the evidence that these are different jobs.
 *
 * Runs only inside a candidate set of one or two rows, so a plain overlap is
 * enough.
 */
export function roleSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const left = roleTokens(a);
  const right = roleTokens(b);
  if (!left.size || !right.size) return 0;

  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/**
 * A subject reduced to what it says, so a resend reads as the same notice.
 * Reply, forward and reminder markers go, punctuation and spacing collapse,
 * and a reference number trailing off the end goes too, since a system that
 * renumbers each send is still sending the same notice.
 */
const SUBJECT_PREFIX = /^\s*(?:re|fw|fwd|reminder|resending|resend|second notice|action required)\s*[:\-]\s*/i;

/**
 * The markers that mark a nudge, read before anything is normalised away.
 * Narrower than SUBJECT_PREFIX: "action required" is how many systems word a
 * first invitation, so it collapses a resend without being a reminder.
 */
const REMINDER_MARKER = /\b(?:reminder|resending|resend|second notice)\b\s*[:\-]/i;

export function hasReminderMarker(subject: string | null | undefined): boolean {
  return REMINDER_MARKER.test(subject ?? "");
}

export function normalizeSubject(subject: string | null | undefined): string {
  let value = (subject ?? "").trim();

  let stripped = true;
  while (stripped) {
    const next = value.replace(SUBJECT_PREFIX, "");
    stripped = next !== value;
    value = next;
  }

  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/(?:\s+\d{4,12})+$/, "")
    .trim();
}

/** Above this two roles rank as the better of several candidates (Phase 4). */
export const ROLE_MATCH_THRESHOLD = 0.5;

/**
 * Whether two stated titles are about the same posting (LOOP Invariant 9).
 * True when one title's words all appear in the other's. Employers advertise a
 * family of postings under one wording with a word changed for the place or
 * track, so a word only one side has is the difference between them rather
 * than noise.
 *
 * Silence is not disagreement: an email stating no role matches anything.
 */
export function rolesMatch(left: string | null, right: string | null): boolean {
  if (!left || !right) return true;

  const a = roleTokens(left);
  const b = roleTokens(right);
  if (!a.size || !b.size) return true;

  const contains = (bigger: Set<string>, smaller: Set<string>) =>
    [...smaller].every((token) => bigger.has(token));

  return contains(a, b) || contains(b, a);
}

/**
 * Whether two stated titles are word for word the same posting, once the
 * noise words and the year are taken out (LOOP4 Decision 5).
 *
 * Stricter than `rolesMatch`, and deliberately so. `rolesMatch` is true when
 * one title's words are all present in the other's, which is right for
 * attaching an email and far too loose for writing an alias: an alias is a
 * standing claim about two employer names that every later message believes
 * and nothing ever removes. Silence is not agreement here either: a title
 * nobody stated is identical to nothing.
 */
export function rolesIdentical(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  const a = roleTokens(left);
  const b = roleTokens(right);
  if (!a.size || !b.size) return false;
  return a.size === b.size && [...a].every((token) => b.has(token));
}

/**
 * The posting number an applicant tracking system quotes back. It is the one
 * thing guaranteed to differ between two postings at one employer, and it
 * survives every rewording of the title.
 *
 * Two shapes are read, and no others:
 *
 *   - anywhere, a number introduced by a word saying what it is, such as
 *     "Job number: 200046156" or "(ID: 10501526)",
 *   - in the subject only, a long number fenced off by dashes or brackets.
 *
 * The fenced shape is not read from the body, which is full of tracking links
 * and long digit strings that mean nothing.
 */
const LABELLED_NUMBER =
  /\b(?:job|requisition|req|posting|position|vacancy|reference|ref|id)\s*(?:number|no\.?|id|code)?\s*[:#.\-]?\s*(\d{5,12})\b/gi;

const FENCED_NUMBER = /(?:^|[-–—(\[|])\s*(\d{6,12})\s*(?=$|[-–—)\]|,]|\s)/g;

export function requisitionNumbers(
  subject: string | null | undefined,
  bodyText?: string | null,
): Set<string> {
  const found = new Set<string>();

  for (const source of [subject ?? "", bodyText ?? ""]) {
    for (const match of source.matchAll(LABELLED_NUMBER)) found.add(match[1]);
  }
  for (const match of (subject ?? "").matchAll(FENCED_NUMBER)) found.add(match[1]);

  return found;
}

/**
 * True when both sides name a posting and they name different ones. Silence on
 * either side is not a disagreement: most employers never quote a number at
 * all, and a rejection rarely repeats the one from the confirmation.
 */
export function requisitionsDisagree(left: Set<string>, right: Set<string>): boolean {
  if (!left.size || !right.size) return false;
  for (const value of left) if (right.has(value)) return false;
  return true;
}

/**
 * Joins the identity parts, with empty strings for the missing ones.
 *
 * The posting number is part of the key whenever the emails state one, because
 * two postings at one employer are routinely advertised under the same title.
 * Without it the key would call two applications one row, undoing a split the
 * matching rules got right.
 */
export function dedupeKey(parts: {
  companyNormalized: string;
  roleTitle: string | null;
  season: string | null;
  year: number | null;
  requisitions?: Iterable<string>;
}): string {
  const role = (parts.roleTitle ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const requisition = [...(parts.requisitions ?? [])].sort().join(",");
  return [parts.companyNormalized, role, parts.season ?? "", parts.year ?? "", requisition].join("|");
}
