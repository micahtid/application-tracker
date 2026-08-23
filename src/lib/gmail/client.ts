import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import { prisma } from "@/lib/db";
import type { GmailAccount } from "@prisma/client";

export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

export class GmailAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GmailAuthError";
  }
}

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function oauthClient(): OAuth2Client {
  if (!googleConfigured()) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are missing from .env.local. See README.md.",
    );
  }
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || "http://127.0.0.1:3939/api/auth/google/callback",
  );
}

export function consentUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",          // always return a refresh token, including on reconnect
    scope: [GMAIL_SCOPE, "https://www.googleapis.com/auth/userinfo.email", "openid", "profile"],
    include_granted_scopes: true,
    state,
  });
}

/**
 * An authorised client for an account, refreshing the access token when it has
 * expired. A rejected refresh token flips is_active and raises GmailAuthError,
 * which is what puts the Reconnect Gmail screen on screen.
 */
export async function authorizedClient(account: GmailAccount): Promise<OAuth2Client> {
  const client = oauthClient();
  client.setCredentials({
    refresh_token: account.refreshToken,
    access_token: account.accessToken ?? undefined,
    expiry_date: account.tokenExpiresAt ? account.tokenExpiresAt.getTime() : undefined,
  });

  const fresh = !account.tokenExpiresAt || account.tokenExpiresAt.getTime() - Date.now() > 60_000;
  if (fresh && account.accessToken) return client;

  try {
    const { credentials } = await client.refreshAccessToken();
    await prisma.gmailAccount.update({
      where: { id: account.id },
      data: {
        accessToken: credentials.access_token ?? null,
        tokenExpiresAt: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
        refreshToken: credentials.refresh_token ?? account.refreshToken,
        isActive: true,
      },
    });
    return client;
  } catch (error) {
    await prisma.gmailAccount.update({ where: { id: account.id }, data: { isActive: false } });
    throw new GmailAuthError(
      "Gmail access has lapsed. Reconnect the account to carry on. " + describe(error),
    );
  }
}

export function gmailFor(client: OAuth2Client) {
  return google.gmail({ version: "v1", auth: client });
}

function describe(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return String(error);
}

