/**
 * Applicant tracking systems. Two jobs:
 *   1. The sender domain sweep (D5), which is not narrowed by keywords.
 *   2. The blocklist that stops a vendor being returned as the employer (3.3).
 */
export const ATS_VENDORS = [
  { vendor: "Greenhouse", domains: ["greenhouse.io", "us.greenhouse-mail.io", "greenhouse-mail.io"] },
  { vendor: "Lever", domains: ["lever.co", "hire.lever.co"] },
  { vendor: "Workday", domains: ["myworkday.com", "myworkdayjobs.com", "workday.com"] },
  { vendor: "Ashby", domains: ["ashbyhq.com", "ashbyhq.io"] },
  { vendor: "iCIMS", domains: ["icims.com"] },
  { vendor: "SmartRecruiters", domains: ["smartrecruiters.com", "smartrecruiters.io"] },
  { vendor: "Taleo", domains: ["taleo.net", "taleo.com"] },
  { vendor: "Jobvite", domains: ["jobvite.com", "jobvite.net"] },
  { vendor: "Workable", domains: ["workable.com", "workablemail.com"] },
  { vendor: "SuccessFactors", domains: ["successfactors.com", "sap.com"] },
  { vendor: "BambooHR", domains: ["bamboohr.com"] },
  { vendor: "Rippling", domains: ["rippling.com", "rippling-ats.com"] },
  { vendor: "Breezy", domains: ["breezy.hr"] },
  { vendor: "Recruitee", domains: ["recruitee.com"] },
  { vendor: "Teamtailor", domains: ["teamtailor.com"] },
  { vendor: "Paylocity", domains: ["paylocity.com"] },
  { vendor: "Dayforce", domains: ["dayforcehcm.com", "ceridian.com"] },
  { vendor: "Oracle Recruiting", domains: ["oraclecloud.com"] },
  { vendor: "Eightfold", domains: ["eightfold.ai"] },
  { vendor: "Phenom", domains: ["phenompeople.com"] },
  { vendor: "Avature", domains: ["avature.net"] },
  { vendor: "HireVue", domains: ["hirevue.com"] },
  { vendor: "CodeSignal", domains: ["codesignal.com"] },
  { vendor: "HackerRank", domains: ["hackerrank.com"] },
  { vendor: "Karat", domains: ["karat.com"] },
  { vendor: "Modern Hire", domains: ["modernhire.com"] },
  { vendor: "Gem", domains: ["gem.com", "gemhq.com"] },
  { vendor: "Pinpoint", domains: ["pinpointhq.com"] },
] as const;

export const ATS_DOMAINS: string[] = ATS_VENDORS.flatMap((entry) => [...entry.domains]);

/** Names that may never be returned as the employer (3.3). */
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

/** The vendor behind a sender domain, or null when it is not an ATS. */
export function vendorForDomain(domain: string | null | undefined): string | null {
  if (!domain) return null;
  const lower = domain.toLowerCase();
  for (const entry of ATS_VENDORS) {
    if (entry.domains.some((d) => lower === d || lower.endsWith("." + d))) return entry.vendor;
  }
  return null;
}

/** True when the model handed back an ATS vendor instead of the employer. */
export function isBlockedCompany(name: string | null | undefined): boolean {
  if (!name) return false;
  const lower = name.trim().toLowerCase();
  if (!lower) return true;
  return ATS_BLOCKLIST.some((blocked) => lower === blocked || lower.startsWith(blocked + " "));
}
