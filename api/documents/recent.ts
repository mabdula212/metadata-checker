import type { IncomingMessage, ServerResponse } from "http";
import { getRecentDocuments } from "../../lib/db/documents";

/**
 * API handler to fetch recent analyzed documents.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end(JSON.stringify({ success: false, error: "Method not allowed. Use GET." }));
    return;
  }

  try {
    const documents = await getRecentDocuments(5);
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        success: true,
        data: documents,
      })
    );
  } catch (err: unknown) {
    const rawMessage = err instanceof Error ? err.message : "Failed to retrieve recent documents.";
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        success: false,
        error: rawMessage.slice(0, 200),
      })
    );
  }
}
