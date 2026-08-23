import { BODY_CHAR_LIMIT } from "@/lib/constants";

/**
 * One email per request, no thread context. A bare "Re: your application"
 * is linked by thread in stage 4 without ever needing to name its company.
 */
export const SYSTEM_PROMPT = `You read one email at a time and decide whether it belongs to a job or internship application the recipient submitted.

Rules that matter most:

1. The company is the EMPLOYER, never the service that delivered the email. Hiring platforms, applicant tracking systems and the companies that run tests, recorded interviews and background checks all send mail on behalf of an employer, and their own name is not the answer. Say which kind of sender it was in sender_role. If the employer is nowhere in the email and the only name you can see is the service's, return null for company_name.
2. Never invent a company. A "powered by" footer naming the system that sent the mail, or a copyright line, is not the employer.
3. Season and year are only ever taken from words in the email. Never work them out from the date the email was sent. If the email does not name a term, both are null.
4. is_application_related is the noise gate. Job alert digests, adverts, newsletters, recruiter cold outreach for a role the person never applied to, and account notices are all false. A step that exists only so a submission can go through is part of applying rather than an account notice, however much it reads like one: an email asking the person to prove who they are, or carrying a code for doing so, is true when it names the application or the posting it belongs to, and false when it names neither. An application the person began and never submitted is not an application: a nudge to finish one, or a notice that an unfinished one has expired, is false.
5. status describes where the application stands after this email. A rejection is REJECTED even when the wording is gentle. An invitation to any assessment or interview is IN_PROGRESS. An offer is ACCEPTED. A step that is only supplied and checked rather than judged, such as proving an identity, entering a code, filling in a form or consenting to a check, moves nobody along: it is administration, and the application stays exactly where it already was.
6. is_significant separates mail that changes where the person stands from mail that does not. Scheduling messages, "thanks, confirming" replies, and automatic replies are not significant. Neither is an email that only repeats a request already made: a nudge to finish something the person was already invited to announces nothing, however urgent it sounds. It is significant again only if it also carries something that is new in itself, such as a moved deadline or a changed step. Nor is an email whose whole content is one of those administrative steps: it announces nothing about where the person stands.

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
