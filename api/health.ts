import type { IncomingMessage, ServerResponse } from "http";
import { checkDatabaseHealth } from "../lib/db/db-util.js";

/**
 * Minimal server-side database health-check function.
 * Compatible with Node.js HTTP servers and Vercel serverless functions (/api/health).
 *
 * NOTE: Database access is strictly confined to server-side execution.
 * Never import Prisma into frontend React components.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const health = await checkDatabaseHealth();
  res.statusCode = health.connected ? 200 : 503;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      service: "metadata-checker-db",
      status: health.connected ? "healthy" : "unconnected",
      database: health,
    })
  );
}
