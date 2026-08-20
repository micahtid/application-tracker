import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { gmailLink } from "@/lib/links";

export const dynamic = "force-dynamic";

/**
 * The whole board in one request. Search, sort and filter then run in the
 * browser over this set, which beats a round trip on every keystroke (D26).
 */
export async function GET() {
  const [applications, account] = await Promise.all([
    prisma.application.findMany({
      orderBy: { latestEmailAt: "desc" },
      include: {
        messages: {
          where: { isSignificant: true, isApplicationRelated: true },
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
  ]);

  return NextResponse.json({
    applications: applications.map((application) => ({
      id: application.id,
      company: application.companyName,
      role: application.roleTitle,
      season: application.season,
      year: application.year,
      // The override, when set, beats the calculated status (3.6).
      status: application.statusOverride ?? application.status,
      statusOverride: application.statusOverride,
      stageDetail: application.stageDetail,
      isHidden: application.isHidden,
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
    })),
  });
}
