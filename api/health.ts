import type { IncomingMessage, ServerResponse } from "http";
import { checkDatabaseHealth } from "../lib/db/db-util.js";
import { getStorageDiagnostic } from "../lib/storage/index.js";

/**
 * Minimal server-side database & storage health-check function.
 * Compatible with Node.js HTTP servers and Vercel serverless functions (/api/health).
 *
 * NOTE: Database and storage credentials are strictly confined to server-side execution.
 * Never expose tokens, keys, or connection secrets.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Method not allowed" }));
    return;
  }

  const health = await checkDatabaseHealth();
  const storage = getStorageDiagnostic();

  res.statusCode = health.connected ? 200 : 503;
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      service: "metadata-checker-db",
      status: health.connected ? "healthy" : "unconnected",
      database: health,
      storage: {
        provider: storage.provider,
        blobConfigured: storage.blobConfigured,
        adapter: storage.adapter,
      },
    })
  );
}
