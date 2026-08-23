import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resetEverything } from "@/lib/pipeline/reset";
import { currentRun, startSync } from "@/lib/pipeline/sync";

export const dynamic = "force-dynamic";

/**
 * Throw away everything the syncs built and read the mailbox again from the
 * start. Refused while a sync is running, because the wipe would pull rows out
 * from under a pipeline that is halfway through writing them.
 */
export async function POST() {
  const open = await currentRun();
  if (open?.status === "RUNNING") {
    return NextResponse.json({ reset: false, reason: "ALREADY_RUNNING" }, { status: 409 });
  }

  await resetEverything(prisma);

  const decision = await startSync({ force: true });
  const run = await currentRun();
  return NextResponse.json({ reset: true, ...decision, sync: run });
}
