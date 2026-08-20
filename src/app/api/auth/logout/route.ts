import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Signing out also clears the saved API key, because a key with no account is
 * meaningless, and returns the app to the not connected state (5.5).
 *
 * The account row is emptied rather than deleted, so the downloaded emails and
 * their saved classifications survive. Deleting it would cascade them away, and
 * signing back in would then pay for the whole backfill again (Part 9).
 */
export async function POST() {
  await prisma.gmailAccount.updateMany({
    data: { refreshToken: "", accessToken: null, tokenExpiresAt: null, isActive: false },
  });
  await prisma.userSettings.updateMany({ data: { llmApiKeyEncrypted: null } });
  return NextResponse.json({ ok: true });
}
