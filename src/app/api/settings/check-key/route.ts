import { NextResponse } from "next/server";
import { PROVIDER_LABELS, adapterFor } from "@/lib/llm";
import { UNRECOGNISED_KEY, detectProvider } from "@/lib/llm/detect";

export const dynamic = "force-dynamic";

/**
 * Check works out the provider from the key, then calls that provider's model
 * list endpoint (Q7). That endpoint is free, needs a working key, and confirms
 * our chosen model still exists, so a retired model id shows a clear error here
 * instead of failing on every email halfway through a sync. A pattern match
 * alone would pass a well formed but revoked key.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as { apiKey?: unknown };

  if (typeof body.apiKey !== "string" || !body.apiKey.trim()) {
    return NextResponse.json({ ok: false, message: "Enter a key first." });
  }

  const provider = detectProvider(body.apiKey);
  if (!provider) return NextResponse.json({ ok: false, message: UNRECOGNISED_KEY });

  const adapter = adapterFor(provider);
  const result = await adapter.checkKey(body.apiKey.trim());

  return NextResponse.json(
    result.ok
      ? { ok: true, provider, label: PROVIDER_LABELS[provider].label, model: adapter.model }
      : { ok: false, provider, label: PROVIDER_LABELS[provider].label, message: result.message },
  );
}
