import type { Db } from "@/lib/db";
import {
  CLASSIFIER_VERSION,
  LLM_CONCURRENCY,
  MAX_CLASSIFICATION_ATTEMPTS,
  type Provider,
} from "@/lib/constants";
import { MalformedOutputError, adapterFor } from "@/lib/llm";
import { SYSTEM_PROMPT, buildUserContent } from "@/lib/llm/prompt";
import { prefilter } from "@/lib/prefilter";
import { mapWithConcurrency } from "@/lib/retry";

/**
 * Stage 3. Wide and unordered: about ten emails in flight at once.
 * Nothing is ever sent to the model twice, which is what makes every sync after
 * the first cost almost nothing.
 */

export type ClassifyOutcome = {
  classified: number;
  failed: number;
  /** Terminal errors: the key, the credit, or a message that failed three times. */
  fatal: string | null;
};

/** A saved result counts only when it is OK and made by the current pipeline. */
function needsClassifying() {
  return {
    OR: [
      { classificationStatus: "PENDING" },
      {
        classificationStatus: "FAILED",
        classificationAttempts: { lt: MAX_CLASSIFICATION_ATTEMPTS },
      },
      { classificationStatus: "OK", classifierVersion: { not: CLASSIFIER_VERSION } },
    ],
  };
}

export async function pendingCount(db: Db): Promise<number> {
  return db.emailMessage.count({ where: needsClassifying() });
}

/**
 * The prefilter rules are part of `classifier_version` too, so a version bump
 * has to reconsider everything the old rules threw away.
 */
export async function revisitSkipped(db: Db): Promise<void> {
  const stale = await db.emailMessage.findMany({
    where: {
      classificationStatus: "SKIPPED_PREFILTER",
      OR: [{ classifierVersion: null }, { classifierVersion: { not: CLASSIFIER_VERSION } }],
    },
  });

  // The verdict has two outcomes, so the ids are collected rather than written
  // one at a time. The rejected side is grouped by the reason it was given,
  // because that reason is stored on the row and names the sender or the
  // domain that produced it.
  const reconsider: number[] = [];
  const rejected = new Map<string, number[]>();

  for (const message of stale) {
    const verdict = prefilter({
      senderEmail: message.senderEmail,
      senderDomain: message.senderDomain,
      subject: message.subject,
    });

    if (verdict.keep) {
      reconsider.push(message.id);
      continue;
    }

    const sharing = rejected.get(verdict.reason);
    if (sharing) sharing.push(message.id);
    else rejected.set(verdict.reason, [message.id]);
  }

  if (reconsider.length) {
    await db.emailMessage.updateMany({
      where: { id: { in: reconsider } },
      data: { classificationStatus: "PENDING", classificationError: null },
    });
  }

  for (const [reason, ids] of rejected) {
    await db.emailMessage.updateMany({
      where: { id: { in: ids } },
      data: { classifierVersion: CLASSIFIER_VERSION, classificationError: reason },
    });
  }
}

export async function classifyPending(
  db: Db,
  provider: Provider,
  apiKey: string,
  syncRunId: number,
  onProgress: (progress: { done: number; total: number }) => Promise<void> | void,
): Promise<ClassifyOutcome> {
  const adapter = adapterFor(provider);

  const messages = await db.emailMessage.findMany({
    where: needsClassifying(),
    orderBy: { receivedAt: "asc" },
  });

  // The total is sent first so the readout has a denominator before the first
  // email comes back.
  await onProgress({ done: 0, total: messages.length });

  let classified = 0;
  let failed = 0;
  let fatal: string | null = null;

  await mapWithConcurrency(messages, LLM_CONCURRENCY, async (message) => {
    // One terminal failure, such as a rejected key, stops the rest of the run
    // rather than repeating the same error 250 times.
    if (fatal) return;

    try {
      const result = await adapter.classify(
        apiKey,
        SYSTEM_PROMPT,
        buildUserContent({
          senderName: message.senderName,
          senderEmail: message.senderEmail,
          subject: message.subject,
          receivedAt: message.receivedAt,
          bodyText: message.bodyText,
        }),
      );

      const { classification, usage, raw } = result;

      await db.$transaction([
        db.emailMessage.update({
          where: { id: message.id },
          data: {
            classificationStatus: "OK",
            classifierVersion: CLASSIFIER_VERSION,
            llmModel: usage.model,
            classificationError: null,
            classificationAttempts: message.classificationAttempts + 1,
            isApplicationRelated: classification.isApplicationRelated,
            isSignificant: classification.isSignificant,
            emailTitle: classification.emailTitle,
            llmClassificationRaw: raw,
          },
        }),
        // Cost is worked out when the row is written, so a later price change
        // never rewrites what was actually spent.
        db.llmUsage.create({
          data: {
            syncRunId,
            model: usage.model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            costUsd: usage.costUsd,
          },
        }),
      ]);

      classified += 1;
      if (classified % 5 === 0) await onProgress({ done: classified, total: messages.length });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const attempts = message.classificationAttempts + 1;

      await db.emailMessage.update({
        where: { id: message.id },
        data: {
          classificationStatus: "FAILED",
          classificationAttempts: attempts,
          classificationError: detail.slice(0, 500),
          // An answer that would not parse is kept as the model wrote it, so
          // the failure can be read rather than guessed at. Nothing downstream
          // trusts it: reading a saved answer already tolerates one that does
          // not parse.
          ...(error instanceof MalformedOutputError
            ? { llmClassificationRaw: error.raw.slice(0, 8000) }
            : {}),
        },
      });

      if (/401|403|invalid.?api.?key|credit|quota|billing/i.test(detail)) {
        fatal = fatal ?? shortenFatal(detail);
      }
      if (attempts >= MAX_CLASSIFICATION_ATTEMPTS) failed += 1;
    }
  });

  await onProgress({ done: classified, total: messages.length });
  return { classified, failed, fatal };
}

function shortenFatal(detail: string): string {
  if (/401|invalid.?api.?key/i.test(detail)) return "The API key was rejected by the provider.";
  if (/credit|billing|payment/i.test(detail)) return "The provider reports no credit left.";
  if (/quota|rate/i.test(detail)) return "The provider's quota is exhausted.";
  return detail.slice(0, 200);
}
