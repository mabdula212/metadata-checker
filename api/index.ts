import type { IncomingMessage, ServerResponse } from "http";
import loginHandler from "../server/auth/login.js";
import logoutHandler from "../server/auth/logout.js";
import registerHandler from "../server/auth/register.js";
import sessionHandler from "../server/auth/session.js";
import adminUsersHandler from "../server/admin/users.js";
import adminResetPasswordHandler from "../server/admin/reset-password.js";
import {
  loginRequestStatusHandler,
  adminLoginRequestsHandler,
} from "../lib/auth/index.js";
import pdfInspectHandler from "../server/pdf/inspect.js";
import bankDetectionHandler from "../server/bank-detection.js";
import transactionExtractionHandler from "../server/transaction-extraction.js";
import excelExportHandler from "../server/excel-export.js";
import dashboardHandler from "../server/dashboard.js";
import documentsHandler from "../server/documents.js";
import recentDocumentsHandler from "../server/documents/recent.js";
import healthHandler from "../server/health.js";

/**
 * Unified Serverless Function Router for Vercel Hobby Plan (1 Function instead of 14).
 * Handles all /api/* routes through a single entrypoint to comply with Vercel Hobby 12-function limit.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // Sensible security headers
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("X-XSS-Protection", "1; mode=block");

  // Resolve path across Vercel serverless rewrites and local development
  const rawUrl =
    (req.headers["x-forwarded-url"] as string) ||
    (req.headers["x-matched-path"] as string) ||
    req.url ||
    "/";

  const urlObj = new URL(rawUrl, "http://localhost");
  const pathParam = urlObj.searchParams.get("__path");
  let pathname = pathParam
    ? pathParam.startsWith("/")
      ? pathParam
      : `/${pathParam}`
    : urlObj.pathname;

  if (!pathname.startsWith("/api")) {
    pathname = `/api${pathname.startsWith("/") ? "" : "/"}${pathname}`;
  }
  pathname = pathname.replace(/\/+/g, "/");

  // Route to corresponding handler
  if (pathname === "/api/auth/login") {
    return loginHandler(req, res);
  }
  if (pathname === "/api/auth/register") {
    return registerHandler(req, res);
  }
  if (pathname === "/api/auth/logout") {
    return logoutHandler(req, res);
  }
  if (pathname === "/api/auth/session") {
    return sessionHandler(req, res);
  }
  if (pathname === "/api/auth/login-request") {
    return loginRequestStatusHandler(req, res);
  }
  if (pathname === "/api/admin/login-requests") {
    return adminLoginRequestsHandler(req, res);
  }
  if (pathname === "/api/admin/users" || pathname.startsWith("/api/admin/users/")) {
    return adminUsersHandler(req, res);
  }
  if (pathname === "/api/admin/reset-password") {
    return adminResetPasswordHandler(req, res);
  }
  if (pathname === "/api/pdf/inspect") {
    return pdfInspectHandler(req, res);
  }
  if (pathname === "/api/bank-detection") {
    return bankDetectionHandler(req, res);
  }
  if (pathname === "/api/transaction-extraction") {
    return transactionExtractionHandler(req, res);
  }
  if (pathname === "/api/excel-export" || pathname.startsWith("/api/excel-export/")) {
    return excelExportHandler(req, res);
  }
  if (pathname === "/api/dashboard") {
    return dashboardHandler(req, res);
  }
  if (pathname === "/api/documents/recent") {
    return recentDocumentsHandler(req, res);
  }
  if (pathname === "/api/documents" || pathname.startsWith("/api/documents/")) {
    return documentsHandler(req, res);
  }
  if (pathname === "/api/health") {
    return healthHandler(req, res);
  }

  res.statusCode = 404;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ success: false, error: "API route not found" }));
}
