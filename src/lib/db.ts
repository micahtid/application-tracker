import { PrismaClient } from "@prisma/client";

// Next.js reloads modules in development, so the client is kept on globalThis
// to stop every reload opening another pool against the same SQLite file.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
