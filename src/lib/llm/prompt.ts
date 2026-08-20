import { BODY_CHAR_LIMIT } from "@/lib/constants";
import { ATS_VENDORS } from "@/lib/ats";

/**
 * One email per request, no thread context (D17). A bare "Re: your application"
 * is linked by thread in stage 4 without ever needing to name its company.
 */
export const SYSTEM_PROMPT = `You read one email at a time and decide whether it belongs to a job or internship application the recipient submitted.

Rules that matter most:

1. The company is the EMPLOYER, never the applicant tracking system that delivered the email. ${ATS_VENDORS.map((v) => v.vendor).join(", ")} and similar services send mail on behalf of employers. If the only name you can see is one of those, return null for company_name.
2. Never invent a company. A footer such as "Powered by Greenhouse" or a copyright line is not the employer.
3. Season and year are only ever taken from words in the email. Never work them out from the date the email was sent. If the email does not name a term, both are null.
4. is_application_related is the noise gate. Job alert digests, adverts, newsletters, recruiter cold outreach for a role the person never applied to, and account notices are all false.
5. status describes where the application stands after this email. A rejection is REJECTED even when the wording is gentle. An invitation to any assessment or interview is IN_PROGRESS. An offer is ACCEPTED.
6. is_significant separates mail that changes where the person stands from mail that does not. Scheduling messages, "thanks, confirming" replies, and automatic replies are not significant.

Answer only with the structured object you were asked for.`;

export type EmailForPrompt = {
  senderName: string | null;
  senderEmail: string | null;
  subject: string | null;
  receivedAt: Date;
  bodyText: string | null;
};

export function buildUserContent(email: EmailForPrompt): string {
  const body = (email.bodyText ?? "").slice(0, BODY_CHAR_LIMIT);
  const sender = [email.senderName, email.senderEmail].filter(Boolean).join(" ");

  return [
    `From: ${sender || "unknown"}`,
    `Subject: ${email.subject ?? "(no subject)"}`,
    `Received: ${email.receivedAt.toISOString().slice(0, 10)}`,
    "",
    body || "(no body text)",
  ].join("\n");
}
