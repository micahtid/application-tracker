/**
 * Company name cleaning and loose role comparison (D14, D15).
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
 * An employer writes its own name three or four ways across one hiring
 * process, and the mail headers genuinely support all of them. No prompt stops
 * that varying, so the variation is absorbed here, where it is cheap and
 * testable, rather than demanded of the model.
 *
 * Two names mean the same employer when one is a token subset of the other, or
 * when they are the same once the spaces are taken out. Sharing a first word is
 * not enough on its own: the role comparison still has to agree before
 * anything is merged.
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
  "summer", "spring", "fall", "winter", "2024", "2025", "2026", "2027", "2028",
  "the", "a", "an", "and", "for", "of", "at", "in", "to", "role", "position",
  "opportunity", "job", "opening", "i", "ii", "iii", "new", "grad", "student",
]);

function roleTokens(role: string): Set<string> {
  return new Set(
    role
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((word) => word && !ROLE_NOISE.has(word)),
  );
}

/**
 * 0 to 1, by shared words. Runs only inside a candidate set of one or two rows,
 * never across the table, so a plain set overlap is enough.
 *
 * The comparison is symmetric: the words the two titles share, over every word
 * either of them uses. Measuring against the shorter title instead would make
 * a short generic title a subset of every long one, so a two word posting
 * would swallow every detailed posting at the same employer. Words only one
 * side has are exactly the evidence that these are two different jobs, and
 * they have to count.
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
 * A subject line reduced to what it actually says, so a resend of a notice can
 * be recognised as the same notice.
 *
 * The reply and forward markers go, along with the reminder markers an
 * applicant tracking system puts in front of a message it is sending a second
 * time. Then punctuation and spacing collapse, and a reference number trailing
 * off the end goes too, since a system that renumbers each send is still
 * sending the same notice.
 */
const SUBJECT_PREFIX = /^\s*(?:re|fw|fwd|reminder|resending|resend|second notice|action required)\s*[:\-]\s*/i;

/**
 * The markers a system puts in front of a message it is sending as a nudge,
 * read off the subject before anything is normalised away.
 *
 * Narrower than SUBJECT_PREFIX on purpose. "Action required" is how plenty of
 * systems word a first invitation, so it collapses into the same notice for
 * the purpose of spotting a resend, but it is not a reminder about anything.
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
 * Whether two stated role titles are about the same posting (LOOP Invariant 9).
 *
 * One title's words all appear in the other's. Employers advertise a family of
 * postings under one wording with one word changed for the place or the track,
 * and every email about a single posting quotes its title either exactly or
 * with extra decoration around it. So a word that only one side has is not
 * noise to be outvoted by the words they share, it is the whole difference
 * between the two postings.
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
 * Applicant tracking systems stamp every posting with a number and quote it
 * back in the mail they send. It is the only thing in an application email
 * that is guaranteed to differ between two postings at one employer, and it
 * survives every rewording of the title.
 *
 * Two shapes are read, and no others:
 *
 *   - anywhere, a number introduced by a word that says what it is, such as
 *     "Job number: 200046156" or "(ID: 10501526)",
 *   - in the subject only, a long number fenced off by dashes or brackets,
 *     which is how a subject line carries one without naming it.
 *
 * The subject rule is not applied to the body, because a body is full of
 * tracking links and long digit strings that mean nothing.
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
 * Joins the identity parts, with empty strings for the missing ones (3.5).
 *
 * The posting number is part of the key when the emails state one, because two
 * postings at one employer are routinely advertised under exactly the same
 * title. Without it the key would say two separate applications are the same
 * row, and the safety net that reuses a row on a matching key would then undo
 * a split that the matching rules got right.
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
