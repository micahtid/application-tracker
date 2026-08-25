import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  drawerTitle,
  drawerTree,
  type DrawerMessage,
  type DrawerNode,
} from "@/lib/drawer";
import { gmailLink } from "@/lib/links";
import { NO_CORRECTION, resolveCorrections } from "@/lib/pipeline/corrections";
import { isStale } from "@/lib/pipeline/recompute";

export const dynamic = "force-dynamic";

/**
 * One line of a drawer, without the lines under it.
 *
 * A parent and a child carry the same five fields, and the tree is one level
 * deep by construction, so the caller adds the children rather than this
 * calling itself.
 */
function emailView(node: DrawerNode<DrawerMessage>, accountEmail: string | null) {
  return {
    id: node.message.id,
    title: drawerTitle(node.message),
    date: node.message.receivedAt,
    // Addresses the exact stored message, never a Gmail text search.
    href: gmailLink(accountEmail, node.message.gmailMessageId),
    relation: node.relation,
  };
}

/**
 * The whole board in one request. Search, sort and filter then run in the
 * browser over this set, which beats a round trip on every keystroke.
 */
export async function GET() {
  const now = new Date();

  const [applications, account, corrections] = await Promise.all([
    prisma.application.findMany({
      orderBy: { latestEmailAt: "desc" },
      include: {
        // Every email the row owns, read through the membership, because
        // where an email sits in a drawer belongs to the pairing rather than
        // to the email. Which of them the drawer shows, and under what, is one
        // rule and it lives in @/lib/drawer, so the board and the loop harness
        // cannot drift apart on the answer.
        memberships: {
          select: {
            parentMessageId: true,
            parentRelation: true,
            message: {
              select: {
                id: true,
                emailTitle: true,
                receivedAt: true,
                gmailMessageId: true,
                senderDomain: true,
                isSignificant: true,
                isApplicationRelated: true,
                llmClassificationRaw: true,
              },
            },
          },
        },
      },
    }),
    prisma.gmailAccount.findFirst({ orderBy: { id: "asc" } }),
    // The corrections live in their own table, keyed by the message they were
    // made against, so a rebuild cannot delete them.
    resolveCorrections(prisma),
  ]);

  return NextResponse.json({
    applications: applications.map((application) => {
      const correction = corrections.get(application.id) ?? NO_CORRECTION;

      // Flattened back into the shape the drawer reads: the email, plus where
      // it sits in this application's drawer.
      const messages = application.memberships
        .map((membership) => ({
          ...membership.message,
          parentMessageId: membership.parentMessageId,
          parentRelation: membership.parentRelation,
        }))
        .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || a.id - b.id);

      return {
        id: application.id,
        company: application.companyName,
        role: application.roleTitle,
        season: application.season,
        year: application.year,
        // The override, when set, beats the calculated status.
        status: correction.statusOverride ?? application.status,
        statusOverride: correction.statusOverride,
        stageDetail: application.stageDetail,
        outcome: application.outcome,
        // Read at request time rather than stored: an application does not
        // become quiet because anything happened to it, but because nothing
        // did, and a stored answer would be wrong the day after it was written.
        isStale: isStale(application, now),
        isHidden: correction.isHidden,
        latestEmailAt: application.latestEmailAt,
        firstEmailAt: application.firstEmailAt,
        atsVendor: application.atsVendor,
        emails: drawerTree(messages).map((node) => ({
          ...emailView(node, account?.emailAddress ?? null),
          children: node.children.map((child) => ({
            ...emailView(child, account?.emailAddress ?? null),
            children: [],
          })),
        })),
      };
    }),
  });
}
