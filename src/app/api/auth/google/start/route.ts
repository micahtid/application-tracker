import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { consentUrl, googleConfigured } from "@/lib/gmail/client";

export const dynamic = "force-dynamic";

/**
 * The OAuth flow is written by hand on googleapis (D2). There is one user on
 * their own machine, so the only thing the state value protects against is a
 * callback that did not come from the consent screen we opened.
 */
export async function GET() {
  if (!googleConfigured()) {
    return NextResponse.redirect(
      new URL("/?error=google-not-configured", "http://127.0.0.1:3939"),
    );
  }

  const state = crypto.randomBytes(16).toString("hex");
  const response = NextResponse.redirect(consentUrl(state));

  response.cookies.set("oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return response;
}
