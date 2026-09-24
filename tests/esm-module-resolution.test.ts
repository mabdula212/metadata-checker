import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";

// 1. Static imports verifying resolution of required modules
import { prisma } from "../lib/db/prisma.js";
import { checkDatabaseHealth } from "../lib/db/db-util.js";
import {
  hashPassword,
  validatePasswordStrength,
  createSession,
  validateRequestSession,
  buildSessionCookie,
  buildClearSessionCookie,
  requireAuth,
  checkRateLimit,
  logAuditEvent,
} from "../lib/auth/index.js";
import { getAuthSecret } from "../lib/auth/config.js";
import { verifyPassword } from "../lib/auth/password.js";
import { requireRole, requireDocumentOwner, requireExportOwner } from "../lib/auth/guards.js";

// Import Vercel API Route Handlers
import healthHandler from "../api/health.js";
import sessionHandler from "../api/auth/session.js";
import loginHandler from "../api/auth/login.js";
import registerHandler from "../api/auth/register.js";
import logoutHandler from "../api/auth/logout.js";
import adminUsersHandler from "../api/admin/users.js";
import adminResetPasswordHandler from "../api/admin/reset-password.js";
import bankDetectionHandler from "../api/bank-detection.js";
import transactionExtractionHandler from "../api/transaction-extraction.js";
import excelExportHandler from "../api/excel-export.js";
import pdfInspectHandler from "../api/pdf/inspect.js";

// Helper to mock Node HTTP request & response
function createMockHttpReqRes(options: {
  method: string;
  url?: string;
  headers?: Record<string, string>;
  body?: any;
}) {
  const req = new EventEmitter() as any;
  req.method = options.method;
  req.url = options.url || "/";
  req.headers = options.headers || {};
  if (options.body !== undefined) {
    req.body = options.body;
  }

  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: "",
    setHeader(name: string, val: string) {
      this.headers[name.toLowerCase()] = val;
    },
    getHeader(name: string) {
      return this.headers[name.toLowerCase()];
    },
    end(data?: string | Buffer) {
      if (data) {
        this.body += Buffer.isBuffer(data) ? data.toString("utf-8") : data;
      }
    },
  };

  return { req, res };
}

