import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { connectionState } from "@/lib/settings";
import { googleConfigured } from "@/lib/gmail/client";
import { currentRun } from "@/lib/pipeline/sync";
import { PROVIDER_LABELS } from "@/lib/llm";

export const dynamic = "force-dynamic";

/** Everything the shell needs to decide which of the states in D32 it is in. */
export async function GET() {
  const connection = await connectionState();
  const [usage, run] = await Promise.all([
    prisma.llmUsage.aggregate({ _sum: { costUsd: true } }),
    currentRun(),
  ]);

  const account = connection.account;
  const firstName = account?.displayName?.trim().split(/\s+/)[0] ?? null;

  return NextResponse.json({
    state: connection.state,
    missing: connection.missing,
    googleConfigured: googleConfigured(),
    account: account
      ? {
          email: account.emailAddress,
          displayName: account.displayName,
          firstName,
          isActive: account.isActive,
          lastSyncAt: account.lastSyncAt,
        }
      : null,
    provider: connection.provider,
    providers: PROVIDER_LABELS,
    hasKey: connection.hasKey,
    readFromDate: connection.settings.readFromDate,
    usageUsd: usage._sum.costUsd ?? 0,
    sync: run
      ? {
          id: run.id,
          status: run.status,
          mode: run.mode,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          messagesDiscovered: run.messagesDiscovered,
          messagesFetched: run.messagesFetched,
          messagesClassified: run.messagesClassified,
          errors: run.errors,
          errorSummary: run.errorSummary,
        }
      : null,
  });
}
