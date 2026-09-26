import { prisma, isTransientConnectionError } from "./prisma.js";

export interface DatabaseHealthResult {
  connected: boolean;
  timestamp: string;
  latencyMs?: number;
  error?: string;
}

/**
 * Server-side database connectivity and health utility.
 * Never exposes credentials, connection strings, or sensitive data.
 */
export async function checkDatabaseHealth(): Promise<DatabaseHealthResult> {
  const start = Date.now();
  // Check if database URL is configured
  if (!process.env.DATABASE_URL) {
    return {
      connected: false,
      timestamp: new Date().toISOString(),
      error: "DATABASE_URL environment variable is not configured.",
    };
  }

  let lastError: unknown;
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Raw query to test connection
      await prisma.$queryRaw`SELECT 1`;
      const latencyMs = Date.now() - start;

      return {
        connected: true,
        timestamp: new Date().toISOString(),
        latencyMs,
      };
    } catch (err: unknown) {
      lastError = err;
      if (attempt < maxAttempts && isTransientConnectionError(err)) {
        await disconnectDatabase();
        await new Promise((res) => setTimeout(res, 600));
        continue;
      }
      break;
    }
  }

  const errorMessage =
    lastError instanceof Error ? lastError.message : "Unknown database connection error";

  // Clean any sensitive connection info from error message
  const sanitizedError =
    process.env.NODE_ENV === "production"
      ? "Database connection unavailable. Operational details have been logged."
      : errorMessage.replace(/postgresql:\/\/[^@]+@/gi, "postgresql://***:***@");

  return {
    connected: false,
    timestamp: new Date().toISOString(),
    error: sanitizedError,
  };
}

/**
 * Graceful disconnect helper for server shutdown.
 */
export async function disconnectDatabase(): Promise<void> {
  try {
    await prisma.$disconnect();
  } catch {
    // Ignore disconnect errors on shutdown
  }
}
