import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { STATUSES, type Status } from "@/lib/constants";
import { saveCorrection } from "@/lib/pipeline/corrections";

export const dynamic = "force-dynamic";

/**
 * The only writes in the app. Both are corrections, both reversible:
 * hide a row, or override its status. Everything else on a row is worked out
 * from its emails and rewritten on every sync.
 *
 * They are written to the corrections table rather than to the row, because a
 * rebuild deletes the row and these are the only two values that have to
 * survive it (LOOP Invariant 1).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const applicationId = Number(id);
  if (!Number.isInteger(applicationId)) {
    return NextResponse.json({ error: "Unknown application." }, { status: 400 });
  }

  const body = (await request.json()) as { isHidden?: unknown; statusOverride?: unknown };
  const patch: { isHidden?: boolean; statusOverride?: Status | null } = {};

  if (typeof body.isHidden === "boolean") patch.isHidden = body.isHidden;

  if ("statusOverride" in body) {
    const value = body.statusOverride;
    if (value === null || value === "AUTO" || value === "") {
      patch.statusOverride = null;                      // back to the calculated value
    } else if (typeof value === "string" && (STATUSES as readonly string[]).includes(value)) {
      patch.statusOverride = value as Status;
    } else {
      return NextResponse.json({ error: "Unknown status." }, { status: 400 });
    }
  }

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  const correction = await saveCorrection(prisma, applicationId, patch);
  if (!correction) {
    return NextResponse.json({ error: "Unknown application." }, { status: 404 });
  }

  const application = await prisma.application.findUnique({ where: { id: applicationId } });

  return NextResponse.json({
    id: applicationId,
    isHidden: correction.isHidden,
    statusOverride: correction.statusOverride,
    status: correction.statusOverride ?? application?.status ?? "APPLIED",
  });
}
