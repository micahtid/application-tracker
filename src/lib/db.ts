import { PrismaClient } from "@prisma/client";

// Next.js reloads modules in development, so the client is kept on globalThis
// to stop every reload opening another pool against the same SQLite file.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/**
 * Every pipeline stage takes one of these rather than importing the singleton,
 * so the same code can be pointed at a scratch copy of the database (LOOP 3.2).
 * The app passes `prisma`; the loop harness passes a client opened on its own
 * file.
 */
export type Db = PrismaClient;
