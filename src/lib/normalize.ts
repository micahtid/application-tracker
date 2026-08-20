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

  return words.join(" ");
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
 */
export function roleSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const left = roleTokens(a);
  const right = roleTokens(b);
  if (!left.size || !right.size) return 0;

  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

/** Above this two roles count as the same job (tuned in Phase 4). */
export const ROLE_MATCH_THRESHOLD = 0.5;

/** Joins the four identity parts, with empty strings for the missing ones (3.5). */
export function dedupeKey(parts: {
  companyNormalized: string;
  roleTitle: string | null;
  season: string | null;
  year: number | null;
}): string {
  const role = (parts.roleTitle ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return [parts.companyNormalized, role, parts.season ?? "", parts.year ?? ""].join("|");
}
