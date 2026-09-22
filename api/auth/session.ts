import type { IncomingMessage, ServerResponse } from "http";
import { validateRequestSession } from "../../lib/auth";

/**
 * API Handler for Current Session Inspection.
 * Method: GET /api/auth/session
 */
export default async function sessionHandler(
  req: IncomingMessage,
  res: ServerResponse
) {
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "GET") {
    res.statusCode = 405;
    res.end(JSON.stringify({ success: false, error: "Method not allowed. Use GET." }));
    return;
  }

  try {
    const user = await validateRequestSession(req);

    if (!user) {
      res.statusCode = 200;
      res.end(JSON.stringify({ authenticated: false, user: null }));
      return;
    }

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        authenticated: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          status: user.status,
        },
      })
    );
  } catch (err) {
    console.error("[SESSION_HANDLER_ERROR]", err);
    res.statusCode = 500;
    res.end(JSON.stringify({ authenticated: false, user: null, error: "Internal server error" }));
  }
}
