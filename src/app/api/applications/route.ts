import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { gmailLink } from "@/lib/links";
import { NO_CORRECTION, resolveCorrections } from "@/lib/pipeline/corrections";

export const dynamic = "force-dynamic";

/**
 * The whole board in one request. Search, sort and filter then run in the
 * browser over this set, which beats a round trip on every keystroke (D26).
 */
export async function GET() {
  const [applications, account, corrections] = await Promise.all([
    prisma.application.findMany({
      orderBy: { latestEmailAt: "desc" },
      include: {
        messages: {
          // Significant and not a repeat. The model says whether an email is
          // significant read on its own; being a repeat of an earlier email in
          // the same application is worked out later, from the whole set.
          where: { isSignificant: true, isApplicationRelated: true, repeatOfMessageId: null },
          orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            emailTitle: true,
            receivedAt: true,
            gmailMessageId: true,
          },
        },
      },
    }),
    prisma.gmailAccount.findFirst({ orderBy: { id: "asc" } }),
    // The corrections live in their own table, keyed by the message they were
    // made against, so a rebuild cannot delete them (LOOP Invariant 1).
    resolveCorrections(prisma),
  ]);

  return NextResponse.json({
    applications: applications.map((application) => {
      const correction = corrections.get(application.id) ?? NO_CORRECTION;

      return {
        id: application.id,
        company: application.companyName,
        role: application.roleTitle,
        season: application.season,
        year: application.year,
        // The override, when set, beats the calculated status (3.6).
        status: correction.statusOverride ?? application.status,
        statusOverride: correction.statusOverride,
        stageDetail: application.stageDetail,
        isHidden: correction.isHidden,
        latestEmailAt: application.latestEmailAt,
        firstEmailAt: application.firstEmailAt,
        atsVendor: application.atsVendor,
        emails: application.messages.map((message) => ({
          id: message.id,
          title: message.emailTitle ?? "Application Email",
          date: message.receivedAt,
          // Addresses the exact stored message, never a Gmail text search (D31).
          href: gmailLink(account?.emailAddress ?? null, message.gmailMessageId),
        })),
      };
    }),
  });
}
