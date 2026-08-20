import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { STATUSES } from "@/lib/constants";

export const dynamic = "force-dynamic";

/**
 * The only writes in the app (5.3.1). Both are corrections, both reversible:
 * hide a row, or override its status. Everything else on a row is worked out
 * from its emails and rewritten on every sync.
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
  const data: { isHidden?: boolean; statusOverride?: string | null } = {};

  if (typeof body.isHidden === "boolean") data.isHidden = body.isHidden;

  if ("statusOverride" in body) {
    const value = body.statusOverride;
    if (value === null || value === "AUTO" || value === "") {
      data.statusOverride = null;                       // back to the calculated value
    } else if (typeof value === "string" && (STATUSES as readonly string[]).includes(value)) {
      data.statusOverride = value;
    } else {
      return NextResponse.json({ error: "Unknown status." }, { status: 400 });
    }
  }

  if (!Object.keys(data).length) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  const application = await prisma.application.update({ where: { id: applicationId }, data });
  return NextResponse.json({
    id: application.id,
    isHidden: application.isHidden,
    statusOverride: application.statusOverride,
    status: application.statusOverride ?? application.status,
  });
}
