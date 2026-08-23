/**
 * Applicant tracking systems. Three jobs:
 *   1. The sender domain sweep, which is not narrowed by keywords.
 *   2. The blocklist that stops a vendor being returned as the employer.
 *   3. Which of two kinds of go between sent an email (LOOP2 Invariant 1).
 *
 * `kind` is wrong in both directions if mislabelled. PLATFORM sends the
 * employer's own mail and can begin an application; call one ASSESSMENT and
 * those rows stop being created. ASSESSMENT runs exams and has never received
 * an application, so it can only continue one; call one PLATFORM and its exams
 * split applications in two.
 *
 * This is a fact about what those businesses are rather than about any one
 * mailbox, which is why it can live in a list at all.
 */
export const ATS_VENDORS = [
  { vendor: "Greenhouse", kind: "PLATFORM", domains: ["greenhouse.io", "us.greenhouse-mail.io", "greenhouse-mail.io"] },
  { vendor: "Lever", kind: "PLATFORM", domains: ["lever.co", "hire.lever.co"] },
  { vendor: "Workday", kind: "PLATFORM", domains: ["myworkday.com", "myworkdayjobs.com", "workday.com"] },
  { vendor: "Ashby", kind: "PLATFORM", domains: ["ashbyhq.com", "ashbyhq.io"] },
  { vendor: "iCIMS", kind: "PLATFORM", domains: ["icims.com"] },
  { vendor: "SmartRecruiters", kind: "PLATFORM", domains: ["smartrecruiters.com", "smartrecruiters.io"] },
  { vendor: "Taleo", kind: "PLATFORM", domains: ["taleo.net", "taleo.com"] },
  { vendor: "Jobvite", kind: "PLATFORM", domains: ["jobvite.com", "jobvite.net"] },
  { vendor: "Workable", kind: "PLATFORM", domains: ["workable.com", "workablemail.com"] },
  { vendor: "SuccessFactors", kind: "PLATFORM", domains: ["successfactors.com", "sap.com"] },
  { vendor: "BambooHR", kind: "PLATFORM", domains: ["bamboohr.com"] },
  { vendor: "Rippling", kind: "PLATFORM", domains: ["rippling.com", "rippling-ats.com"] },
  { vendor: "Breezy", kind: "PLATFORM", domains: ["breezy.hr"] },
  { vendor: "Recruitee", kind: "PLATFORM", domains: ["recruitee.com"] },
  { vendor: "Teamtailor", kind: "PLATFORM", domains: ["teamtailor.com"] },
  { vendor: "Paylocity", kind: "PLATFORM", domains: ["paylocity.com"] },
  { vendor: "Dayforce", kind: "PLATFORM", domains: ["dayforcehcm.com", "ceridian.com"] },
  { vendor: "Oracle Recruiting", kind: "PLATFORM", domains: ["oraclecloud.com"] },
  { vendor: "Eightfold", kind: "PLATFORM", domains: ["eightfold.ai"] },
  { vendor: "Phenom", kind: "PLATFORM", domains: ["phenompeople.com"] },
  { vendor: "Avature", kind: "PLATFORM", domains: ["avature.net"] },
  { vendor: "HireVue", kind: "ASSESSMENT", domains: ["hirevue.com"] },
  { vendor: "CodeSignal", kind: "ASSESSMENT", domains: ["codesignal.com"] },
  { vendor: "HackerRank", kind: "ASSESSMENT", domains: ["hackerrank.com", "hackerrankforwork.com"] },
  { vendor: "Karat", kind: "ASSESSMENT", domains: ["karat.com"] },
  { vendor: "Modern Hire", kind: "ASSESSMENT", domains: ["modernhire.com"] },
  { vendor: "Gem", kind: "PLATFORM", domains: ["gem.com", "gemhq.com"] },
  { vendor: "Pinpoint", kind: "PLATFORM", domains: ["pinpointhq.com"] },
  { vendor: "Codility", kind: "ASSESSMENT", domains: ["codility.com"] },
  { vendor: "Criteria", kind: "ASSESSMENT", domains: ["criteriacorp.com"] },
] as const;

export type VendorKind = "PLATFORM" | "ASSESSMENT";

export const ATS_DOMAINS: string[] = ATS_VENDORS.flatMap((entry) => [...entry.domains]);

/** Names that may never be returned as the employer. */
export const ATS_BLOCKLIST: string[] = [
  ...ATS_VENDORS.map((entry) => entry.vendor.toLowerCase()),
  "greenhouse software",
  "workday inc",
  "myworkday",
  "no reply",
  "noreply",
  "no-reply",
  "talent acquisition",
  "recruiting team",
  "recruiting",
  "careers",
  "human resources",
  "hr team",
  "unknown",
  "n/a",
  "none",
  "the hiring team",
  "hiring team",
];

/** The list entry behind a sender domain, or null when it is not an ATS. */
export function atsForDomain(domain: string | null | undefined) {
  if (!domain) return null;
  const lower = domain.toLowerCase();
  for (const entry of ATS_VENDORS) {
    if (entry.domains.some((d) => lower === d || lower.endsWith("." + d))) return entry;
  }
  return null;
}

/** The vendor behind a sender domain, or null when it is not an ATS. */
export function vendorForDomain(domain: string | null | undefined): string | null {
  return atsForDomain(domain)?.vendor ?? null;
}

/**
 * True when the sender runs exams rather than sending the employer's own mail.
 * A domain the list does not hold at all answers false, which is the safe way
 * round: an unknown sender behaves exactly as it does today.
 */
export function isAssessmentVendor(domain: string | null | undefined): boolean {
  return atsForDomain(domain)?.kind === "ASSESSMENT";
}

/** True when the model handed back an ATS vendor instead of the employer. */
export function isBlockedCompany(name: string | null | undefined): boolean {
  if (!name) return false;
  const lower = name.trim().toLowerCase();
  if (!lower) return true;
  return ATS_BLOCKLIST.some((blocked) => lower === blocked || lower.startsWith(blocked + " "));
}
