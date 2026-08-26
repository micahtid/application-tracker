/**
 * One board, written out in a form that can be compared to another one.
 *
 * Row ids are left out on purpose. A rebuild renumbers every application, so
 * two boards that differ only by id are the same board, and `rebuild.stable`
 * has to be able to say so.
 */
import type { PrismaClient } from "@prisma/client";
import { resolveCorrections } from "@/lib/pipeline/corrections";
import { displayCompanyNames } from "@/lib/pipeline/employers";

export type ProjectedApplication = {
  company: string;
  /**
   * The one name this employer is drawn under, worked out across every row at
   * that employer (LOOP5 Decision 3). Projected rather than stored, and here
   * rather than only on the board, so `rebuild.stable` says whether the display
   * rule comes back the same as well as whether the grouping does.
   */
  displayCompany: string;
  companyNormalized: string;
  role: string | null;
  /** The term the emails stated, in their words (LOOP5 Decision 6). */
  term: string | null;
  season: string | null;
  year: number | null;
  status: string;
  stageDetail: string | null;
  statusOverride: string | null;
  isHidden: boolean;
  atsVendor: string | null;
  messages: string[];
  /** The gmail ids that wrote a milestone, in the order the drawer shows them. */
  milestones: { message: string; status: string }[];
};

export async function projectApplications(db: PrismaClient): Promise<ProjectedApplication[]> {
  const [applications, corrections, aliases] = await Promise.all([
    db.application.findMany({
      include: {
        memberships: {
          select: {
            message: {
              select: {
                id: true,
                gmailMessageId: true,
                receivedAt: true,
                llmClassificationRaw: true,
              },
            },
          },
        },
        statusHistory: {
          orderBy: [{ detectedAt: "asc" }, { id: "asc" }],
          include: { message: { select: { gmailMessageId: true } } },
        },
      },
    }),
    resolveCorrections(db),
    db.companyAlias.findMany({ select: { aliasNormalized: true, canonicalCompanyName: true } }),
  ]);

  const displayNames = displayCompanyNames(
    applications.map((application) => ({
      id: application.id,
      companyName: application.companyName,
      companyNormalized: application.companyNormalized,
      messages: application.memberships.map((membership) => membership.message),
    })),
    aliases,
  );

  return applications
    .map((application) => {
      const correction = corrections.get(application.id);
      return {
        company: application.companyName,
        displayCompany: displayNames.get(application.id) ?? application.companyName,
        companyNormalized: application.companyNormalized,
        role: application.roleTitle,
        term: application.term,
        season: application.season,
        year: application.year,
        status: application.status,
        stageDetail: application.stageDetail,
        statusOverride: correction?.statusOverride ?? null,
        isHidden: correction?.isHidden ?? false,
        atsVendor: application.atsVendor,
        messages: application.memberships
          .map((membership) => membership.message)
          .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || a.id - b.id)
          .map((message) => message.gmailMessageId),
        milestones: application.statusHistory.map((row) => ({
          message: row.message.gmailMessageId,
          status: row.status,
        })),
      };
    })
    // Sorted by content rather than by id, so the order survives a rebuild.
    .sort(
      (a, b) =>
        a.companyNormalized.localeCompare(b.companyNormalized) ||
        (a.role ?? "").localeCompare(b.role ?? "") ||
        (a.messages[0] ?? "").localeCompare(b.messages[0] ?? ""),
    );
}
