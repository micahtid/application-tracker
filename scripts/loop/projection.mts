/**
 * One board, written out in a form that can be compared to another one.
 *
 * Row ids are left out on purpose. A rebuild renumbers every application, so
 * two boards that differ only by id are the same board, and `rebuild.stable`
 * has to be able to say so (LOOP 3.5).
 */
import type { PrismaClient } from "@prisma/client";
import { resolveCorrections } from "../../src/lib/pipeline/corrections.ts";

export type ProjectedApplication = {
  company: string;
  companyNormalized: string;
  role: string | null;
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
  const [applications, corrections] = await Promise.all([
    db.application.findMany({
      include: {
        messages: {
          orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
          select: { id: true, gmailMessageId: true },
        },
        statusHistory: {
          orderBy: [{ detectedAt: "asc" }, { id: "asc" }],
          include: { message: { select: { gmailMessageId: true } } },
        },
      },
    }),
    resolveCorrections(db),
  ]);

  return applications
    .map((application) => {
      const correction = corrections.get(application.id);
      return {
        company: application.companyName,
        companyNormalized: application.companyNormalized,
        role: application.roleTitle,
        season: application.season,
        year: application.year,
        status: application.status,
        stageDetail: application.stageDetail,
        statusOverride: correction?.statusOverride ?? null,
        isHidden: correction?.isHidden ?? false,
        atsVendor: application.atsVendor,
        messages: application.messages.map((message) => message.gmailMessageId),
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
