import { NextResponse } from "next/server";
import { google } from "googleapis";
import { prisma } from "@/lib/db";
import { oauthClient } from "@/lib/gmail/client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const home = new URL("/", url.origin);

  const error = url.searchParams.get("error");
  if (error) {
    home.searchParams.set("error", error);
    return NextResponse.redirect(home);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("oauth_state="))
    ?.split("=")[1];

  if (!code || !state || state !== expected) {
    home.searchParams.set("error", "consent-mismatch");
    return NextResponse.redirect(home);
  }

  try {
    const client = oauthClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const profile = await google.oauth2({ version: "v2", auth: client }).userinfo.get();
    const emailAddress = profile.data.email;
    if (!emailAddress) throw new Error("Google did not return an email address.");

    const existing = await prisma.gmailAccount.findUnique({ where: { emailAddress } });

    // Reconnecting runs consent again into the same row rather than creating a
    // second account (D1).
    const data = {
      displayName: profile.data.name ?? null,
      accessToken: tokens.access_token ?? null,
      tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      isActive: true,
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
    };

    if (existing) {
      await prisma.gmailAccount.update({ where: { id: existing.id }, data });
    } else {
      if (!tokens.refresh_token) throw new Error("Google did not return a refresh token.");
      await prisma.gmailAccount.create({
        data: { emailAddress, refreshToken: tokens.refresh_token, ...data },
      });
    }

    home.searchParams.set("connected", "1");
    const response = NextResponse.redirect(home);
    response.cookies.delete("oauth_state");
    return response;
  } catch (failure) {
    home.searchParams.set(
      "error",
      failure instanceof Error ? failure.message.slice(0, 120) : "sign-in-failed",
    );
    return NextResponse.redirect(home);
  }
}
