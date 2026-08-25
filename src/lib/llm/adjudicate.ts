import type { ProviderAdapter, Usage } from "./types";

/**
 * When the code cannot settle a match, the model is asked once, with the
 * candidates in front of it.
 *
 * > A tie is a question, not an answer.
 *
 * The classifier reads one email with no context, which is deliberate and
 * correct: it is what stops a company name bleeding from one email to the next.
 * It also means the classifier cannot help with matching at all, because
 * matching is nothing but context. So this is a second call, tiny, and only
 * where the code has run out of answers.
 *
 * It is the standard shape in the entity matching work: one record compared
 * against a set of candidates, with rejecting all of them allowed. Allowing
 * "none" is what stops one wrong match spreading, and allowing "all" is what
 * lets it agree with fan out rather than fight it.
 *
 * **A paid call may never be load bearing for correctness.** Every failure
 * here, from a rejected key to an answer that will not parse, returns null and
 * the caller carries on exactly as it would have without it.
 */

export type AdjudicationCandidate = {
  /** A number the model answers with. Never a row id, which means nothing to it. */
  label: number;
  company: string;
  role: string | null;
  status: string;
  stageDetail: string | null;
  /** The subjects already on this row, oldest first, so the model can see what it is. */
  subjects: string[];
};

export type Adjudication = {
  /** The labels chosen, empty for none of them. */
  chosen: number[];
  confidence: number;
  usage: Usage;
};

const SYSTEM = `You are given one email and a short list of numbered job applications the recipient has already made. Say which of them the email belongs to.

Rules:

1. Answer with the numbers of the applications the email is about. Answer with an empty list when it belongs to none of them, which is the right answer for an email about an application that is not in the list at all.
2. Answer with more than one number only when the email is genuinely about more than one of them, such as one notice covering two postings at the same employer. An email about one application must name exactly one.
3. An outcome, such as an offer or a rejection, is about exactly one application unless it names more. Employers hold a rejection back precisely when the person is still being considered elsewhere, so never spread one across several.
4. Judge from what the email says. Do not prefer an application because it appears first in the list.`;

const SCHEMA = {
  type: "object",
  properties: {
    applications: {
      type: "array",
      items: { type: "integer" },
      description:
        "The numbers of the applications this email belongs to. Empty when it belongs to none of them.",
    },
    confidence: {
      type: "number",
      description: "How sure you are of this answer, from 0 to 1.",
    },
    reason: {
      type: "string",
      description: "One sentence saying why, for debugging.",
    },
  },
  required: ["applications", "confidence", "reason"],
  additionalProperties: false,
} as const;

function describe(email: { subject: string | null; senderEmail: string | null; bodyText: string | null }): string {
  return [
    `From: ${email.senderEmail ?? "unknown"}`,
    `Subject: ${email.subject ?? "(no subject)"}`,
    "",
    (email.bodyText ?? "").slice(0, 900) || "(no body text)",
  ].join("\n");
}

function describeCandidates(candidates: AdjudicationCandidate[]): string {
  return candidates
    .map((candidate) =>
      [
        `${candidate.label}. ${candidate.company} — ${candidate.role ?? "(no role stated)"}`,
        `   currently ${candidate.status}${candidate.stageDetail ? `, waiting on ${candidate.stageDetail}` : ""}`,
        ...candidate.subjects.slice(0, 4).map((subject) => `   already holds: ${subject}`),
      ].join("\n"),
    )
    .join("\n");
}

export async function adjudicate(
  adapter: ProviderAdapter,
  apiKey: string,
  email: { subject: string | null; senderEmail: string | null; bodyText: string | null },
  candidates: AdjudicationCandidate[],
): Promise<Adjudication | null> {
  if (!adapter.ask || candidates.length < 2) return null;

  try {
    const answer = await adapter.ask(
      apiKey,
      SYSTEM,
      [describe(email), "", "The applications:", describeCandidates(candidates)].join("\n"),
      SCHEMA as unknown as Record<string, unknown>,
      "application_match",
    );

    const parsed = JSON.parse(answer.raw) as { applications?: unknown; confidence?: unknown };
    const known = new Set(candidates.map((candidate) => candidate.label));
    const chosen = Array.isArray(parsed.applications)
      ? [...new Set(parsed.applications.map(Number).filter((value) => known.has(value)))]
      : [];

    return {
      chosen,
      confidence: Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : 0,
      usage: answer.usage,
    };
  } catch {
    // Unavailable, out of credit, or an answer that would not parse. The caller
    // falls back to what it would have done anyway.
    return null;
  }
}
