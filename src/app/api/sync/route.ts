import { NextResponse } from "next/server";
import { currentRun, startSync } from "@/lib/pipeline/sync";

export const dynamic = "force-dynamic";

/** The page asks our own server how the sync is going, never Google (D24). */
export async function GET() {
  const run = await currentRun();
  return NextResponse.json({ sync: run });
}

/**
 * Sync on open skips a run started less than five minutes ago. The refresh
 * button sets force and ignores that limit (Part 4).
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { force?: boolean };
  const decision = await startSync({ force: body.force === true });
  const run = await currentRun();
  return NextResponse.json({ ...decision, sync: run });
}
