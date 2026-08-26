/**
 * Read what the code refused, by hand.
 *
 * Two numbers on the scorecard are advisory and watched rather than targets,
 * because both are meant to be above zero in a mailbox this code was not
 * written against:
 *
 *   identity.unnamed   the employer names the code would not accept as one
 *   term.unbucketed    the stated terms no bucket fits
 *
 * A count says how many. It does not say whether the refusal was right, and
 * that is the only question worth asking of a rule that consults a list of
 * names. So this prints the evidence: what the model answered, what kind of
 * sender it said the email came from, and enough of the email to judge it.
 *
 * It reads and changes nothing, and it costs nothing.
 *
 *   npm run loop:refusals [-- --chars 400]
 */
import { arg, openWorkDb } from "./common.mts";
import { classificationOf } from "@/lib/pipeline/recompute";
import { termBucket } from "@/lib/constants";
import { atsForDomain, isBlockedCompany } from "@/lib/ats";
import { normalizeTerm } from "@/lib/normalize";

const db = openWorkDb();
const chars = Number(arg("chars") ?? 320);

const messages = await db.emailMessage.findMany({
  where: { classificationStatus: "OK" },
  orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
  select: {
    gmailMessageId: true,
    subject: true,
    senderEmail: true,
    senderDomain: true,
    bodyText: true,
    isApplicationRelated: true,
    llmClassificationRaw: true,
    memberships: { select: { applicationId: true } },
  },
});

/** What the model wrote, before the parser decided what it could use. */
function said(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

console.log("=".repeat(78));
console.log("identity.unnamed: employer names the code would not accept");
console.log("=".repeat(78));

let refused = 0;
for (const message of messages) {
  const answer = said(message.llmClassificationRaw);
  const name = typeof answer?.company_name === "string" ? answer.company_name.trim() : "";
  if (!name || !isBlockedCompany(name)) continue;
  refused += 1;

  const vendor = atsForDomain(message.senderDomain);
  console.log("");
  console.log(`${message.gmailMessageId}  ${message.senderEmail}`);
  console.log(`  subject       ${message.subject}`);
  console.log(`  model said    company=${name}  sender_role=${answer?.sender_role}  role=${answer?.role_title}`);
  console.log(`  the list says ${vendor ? `${vendor.vendor}, a ${vendor.kind}` : "nothing about this sender's domain"}`);
  console.log(`  related       ${message.isApplicationRelated}  reached ${message.memberships.length} row(s)`);
  console.log(`  body          ${(message.bodyText ?? "").replace(/\s+/g, " ").slice(0, chars)}`);
}
console.log(`\n${refused} refused.`);

console.log("");
console.log("=".repeat(78));
console.log("term.unbucketed: stated terms, and which bucket each falls in");
console.log("=".repeat(78));
console.log("");

/** Every stated term, counted, so a term nobody uses is not read as a problem. */
const terms = new Map<string, { count: number; bucket: string | null; example: string }>();
for (const message of messages) {
  const term = classificationOf(message)?.term;
  if (!term) continue;
  const key = normalizeTerm(term);
  const seen = terms.get(key);
  if (seen) seen.count += 1;
  else terms.set(key, { count: 1, bucket: termBucket(term), example: term });
}

for (const [, row] of [...terms.entries()].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))) {
  console.log(`  ${String(row.count).padStart(3)}  ${row.example.padEnd(22)} -> ${row.bucket ?? "no bucket"}`);
}
const unbucketed = [...terms.values()].filter((row) => row.bucket === null);
console.log(`\n${terms.size} distinct terms stated, ${unbucketed.length} that no bucket fits.`);

console.log("");
console.log("=".repeat(78));
console.log("admit.unattached: application mail that reached no row");
console.log("=".repeat(78));

for (const message of messages) {
  if (!message.isApplicationRelated || message.memberships.length) continue;
  const answer = said(message.llmClassificationRaw);
  console.log("");
  console.log(`${message.gmailMessageId}  ${message.senderEmail}`);
  console.log(`  subject       ${message.subject}`);
  console.log(`  model said    company=${answer?.company_name}  sender_role=${answer?.sender_role}`);
  console.log(`  significant   ${answer?.is_significant}  outcome=${answer?.outcome}`);
}

console.log("");
await db.$disconnect();
