import type { Db } from "@/lib/db";
import type { Provider } from "@/lib/constants";
import { adapterFor } from "@/lib/llm";
import { adjudicate, type AdjudicationCandidate } from "@/lib/llm/adjudicate";
import { headState } from "./recompute";
import { messagesOf } from "./membership";
import type { Adjudicator } from "./match";

/**
 * The paid half of asking the model, kept out of stage 4.
 *
 * Stage 4 takes an `Adjudicator` and knows nothing about providers, keys or
 * money. This is what one looks like when there is a key to pay with, and the
 * absence of one is simply not passing it.
 *
 * The cap is enforced here rather than advertised. Once it is reached every
 * later call returns null, which the matcher treats exactly as it treats a
 * provider that is down: it carries on with the answer it already had.
 */
export function adjudicatorFor(
  db: Db,
  provider: Provider,
  apiKey: string,
  capUsd: number,
): Adjudicator {
  const adapter = adapterFor(provider);
  let spent = 0;

  return async (message, candidates) => {
    if (spent >= capUsd) return null;

    // Numbered rather than identified by row id, because a row id means
    // nothing to a model and inviting it to answer with one invites it to
    // invent one.
    const described: AdjudicationCandidate[] = [];
    for (const [index, candidate] of candidates.entries()) {
      const messages = await messagesOf(db, candidate.id);
      const state = headState(messages);
      described.push({
        label: index + 1,
        company: candidate.companyName,
        role: candidate.roleTitle,
        status: state.status,
        stageDetail: state.stageDetail,
        subjects: messages.map((row) => row.subject ?? "").filter(Boolean),
      });
    }

    const answer = await adjudicate(adapter, apiKey, message, described);
    if (!answer) return null;

    spent += answer.usage.costUsd;
    return {
      chosen: answer.chosen
        .map((label) => candidates[label - 1]?.id)
        .filter((id): id is number => typeof id === "number"),
      costUsd: answer.usage.costUsd,
    };
  };
}

/** What one pass may spend asking. */
export const ADJUDICATE_CAP_USD = 0.05;
