import type { gmail_v1 } from "googleapis";
import type { GmailAccount } from "@prisma/client";
import { prisma } from "@/lib/db";
import { authorizedClient, gmailFor } from "@/lib/gmail/client";
import { buildQueries } from "@/lib/gmail/query";
import { extractBody, headersOf, parseSender } from "@/lib/gmail/body";
import { prefilter } from "@/lib/prefilter";
import { CLASSIFIER_VERSION, GMAIL_CONCURRENCY } from "@/lib/constants";
import { RetryableError, mapWithConcurrency, withRetry } from "@/lib/retry";

/**
 * Stages 1 and 2. Sweep wide, download only what has never been seen, then
 * throw out obvious noise before anything costs money.
 *
 * No pageToken checkpoint: listing every matching id again costs about 15
 * quota units and the message cache already skips what was downloaded, so an
 * interrupted sweep resumes by running again.
 */

/**
 * What the sweep is doing right now, for the progress readout. Searching
 * counts the searches it has run; downloading counts the emails it has saved.
 */
export type FetchProgress = {
  stage: "DISCOVERING" | "FETCHING";
  done: number;
  total: number;
  discovered: number;
  fetched: number;
};

function retryableGmail(error: unknown): never {
  const status = (error as { code?: number; status?: number })?.code ?? 0;
  if (status === 403 || status === 429 || status >= 500) {
    throw new RetryableError(String((error as Error).message ?? error), status);
  }
  throw error;
}

async function listIds(gmail: gmail_v1.Gmail, query: string): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;

  do {
    const response = await withRetry(() =>
      gmail.users.messages
        .list({
          userId: "me",
          q: query,
          maxResults: 500,
          // Trash is included on purpose: people delete rejections, and those are
          // real results. Spam is excluded by the query itself.
          includeSpamTrash: true,
          pageToken,
        })
        .catch(retryableGmail),
    );

    for (const message of response.data.messages ?? []) {
      if (message.id) ids.push(message.id);
    }
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return ids;
}

export async function sweepAndStore(
  account: GmailAccount,
  startDate: Date,
  onProgress: (progress: FetchProgress) => Promise<void> | void,
): Promise<{ discovered: number; fetched: number }> {
  const auth = await authorizedClient(account);
  const gmail = gmailFor(auth);

  const discovered = new Set<string>();
  const queries = buildQueries(startDate);

  // The number of searches is known before the first one runs, so the readout
  // has a denominator from the start.
  await onProgress({
    stage: "DISCOVERING",
    done: 0,
    total: queries.length,
    discovered: 0,
    fetched: 0,
  });

  for (const [index, query] of queries.entries()) {
    for (const id of await listIds(gmail, query)) discovered.add(id);
    await onProgress({
      stage: "DISCOVERING",
      done: index + 1,
      total: queries.length,
      discovered: discovered.size,
      fetched: 0,
    });
  }

  const known = await prisma.emailMessage.findMany({
    where: { gmailAccountId: account.id, gmailMessageId: { in: [...discovered] } },
    select: { gmailMessageId: true },
  });
  const knownIds = new Set(known.map((row) => row.gmailMessageId));
  const fresh = [...discovered].filter((id) => !knownIds.has(id));

  let fetched = 0;
  const report = () =>
    onProgress({
      stage: "FETCHING",
      done: fetched,
      total: fresh.length,
      discovered: discovered.size,
      fetched,
    });

  await report();

  await mapWithConcurrency(fresh, GMAIL_CONCURRENCY, async (messageId) => {
    const response = await withRetry(() =>
      gmail.users.messages
        .get({ userId: "me", id: messageId, format: "full" })
        .catch(retryableGmail),
    );

    const message = response.data;
    const payload = message.payload ?? undefined;
    // Read once and looked up three times, rather than searched three times.
    const headers = headersOf(payload);
    const from = headers.get("from") ?? null;
    const sender = parseSender(from);
    const subject = headers.get("subject") ?? null;
    const bodyText = extractBody(payload);

    const verdict = prefilter({
      senderEmail: sender.email,
      senderDomain: sender.domain,
      subject,
    });

    await prisma.emailMessage.create({
      data: {
        gmailAccountId: account.id,
        gmailMessageId: messageId,
        rfc822MessageId: headers.get("message-id") ?? null,
        threadId: message.threadId ?? null,
        senderName: sender.name,
        senderEmail: sender.email,
        senderDomain: sender.domain,
        subject,
        snippet: message.snippet ?? null,
        bodyText,
        labels: JSON.stringify(message.labelIds ?? []),
        receivedAt: new Date(Number(message.internalDate ?? Date.now())),
        // Skipped rather than deleted, so the decision stays auditable.
        classificationStatus: verdict.keep ? "PENDING" : "SKIPPED_PREFILTER",
        classifierVersion: verdict.keep ? null : CLASSIFIER_VERSION,
        classificationError: verdict.keep ? null : verdict.reason,
      },
    });

    fetched += 1;
    if (fetched % 10 === 0) await report();
  });

  await report();
  return { discovered: discovered.size, fetched };
}