describe("Vercel ESM Module Resolution & API Handlers Audit", () => {
  it("1. verifies core database and auth lib modules resolve correctly", () => {
    assert.ok(prisma, "Prisma client instance must be resolved");
    assert.strictEqual(typeof checkDatabaseHealth, "function");
    assert.strictEqual(typeof hashPassword, "function");
    assert.strictEqual(typeof validatePasswordStrength, "function");
    assert.strictEqual(typeof createSession, "function");
    assert.strictEqual(typeof validateRequestSession, "function");
    assert.strictEqual(typeof buildSessionCookie, "function");
    assert.strictEqual(typeof buildClearSessionCookie, "function");
    assert.strictEqual(typeof requireAuth, "function");
    assert.strictEqual(typeof checkRateLimit, "function");
    assert.strictEqual(typeof logAuditEvent, "function");
    assert.strictEqual(typeof getAuthSecret, "function");
    assert.strictEqual(typeof verifyPassword, "function");
    assert.strictEqual(typeof requireRole, "function");
    assert.strictEqual(typeof requireDocumentOwner, "function");
    assert.strictEqual(typeof requireExportOwner, "function");
  });

  it("2. verifies all Vercel API function handlers are functions", () => {
    assert.strictEqual(typeof healthHandler, "function");
    assert.strictEqual(typeof sessionHandler, "function");
    assert.strictEqual(typeof loginHandler, "function");
    assert.strictEqual(typeof registerHandler, "function");
    assert.strictEqual(typeof logoutHandler, "function");
    assert.strictEqual(typeof adminUsersHandler, "function");
    assert.strictEqual(typeof adminResetPasswordHandler, "function");
    assert.strictEqual(typeof bankDetectionHandler, "function");
    assert.strictEqual(typeof transactionExtractionHandler, "function");
    assert.strictEqual(typeof excelExportHandler, "function");
    assert.strictEqual(typeof pdfInspectHandler, "function");
  });

  it("3. verifies dynamic ESM imports of server modules work at runtime", async () => {
    const prismaModule = await import("../lib/db/prisma.js");
    assert.ok(prismaModule.prisma);

    const authIndexModule = await import("../lib/auth/index.js");
    assert.ok(authIndexModule.validateRequestSession);

    const authSessionModule = await import("../lib/auth/session.js");
    assert.ok(authSessionModule.createSession);

    const authGuardsModule = await import("../lib/auth/guards.js");
    assert.ok(authGuardsModule.requireAuth);

    const registerApiModule = await import("../api/auth/register.js");
    assert.strictEqual(typeof registerApiModule.default, "function");

    const loginApiModule = await import("../api/auth/login.js");
    assert.strictEqual(typeof loginApiModule.default, "function");

    const sessionApiModule = await import("../api/auth/session.js");
    assert.strictEqual(typeof sessionApiModule.default, "function");

    const logoutApiModule = await import("../api/auth/logout.js");
    assert.strictEqual(typeof logoutApiModule.default, "function");
  });

  it("4. verifies zero extensionless or directory relative imports in api/** and lib/**", () => {
    function getAllFiles(dir: string, exts = [".ts", ".js"]): string[] {
      let results: string[] = [];
      if (!fs.existsSync(dir)) return results;
      const list = fs.readdirSync(dir);
      list.forEach((file) => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
          results = results.concat(getAllFiles(fullPath, exts));
        } else if (exts.some((ext) => file.endsWith(ext))) {
          results.push(fullPath);
        }
      });
      return results;
    }

    const files = [...getAllFiles("api"), ...getAllFiles("lib")];
    const importRegex = /(from\s+["\x27]|import\s*\(\s*["\x27])([\.\/][^\x27"\n]+)(["\x27]\s*\)?)/g;
    const violations: { file: string; importPath: string }[] = [];

    files.forEach((file) => {
      const content = fs.readFileSync(file, "utf8");
      let match: RegExpExecArray | null;
      while ((match = importRegex.exec(content)) !== null) {
        const importPath = match[2];
        const resolvedBase = path.resolve(path.dirname(file), importPath);
        const ext = path.extname(importPath);

        // Check if directory import
        if (fs.existsSync(resolvedBase) && fs.statSync(resolvedBase).isDirectory()) {
          violations.push({ file, importPath });
        } else if (!ext) {
          violations.push({ file, importPath });
        }
      }
    });

    assert.deepStrictEqual(
      violations,
      [],
      `Found ${violations.length} relative imports without explicit extensions or index.js: ` +
        JSON.stringify(violations)
    );
  });

  it("5. simulates GET /api/health function handler", async () => {
    const { req, res } = createMockHttpReqRes({ method: "GET", url: "/api/health" });
    await healthHandler(req, res);
    assert.ok(res.statusCode === 200 || res.statusCode === 503);
    const parsed = JSON.parse(res.body);
    assert.strictEqual(parsed.service, "metadata-checker-db");
    assert.ok(parsed.database);
    assert.strictEqual(typeof parsed.database.connected, "boolean");
  });

  it("6. simulates GET /api/auth/session without cookies returns unauthenticated", async () => {
    const { req, res } = createMockHttpReqRes({ method: "GET", url: "/api/auth/session" });
    await sessionHandler(req, res);
    assert.strictEqual(res.statusCode, 200);
    const parsed = JSON.parse(res.body);
    assert.strictEqual(parsed.authenticated, false);
    assert.strictEqual(parsed.user, null);
  });

  it("7. simulates POST /api/auth/login with invalid credentials returns 401", async () => {
    const { req, res } = createMockHttpReqRes({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      body: { email: "nonexistent@example.com", password: "Password123!" },
    });
    await loginHandler(req, res);
    assert.strictEqual(res.statusCode, 401);
    const parsed = JSON.parse(res.body);
    assert.strictEqual(parsed.success, false);
    assert.ok(parsed.error);
  });

  it("8. simulates POST /api/auth/register with missing fields returns 400", async () => {
    const { req, res } = createMockHttpReqRes({
      method: "POST",
      url: "/api/auth/register",
      headers: { "content-type": "application/json" },
      body: { name: "Test User" }, // missing email and password
    });
    await registerHandler(req, res);
    assert.strictEqual(res.statusCode, 400);
    const parsed = JSON.parse(res.body);
    assert.strictEqual(parsed.success, false);
    assert.ok(parsed.error);
  });

  it("9. simulates POST /api/auth/logout sets expiration cookie", async () => {
    const { req, res } = createMockHttpReqRes({
      method: "POST",
      url: "/api/auth/logout",
    });
    await logoutHandler(req, res);
    assert.strictEqual(res.statusCode, 200);
    const setCookie = res.headers["set-cookie"];
    assert.ok(setCookie, "Logout must set clearing cookie");
    assert.match(setCookie, /mc_session=;/);
    const parsed = JSON.parse(res.body);
    assert.strictEqual(parsed.success, true);
  });
});
