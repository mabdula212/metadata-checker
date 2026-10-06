import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  prisma,
  getOptimizedDatabaseUrl,
  isTransientConnectionError,
} from "../lib/db/prisma.js";
import { checkDatabaseHealth } from "../lib/db/db-util.js";

describe("Database Connection Resilience & Neon Pooler Optimization", () => {
  it("1. automatically configures pgbouncer=true on Neon pooler endpoints", () => {
    const rawNeonUrl =
      "postgresql://neondb_owner:secret@ep-solitary-art-a71oriw4-pooler.ap-southeast-2.aws.neon.tech/metadata-checker?sslmode=require";
    const optimized = getOptimizedDatabaseUrl(rawNeonUrl);

    assert.ok(optimized, "Optimized URL must be returned");
    const parsed = new URL(optimized);
    assert.equal(parsed.searchParams.get("pgbouncer"), "true");
    assert.equal(parsed.searchParams.get("connect_timeout"), "30");
    assert.equal(parsed.searchParams.get("pool_timeout"), "30");
    assert.equal(parsed.searchParams.get("connection_limit"), "10");
    assert.equal(parsed.searchParams.get("sslmode"), "require");
  });

  it("2. preserves custom parameter values if already configured", () => {
    const customUrl =
      "postgresql://user:pass@ep-pooler.aws.neon.tech/db?pgbouncer=true&connect_timeout=45&connection_limit=5";
    const optimized = getOptimizedDatabaseUrl(customUrl);

    assert.ok(optimized);
    const parsed = new URL(optimized);
    assert.equal(parsed.searchParams.get("pgbouncer"), "true");
    assert.equal(parsed.searchParams.get("connect_timeout"), "45");
    assert.equal(parsed.searchParams.get("connection_limit"), "5");
    assert.equal(parsed.searchParams.get("pool_timeout"), "30");
  });

  it("3. handles empty or invalid database URLs gracefully without throwing", () => {
    assert.equal(getOptimizedDatabaseUrl(undefined), undefined);
    assert.equal(getOptimizedDatabaseUrl(""), undefined);
    assert.equal(getOptimizedDatabaseUrl("not-a-valid-url"), "not-a-valid-url");
  });

  it("4. accurately classifies transient closed connection errors for auto-retry", () => {
    // The exact error reported by Neon / Prisma:
    const neonClosedError = new Error(
      "prisma:error Error in PostgreSQL connection: Error { kind: Closed, cause: None }"
    );
    assert.equal(
      isTransientConnectionError(neonClosedError),
      true,
      "Neon Closed connection must be transient"
    );

    // Common serverless cold-start and timeout errors
    assert.equal(
      isTransientConnectionError(new Error("Can't reach database server at ... P1001")),
      true
    );
    assert.equal(
      isTransientConnectionError(new Error("The server closed the connection (P1017)")),
      true
    );
    assert.equal(
      isTransientConnectionError(new Error("read ECONNRESET: connection reset by peer")),
      true
    );
    assert.equal(
      isTransientConnectionError(new Error("Connection terminated unexpectedly")),
      true
    );
    assert.equal(
      isTransientConnectionError(new Error("socket closed unexpectedly")),
      true
    );
  });

  it("5. does not classify logical or constraint errors as transient", () => {
    assert.equal(
      isTransientConnectionError(new Error("Unique constraint failed on the fields: (`email`)")),
      false
    );
    assert.equal(
      isTransientConnectionError(new Error("Record to update not found.")),
      false
    );
    assert.equal(
      isTransientConnectionError(new Error("Invalid `prisma.user.create()` invocation")),
      false
    );
    assert.equal(isTransientConnectionError(null), false);
    assert.equal(isTransientConnectionError(undefined), false);
  });

  it("6. guarantees unconditional PrismaClient singleton across imports", async () => {
    const module1 = await import("../lib/db/prisma.js");
    const module2 = await import("../lib/db/prisma.js");

    assert.equal(
      module1.prisma,
      module2.prisma,
      "Both imports must return the exact same singleton instance"
    );
    assert.equal(
      module1.prisma,
      prisma,
      "Exported prisma must match the imported singleton"
    );
  });

  it("7. successfully executes database health check with latency reporting", async () => {
    const health = await checkDatabaseHealth();

    assert.equal(health.connected, true, "Database should report connected");
    assert.ok(typeof health.latencyMs === "number", "Latency must be a number");
    assert.ok(health.latencyMs! >= 0, "Latency must be non-negative");
    assert.ok(health.timestamp, "Timestamp must be present");
  });

  it("8. successfully executes model queries through the resilient Prisma client", async () => {
    // Verify standard findMany query works cleanly through extended client
    const users = await prisma.user.findMany({ take: 1 });
    assert.ok(Array.isArray(users), "Must return an array of users");
  });
});
