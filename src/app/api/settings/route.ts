import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { clampStartDate, earliestStartDate, getSettings } from "@/lib/settings";
import { adapterFor } from "@/lib/llm";
import { UNRECOGNISED_KEY, detectProvider } from "@/lib/llm/detect";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({
    provider: settings.llmProvider,
    hasKey: Boolean(settings.llmApiKeyEncrypted),
    readFromDate: settings.readFromDate,
    earliest: earliestStartDate(),
  });
}

/**
 * Save. The date cap is checked here as well as in the browser, and the key is
 * checked against its provider one more time before it is stored, so a key that
 * only passed a browser side check can never be saved (5.5, Q7).
 *
 * The provider is never sent by the browser: it is read out of the key (D10).
 */
export async function PUT(request: Request) {
  const body = (await request.json()) as { apiKey?: unknown; readFromDate?: unknown };

  const data: {
    llmProvider?: string;
    llmApiKeyEncrypted?: string;
    readFromDate?: Date;
  } = {};

  if (typeof body.apiKey === "string" && body.apiKey.trim()) {
    const apiKey = body.apiKey.trim();
    const provider = detectProvider(apiKey);
    if (!provider) return NextResponse.json({ error: UNRECOGNISED_KEY }, { status: 400 });

    const check = await adapterFor(provider).checkKey(apiKey);
    if (!check.ok) return NextResponse.json({ error: check.message }, { status: 400 });

    data.llmProvider = provider;
    data.llmApiKeyEncrypted = encryptSecret(apiKey);
  }

  if (body.readFromDate !== undefined) {
    const parsed = new Date(String(body.readFromDate));
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "That is not a date." }, { status: 400 });
    }
    data.readFromDate = clampStartDate(parsed);
  }

  await getSettings();
  const saved = await prisma.userSettings.update({ where: { id: 1 }, data });

  return NextResponse.json({
    provider: saved.llmProvider,
    hasKey: Boolean(saved.llmApiKeyEncrypted),
    readFromDate: saved.readFromDate,
  });
}
