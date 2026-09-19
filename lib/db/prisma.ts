import { PrismaClient } from "@prisma/client";

/**
 * Server-side Prisma Client Singleton.
 * In development, hot-reloading can create multiple PrismaClient instances,
 * leading to database connection exhaustion on pooled connections (like Neon).
 * This pattern ensures only one instance is maintained across reloads.
 *
 * NOTE: Database access must strictly remain server-side.
 * Never import this file into browser / client components.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
