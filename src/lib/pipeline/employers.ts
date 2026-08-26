import { normalizeCompany, pairsToCompare, sameEmployer } from "@/lib/normalize";
import { commonestCompanyName } from "./recompute";

/**
 * One employer, one name on the board (LOOP5 Decision 3).
 *
 * `recomputeApplication` already picks the commonest wording an employer used,
 * but it picks it **within one row**, and no step looks across rows. Three
 * postings at one employer therefore stood on the board under two spellings of
 * its name, because two of the three rows had been told it one way and the
 * third had been told it another. Three rows is right. Two names for one
 * employer is not, and `identity.company` cannot see it, because it scores each
 * row against its own label.
 *
 * So it calls the same rule with a bigger set of emails: every email of every
 * row at one employer rather than every email of one row.
 *
 * **It is never written back to `company_name`.** `recomputeApplication`
 * derives `company_normalized` from `company_name`, and `company_normalized` is
 * half of `dedupe_key`. A display fix that wrote itself back would silently
 * rewrite identity for every row it touched.
 */

export type EmployerRow = {
  id: number;
  companyName: string;
  companyNormalized: string;
  messages: { receivedAt: Date; llmClassificationRaw: string | null }[];
};

/** An alias as it is stored: a normalised name and the name it stands for. */
export type AliasRow = { aliasNormalized: string; canonicalCompanyName: string };

/**
 * Smallest useful union find. Two names are one employer when the comparison
 * accepts them or when an alias says so, and both relations chain: if A is B
 * and B is C then all three are one employer and wear one name.
 */
function makeUnion() {
  const parent = new Map<string, string>();

  function find(value: string): string {
    const seen = parent.get(value);
    if (seen === undefined) {
      parent.set(value, value);
      return value;
    }
    if (seen === value) return value;
    const root = find(seen);
    parent.set(value, root);
    return root;
  }

  function union(left: string, right: string): void {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent.set(a, b);
  }

  return { find, union };
}

/**
 * Which employer each name belongs to, as a representative name.
 *
 * Narrowed by `pairsToCompare`, which is the one blocking rule
 * (LOOP5 Decision 1). Every pair `sameEmployer` would accept shares a key, so
 * narrowing here cannot drop a pair that is one employer, and the sweep in
 * `check:pipeline` is what says so.
 */
function employerOfName(names: string[], aliases: AliasRow[]): (name: string) => string {
  const { find, union } = makeUnion();
  const distinct = [...new Set(names.filter(Boolean))].sort();

  for (const [i, j] of pairsToCompare(distinct)) {
    if (sameEmployer(distinct[i], distinct[j])) union(distinct[i], distinct[j]);
  }

  // An alias is somebody's witnessed claim that two names with nothing in
  // common are one firm, which is the one thing blocking cannot derive
  // (LOOP5 Decision 2). Leaving it out here would draw an employer that trades
  // under a second, unrelated name under both of them, on a board that had
  // already decided they were one.
  for (const alias of aliases) {
    const canonical = normalizeCompany(alias.canonicalCompanyName);
    if (alias.aliasNormalized && canonical) union(alias.aliasNormalized, canonical);
  }

  return find;
}

/**
 * The name to draw each row under, keyed by application id.
 *
 * A row whose emails state no company at all keeps whatever the row already
 * says, because there is nothing to count and inventing a name is worse than
 * repeating one.
 */
export function displayCompanyNames(rows: EmployerRow[], aliases: AliasRow[] = []): Map<number, string> {
  const employerOf = employerOfName(
    rows.map((row) => row.companyNormalized),
    aliases,
  );

  // Every email at one employer, gathered so the wording rule sees the whole
  // set rather than one row of it.
  const atEmployer = new Map<string, EmployerRow["messages"]>();
  for (const row of rows) {
    const employer = employerOf(row.companyNormalized);
    const held = atEmployer.get(employer) ?? [];
    held.push(...row.messages);
    atEmployer.set(employer, held);
  }

  const chosen = new Map<string, string>();
  for (const [employer, messages] of atEmployer) {
    const name = commonestCompanyName(messages);
    if (name) chosen.set(employer, name);
  }

  return new Map(
    rows.map((row) => [row.id, chosen.get(employerOf(row.companyNormalized)) ?? row.companyName]),
  );
}
