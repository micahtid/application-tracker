/**
 * Stage 2. Local junk filter, no model involved.
 *
 * Leans toward keeping. A wrong keep costs a fraction of a cent and the model
 * rejects it; a wrong discard is invisible, because an application never
 * ingested never appears. So only remove what is certainly not an application.
 */

/** Senders that only ever send digests and adverts. */
const NOISE_SENDERS = [
  "jobalerts-noreply@linkedin.com",
  "jobs-listings@linkedin.com",
  "jobs-noreply@linkedin.com",
  "news-noreply@linkedin.com",
  "invitations@linkedin.com",
  "messages-noreply@linkedin.com",
  "alerts@indeed.com",
  "noreply@indeed.com",
  "donotreply@indeed.com",
  "alerts@glassdoor.com",
  "noreply@glassdoor.com",
  "noreply@joinhandshake.com",
  "notifications@joinhandshake.com",
  "no-reply@ziprecruiter.com",
  "alerts@ziprecruiter.com",
  "noreply@monster.com",
  "no-reply@dice.com",
  "noreply@wellfound.com",
  "noreply@angel.co",
];

/** Subject lines that mark a digest or a marketing blast. */
const NOISE_SUBJECTS: RegExp[] = [
  /\b\d+\s+new\s+jobs?\b/i,
  /\bjobs? (alert|digest|recommendations?)\b/i,
  /\bnew jobs? (for you|matching|posted)\b/i,
  /\brecommended (jobs?|for you)\b/i,
  /\bjobs? you may be interested in\b/i,
  /\byour (job|weekly|daily) (alert|digest|update)\b/i,
  /\bwebinar\b/i,
  /\bnewsletter\b/i,
  /\b(is|are) hiring\b.*\bapply now\b/i,
  /\bapply now\b.*\bbefore\b/i,
  /\bcareer fair\b/i,
  /\bviewed your profile\b/i,
  /\bpeople you may know\b/i,
  /\bconnect(ion)? request\b/i,
  /\bsale\b|\b% off\b|\bdiscount\b/i,
  /\bpassword reset\b|\bverify your (email|account)\b|\bsecurity alert\b/i,
  /\bhas endorsed you\b|\bcongratulate\b/i,
];

/** Whole domains that never carry a real application email. */
const NOISE_DOMAINS = [
  "e.linkedin.com",
  "email.indeed.com",
  "mail.glassdoor.com",
  "info.ziprecruiter.com",
];

export type PrefilterVerdict = { keep: true } | { keep: false; reason: string };

export function prefilter(input: {
  senderEmail: string | null;
  senderDomain: string | null;
  subject: string | null;
}): PrefilterVerdict {
  const sender = (input.senderEmail ?? "").toLowerCase();
  const domain = (input.senderDomain ?? "").toLowerCase();
  const subject = input.subject ?? "";

  if (sender && NOISE_SENDERS.includes(sender)) {
    return { keep: false, reason: `Digest sender ${sender}` };
  }
  if (domain && NOISE_DOMAINS.some((noise) => domain === noise || domain.endsWith("." + noise))) {
    return { keep: false, reason: `Digest domain ${domain}` };
  }
  const subjectHit = NOISE_SUBJECTS.find((pattern) => pattern.test(subject));
  if (subjectHit) {
    return { keep: false, reason: `Subject looks like a digest or advert` };
  }

  // An unsubscribe header is a hint, not a rule: real ATS mail carries one.
  return { keep: true };
}
