import { prisma } from "@/lib/db";
import { SYNC_COOLDOWN_MS } from "@/lib/constants";
import { GmailAuthError } from "@/lib/gmail/client";
import { clampStartDate, connectionState, getApiKey } from "@/lib/settings";
import { sweepAndStore } from "./fetch";
import { classifyPending, revisitSkipped } from "./classify";
import { attachClassified } from "./match";
import { recomputeAll } from "./recompute";
import { rebuildIfStale } from "./rebuild";
import { findSplitSuspects } from "./duplicates";

/**
 * The whole pipeline, in order, with one sync at a time (D23).
 *
 * The lock is two things at once: a module flag, which stops two browser tabs
 * in the same server process racing, and a RUNNING row, which is what the
 * progress readout reads and what survives a page reload (D24).
 */

let running: Promise<void> | null = null;

/** A RUNNING row older than this was left behind by a crash, not by a live sync. */
const STALE_RUN_MS = 30 * 60 * 1000;

export type SyncDecision =
  | { started: true; syncRunId: number }
  | { started: false; reason: "COOLDOWN" | "ALREADY_RUNNING" | "NOT_CONNECTED" };

export async function currentRun() {
  await closeStaleRuns();
  return prisma.syncRun.findFirst({ orderBy: { id: "desc" } });
}

async function closeStaleRuns(): Promise<void> {
  if (running) return;
  const cutoff = new Date(Date.now() - STALE_RUN_MS);
  await prisma.syncRun.updateMany({
    where: { status: "RUNNING", startedAt: { lt: cutoff } },
    data: {
      status: "FAILED",
      finishedAt: new Date(),
      errorSummary: "The sync stopped before it finished. Refresh to try again.",
    },
  });
}

export async function startSync(options: { force: boolean }): Promise<SyncDecision> {
  await closeStaleRuns();

  const connection = await connectionState();
  if (connection.state !== "CONNECTED" || !connection.account || !connection.provider) {
    return { started: false, reason: "NOT_CONNECTED" };
  }

  if (running) return { started: false, reason: "ALREADY_RUNNING" };

  const open = await prisma.syncRun.findFirst({ where: { status: "RUNNING" } });
  if (open) return { started: false, reason: "ALREADY_RUNNING" };

  if (!options.force) {
    const last = await prisma.syncRun.findFirst({
      where: { status: { in: ["OK", "PARTIAL"] } },
      orderBy: { id: "desc" },
    });
    if (last?.finishedAt && Date.now() - last.finishedAt.getTime() < SYNC_COOLDOWN_MS) {
      return { started: false, reason: "COOLDOWN" };
    }
  }

  const everSucceeded = await prisma.syncRun.count({ where: { status: { in: ["OK", "PARTIAL"] } } });
  const run = await prisma.syncRun.create({
    data: { mode: everSucceeded ? "INCREMENTAL" : "FULL" },
  });

  const account = connection.account;
  const provider = connection.provider;
  const startDate = clampStartDate(connection.settings.readFromDate);

  // Deliberately not awaited: syncing never blocks the first view (Part 7).
  running = execute(run.id, account.id, provider, startDate).finally(() => {
    running = null;
  });

  return { started: true, syncRunId: run.id };
}

async function execute(
  syncRunId: number,
  accountId: number,
  provider: "OPENROUTER" | "ANTHROPIC" | "GEMINI",
  startDate: Date,
): Promise<void> {
  const failures: string[] = [];
  const notes: string[] = [];
  let permanentFailures = 0;

  try {
    const account = await prisma.gmailAccount.findUniqueOrThrow({ where: { id: accountId } });

    // Every run walks the same four stages, so the readout is the same one
    // whether this is the first backfill or a refresh (4).
    const swept = await sweepAndStore(account, startDate, async (progress) => {
      await prisma.syncRun.update({
        where: { id: syncRunId },
        data: {
          stage: progress.stage,
          stageDone: progress.done,
          stageTotal: progress.total,
          messagesDiscovered: progress.discovered,
          messagesFetched: progress.fetched,
        },
      });
    });

    await prisma.syncRun.update({
      where: { id: syncRunId },
      data: {
        stage: "CLASSIFYING",
        stageDone: 0,
        stageTotal: 0,
        messagesDiscovered: swept.discovered,
        messagesFetched: swept.fetched,
      },
    });

    const apiKey = await getApiKey();
    if (!apiKey) throw new Error("No API key is saved.");

    await revisitSkipped(prisma);

    const outcome = await classifyPending(
      prisma,
      provider,
      apiKey,
      syncRunId,
      async (progress) => {
        await prisma.syncRun.update({
          where: { id: syncRunId },
          data: {
            stageDone: progress.done,
            stageTotal: progress.total,
            messagesClassified: progress.done,
          },
        });
      },
    );

    await prisma.syncRun.update({
      where: { id: syncRunId },
      data: { stage: "TIDYING", stageDone: 0, stageTotal: 0 },
    });

    permanentFailures = outcome.failed;
    if (outcome.fatal) failures.push(outcome.fatal);
    if (outcome.failed) {
      failures.push(
        `${outcome.failed} email${outcome.failed === 1 ? "" : "s"} could not be read after three tries.`,
      );
    }

    // A grouping rule that has moved on regroups the whole message set once,
    // which is what lets a matching fix reach mail that is already on the
    // board. Unchanged version, no rebuild, no cost.
    const rebuilt = await rebuildIfStale(prisma);
    if (rebuilt) notes.push(`Regrouped ${rebuilt.applications} applications.`, ...rebuilt.notes);

    const matched = await attachClassified(prisma);
    await recomputeAll(prisma, matched.touched);

    // Applications can also change because a message was attached to one of
    // them by an earlier run that never finished recalculating.
    const orphaned = await prisma.application.findMany({
      where: { firstEmailAt: null },
      select: { id: true },
    });
    await recomputeAll(prisma, orphaned.map((row) => row.id));

    // Advisory only. Nothing acts on it, and nothing in the board changes
    // because of it (LOOP Invariant 6).
    const suspects = await findSplitSuspects(prisma);
    if (suspects.length) {
      const many = suspects.length === 1 ? "" : "s";
      notes.push(`${suspects.length} pair${many} of rows look like one application split in two.`);
    }

    await prisma.gmailAccount.update({
      where: { id: accountId },
      data: { lastSyncAt: new Date() },
    });

    await prisma.syncRun.update({
      where: { id: syncRunId },
      data: {
        status: failures.length ? "PARTIAL" : "OK",
        finishedAt: new Date(),
        messagesClassified: outcome.classified,
        errors: permanentFailures,
        errorSummary: failures.length ? failures.join(" ") : null,
        applicationsRebuilt: rebuilt?.applications ?? 0,
        splitSuspects: suspects.length,
        notes: notes.length ? notes.join(" ") : null,
      },
    });
  } catch (error) {
    const message =
      error instanceof GmailAuthError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);

    await prisma.syncRun.update({
      where: { id: syncRunId },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errors: permanentFailures || 1,
        errorSummary: [message, ...failures].join(" ").slice(0, 500),
      },
    });
  }
}
