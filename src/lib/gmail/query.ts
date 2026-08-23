import { ATS_DOMAINS } from "@/lib/ats";

/**
 * Stage 1 sweeps. Two of them, combined by message id:
 *   1. Keyword phrases.
 *   2. Every message from a known ATS domain, not narrowed by keywords.
 *
 * Several small queries rather than one oversized `q`, because very long OR
 * lists fail.
 */

const KEYWORD_PHRASES = [
  '"thank you for applying"',
  '"thanks for applying"',
  '"we received your application"',
  '"your application has been received"',
  '"application received"',
  '"application confirmation"',
  '"we have received your application"',
  '"application submitted"',
  '"your application to"',
  '"your application for"',
  '"status of your application"',
  '"application status"',
  '"application update"',
  '"we regret to inform"',
  '"unfortunately we"',
  '"not moving forward"',
  '"move forward with other candidates"',
  '"decided not to move forward"',
  '"we will not be moving forward"',
  '"interview invitation"',
  '"schedule an interview"',
  '"interview with"',
  '"recruiter screen"',
  '"phone screen"',
  '"online assessment"',
  '"coding assessment"',
  '"technical assessment"',
  '"coding challenge"',
  '"take home"',
  '"hackerrank"',
  '"codesignal"',
  '"offer letter"',
  '"we are pleased to offer"',
  '"pleased to offer you"',
  '"internship offer"',
  '"summer internship"',
  '"intern position"',
  '"hiring team"',
  '"talent acquisition"',
  '"next steps"',
];

/** Gmail wants YYYY/MM/DD, in local terms. */
function gmailDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("/");
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Inbox, archive and Trash. Spam is skipped, which `in:anywhere -in:spam` does
 * in one step.
 */
export function buildQueries(startDate: Date): string[] {
  const scope = `in:anywhere -in:spam after:${gmailDate(startDate)}`;

  const keywordQueries = chunk(KEYWORD_PHRASES, 8).map(
    (group) => `${scope} (${group.join(" OR ")})`,
  );

  const domainQueries = chunk(ATS_DOMAINS, 10).map(
    (group) => `${scope} (${group.map((domain) => `from:${domain}`).join(" OR ")})`,
  );

  return [...keywordQueries, ...domainQueries];
}
