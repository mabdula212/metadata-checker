import { PrismaClient } from "@prisma/client";

/**
 * Server-side Prisma Client Singleton with Neon Connection Pooling & Resilience.
 *
 * Prevents "prisma:error Error in PostgreSQL connection: Error { kind: Closed, cause: None }" by:
 * 1. Automatically appending `pgbouncer=true` when connecting to Neon / PgBouncer pooler endpoints
 *    (preventing prepared-statement conflicts in transaction pooling mode).
 * 2. Setting robust `connect_timeout=30` and `pool_timeout=30` for Neon serverless cold-start activation.
 * 3. Enforcing a conservative `connection_limit=10` to avoid connection pool exhaustion.
 * 4. Transparently retrying transient connection drops (e.g. idle compute sleep / scale-to-zero).
 * 5. Maintaining an unconditional singleton across all module reloads to prevent leaked client instances.
 *
 * NOTE: Database access must strictly remain server-side.
 * Never import this file into browser / client components.
 */

/**
 * Identifies transient network and connection drop errors that can be safely retried.
 */
export function isTransientConnectionError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  return (
    lower.includes("kind: closed") ||
    lower.includes("closed, cause: none") ||
    lower.includes("connection closed") ||
    lower.includes("connection reset") ||
    lower.includes("connection terminated") ||
    lower.includes("socket closed") ||
    lower.includes("can't reach database server") ||
    lower.includes("p1001") ||
    lower.includes("p1017")
  );
}

/**
 * Optimizes the PostgreSQL database URL for serverless connection pooling.
 */
export function getOptimizedDatabaseUrl(rawUrl?: string): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    const isPooler = host.includes("-pooler") || host.includes("pgbouncer");
    const isNeon = host.includes("neon.tech");

    // PgBouncer in transaction mode requires pgbouncer=true to disable prepared statements
    if (isPooler || isNeon) {
      if (!url.searchParams.has("pgbouncer")) {
        url.searchParams.set("pgbouncer", "true");
      }
    }

    // Neon scale-to-zero cold starts take 1-3 seconds; ensure generous timeouts
    if (!url.searchParams.has("connect_timeout")) {
      url.searchParams.set("connect_timeout", "30");
    }

    if (!url.searchParams.has("pool_timeout")) {
      url.searchParams.set("pool_timeout", "30");
    }

    // Limit client connection pool size per serverless/dev instance to prevent exhaustion
    if (!url.searchParams.has("connection_limit")) {
      url.searchParams.set("connection_limit", "10");
    }

    if (!url.searchParams.has("sslmode") && isNeon) {
      url.searchParams.set("sslmode", "require");
    }

    return url.toString();
  } catch {
    return rawUrl;
  }
}

function createPrismaClient(): PrismaClient {
  const optimizedUrl = getOptimizedDatabaseUrl(process.env.DATABASE_URL);

  const clientOptions: any = {
    log:
      process.env.NODE_ENV === "development"
        ? ["error", "warn"]
        : ["error"],
  };

  if (optimizedUrl) {
    clientOptions.datasources = {
      db: {
        url: optimizedUrl,
      },
    };
  }

  const baseClient = new PrismaClient(clientOptions);

  // Extend PrismaClient with automatic transient connection retry
  const extendedClient = baseClient.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          let attempt = 0;
          const maxRetries = 2;
          while (true) {
            try {
              return await query(args);
            } catch (err: unknown) {
              attempt++;
              if (attempt > maxRetries || !isTransientConnectionError(err)) {
                throw err;
              }
              const errStr = err instanceof Error ? err.message : String(err);
              console.warn(
                `[PRISMA_RETRY] Retrying ${model}.${operation} after transient connection drop (attempt ${attempt}/${maxRetries}): ${errStr.slice(0, 100)}`
              );
              // Clean up stale socket from internal pool
              await baseClient.$disconnect().catch(() => {});
              // Exponential backoff with jitter
              const backoff = 500 * Math.pow(2, attempt - 1) + Math.random() * 200;
              await new Promise((res) => setTimeout(res, backoff));
            }
          }
        },
      },
    },
  });

  return extendedClient as unknown as PrismaClient;
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

// Unconditionally preserve singleton across reloads in both dev and production
globalForPrisma.prisma = prisma;

export default prisma;

