import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { MAX_MONTHS_BACK, PROVIDERS, type Provider } from "@/lib/constants";

/** The single settings row. Created on first read (CHECK (id = 1) keeps it single). */
export async function getSettings() {
  const existing = await prisma.userSettings.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  return prisma.userSettings.create({ data: { id: 1 } });
}

export function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && (PROVIDERS as readonly string[]).includes(value);
}

/** The earliest date the sweep may start from, enforced here and in the browser. */
export function earliestStartDate(now = new Date()): Date {
  const floor = new Date(now);
  floor.setMonth(floor.getMonth() - MAX_MONTHS_BACK);
  floor.setHours(0, 0, 0, 0);
  return floor;
}

/** Keeps a date inside the allowed window, whether typed, picked, or stored. */
export function clampStartDate(value: Date | null | undefined, now = new Date()): Date {
  const floor = earliestStartDate(now);
  const ceiling = new Date(now);
  ceiling.setHours(0, 0, 0, 0);

  if (!value || Number.isNaN(value.getTime()) || value < floor) return floor;
  return value > ceiling ? ceiling : value;
}

export async function getApiKey(): Promise<string | null> {
  const settings = await getSettings();
  return decryptSecret(settings.llmApiKeyEncrypted);
}

export type ConnectionState = "CONNECTED" | "NOT_CONNECTED" | "RECONNECT";

/**
 * The three states of D32, worked out in one place so the board, the refresh
 * button and the sync route cannot disagree about which one is true.
 */
export async function connectionState() {
  const [settings, account] = await Promise.all([
    getSettings(),
    prisma.gmailAccount.findFirst({ orderBy: { id: "asc" } }),
  ]);

  // Signing out empties the refresh token but keeps the row, so the saved
  // emails and their classifications survive. A row with no token is a
  // signed out mailbox, not a lapsed one.
  const linked = account && account.refreshToken ? account : null;

  const hasKey = Boolean(decryptSecret(settings.llmApiKeyEncrypted));
  const provider = isProvider(settings.llmProvider) ? settings.llmProvider : null;

  let state: ConnectionState = "CONNECTED";
  let missing: "ACCOUNT" | "KEY" | null = null;

  if (!linked) {
    state = "NOT_CONNECTED";
    missing = "ACCOUNT";
  } else if (!linked.isActive) {
    state = "RECONNECT";
  } else if (!hasKey || !provider) {
    state = "NOT_CONNECTED";
    missing = "KEY";
  }

  return { state, missing, settings, account: linked, hasKey, provider };
}
