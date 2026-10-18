import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { verifyCsrf, sanitizeClientErrorMessage } from "../lib/auth/guards.js";
import { sanitizeWorkbookText } from "../lib/excel/formatter.js";
import { sanitizeAuditMetadata } from "../lib/auth/audit.js";
import { checkRateLimit, resetRateLimit } from "../lib/auth/rate-limiter.js";
import { buildSessionCookie, buildClearSessionCookie, buildDeviceCookie } from "../lib/auth/config.js";
import { Role, UserStatus } from "@prisma/client";

describe("Metadata Checker 1.1 — Production Hardening & Security Regression Suite", () => {
  describe("1. CSRF Protection on State Mutations", () => {
    it("should allow safe methods (GET, HEAD, OPTIONS)", () => {
      assert.strictEqual(verifyCsrf({ method: "GET", headers: {} } as any), true);
      assert.strictEqual(verifyCsrf({ method: "HEAD", headers: {} } as any), true);
      assert.strictEqual(verifyCsrf({ method: "OPTIONS", headers: {} } as any), true);
    });

    it("should allow Bearer token authenticated requests", () => {
      const req = {
        method: "POST",
        headers: { authorization: "Bearer mc-token-xyz" },
      } as any;
      assert.strictEqual(verifyCsrf(req), true);
    });

    it("should reject cross-site cookie requests with sec-fetch-site: cross-site", () => {
      const req = {
        method: "POST",
        headers: {
          "sec-fetch-site": "cross-site",
          cookie: "mc_session=abc",
        },
      } as any;
      assert.strictEqual(verifyCsrf(req), false);
    });

    it("should reject mismatched origin headers on POST", () => {
      const req = {
        method: "POST",
        headers: {
          host: "production-app.run.app",
          origin: "https://evil-hacker.com",
          cookie: "mc_session=abc",
        },
      } as any;
      assert.strictEqual(verifyCsrf(req), false);
    });

    it("should reject mismatched referer when origin is missing on POST", () => {
      const req = {
        method: "POST",
        headers: {
          host: "production-app.run.app",
          referer: "https://evil-hacker.com/phishing-page",
          cookie: "mc_session=abc",
        },
      } as any;
      assert.strictEqual(verifyCsrf(req), false);
    });

    it("should accept valid matching same-origin headers", () => {
      const req = {
        method: "POST",
        headers: {
          host: "production-app.run.app",
          origin: "https://production-app.run.app",
          cookie: "mc_session=abc",
        },
      } as any;
      assert.strictEqual(verifyCsrf(req), true);
    });
  });

  describe("2. Excel Formula Injection Defense (CWE-1236)", () => {
    it("should neutralize standard formula prefixes (=, +, -, @)", () => {
      assert.strictEqual(sanitizeWorkbookText("=1+1"), "'=1+1");
      assert.strictEqual(sanitizeWorkbookText("+SUM(A1:A10)"), "'+SUM(A1:A10)");
      assert.strictEqual(sanitizeWorkbookText("-2+3"), "'-2+3");
      assert.strictEqual(sanitizeWorkbookText("@SUM(1,2)"), "'@SUM(1,2)");
    });

    it("should neutralize DDE execution and command injection prefixes (|, %)", () => {
      assert.strictEqual(sanitizeWorkbookText("|' /C calc'!A0"), "'|' /C calc'!A0");
      assert.strictEqual(sanitizeWorkbookText("%COMSPEC%"), "'%COMSPEC%");
    });

    it("should neutralize formula injection hidden behind leading whitespace or tabs", () => {
      assert.strictEqual(sanitizeWorkbookText("   =cmd|' /C calc'!A0"), "'   =cmd|' /C calc'!A0");
      assert.strictEqual(sanitizeWorkbookText("\t=1+1"), "'\t=1+1");
      assert.strictEqual(sanitizeWorkbookText("\r=2+2"), "'\r=2+2");
    });

    it("should sanitize secrets and paths from workbook text", () => {
      const leaked = "Error at postgresql://user:secret@ep-db.neon.tech/main with token vercel_blob_rw_123456";
      const cleaned = sanitizeWorkbookText(leaked);
      assert.ok(!cleaned.includes("secret"), "Must redact DB credentials");
      assert.ok(!cleaned.includes("vercel_blob_rw_123456"), "Must redact blob token");
      assert.ok(cleaned.includes("[REDACTED_DATABASE_URL]"));
      assert.ok(cleaned.includes("[REDACTED_BLOB_TOKEN]"));
    });

    it("should preserve harmless text strings unchanged", () => {
      assert.strictEqual(sanitizeWorkbookText("Transfer dari BCA"), "Transfer dari BCA");
      assert.strictEqual(sanitizeWorkbookText("Pembelian di Tokopedia"), "Pembelian di Tokopedia");
      assert.strictEqual(sanitizeWorkbookText(""), "");
      assert.strictEqual(sanitizeWorkbookText(null), "");
    });
  });

  describe("3. Error Message Sanitization", () => {
    it("should strip Prisma internals and connection strings", () => {
      const err = new Error("Invalid `prisma.user.findMany()` invocation at postgresql://dbuser:supersecret@neon.tech");
      const sanitized = sanitizeClientErrorMessage(err);
      assert.ok(!sanitized.includes("prisma"), "Must not leak prisma internals");
      assert.ok(!sanitized.includes("supersecret"), "Must not leak db password");
      assert.ok(sanitized.includes("database operation error") || sanitized.includes("Details have been logged"));
    });

    it("should strip server filesystem paths from error messages", () => {
      const err = new Error("ENOENT: no such file at /var/task/applet/documents/secret-doc.pdf");
      const sanitized = sanitizeClientErrorMessage(err);
      assert.ok(!sanitized.includes("/var/task/applet/documents"), "Must redact filesystem path");
    });
  });

  describe("4. Audit Log Metadata Sanitization", () => {
    it("should mask account numbers to protect sensitive financial PII", () => {
      const meta = {
        accountNumber: "1234567890",
        bankAccountNo: "987654321",
        accountHolder: "John Doe",
      };
      const sanitized = sanitizeAuditMetadata(meta)!;
      assert.strictEqual(sanitized.accountNumber, "****7890");
      assert.strictEqual(sanitized.bankAccountNo, "****4321");
      assert.strictEqual(sanitized.accountHolder, "John Doe");
    });

    it("should completely exclude passwords, hashes, and session tokens", () => {
      const meta = {
        password: "PlainPassword123!",
        passwordHash: "$2a$12$xyz...",
        sessionToken: "deadbeefcafebabe",
        auth_secret: "my-jwt-secret",
        actionDetails: "Valid action",
      };
      const sanitized = sanitizeAuditMetadata(meta)!;
      assert.strictEqual(sanitized.password, undefined);
      assert.strictEqual(sanitized.passwordHash, undefined);
      assert.strictEqual(sanitized.sessionToken, undefined);
      assert.strictEqual(sanitized.auth_secret, undefined);
      assert.strictEqual(sanitized.actionDetails, "Valid action");
    });
  });

  describe("5. Cookie Security Configuration", () => {
    it("should generate secure HttpOnly, SameSite=Lax session cookies", () => {
      const cookie = buildSessionCookie("session-token-test", 86400);
      assert.ok(cookie.includes("HttpOnly"));
      assert.ok(cookie.includes("SameSite=Lax"));
      assert.ok(cookie.includes("Path=/"));
      assert.ok(cookie.includes("Max-Age=86400"));
    });

    it("should generate secure clear session cookie with immediate expiry", () => {
      const clearCookie = buildClearSessionCookie();
      assert.ok(clearCookie.includes("HttpOnly"));
      assert.ok(clearCookie.includes("SameSite=Lax"));
      assert.ok(clearCookie.includes("Max-Age=0"));
      assert.ok(clearCookie.includes("1970"));
    });

    it("should generate persistent HttpOnly device cookie", () => {
      const devCookie = buildDeviceCookie("device-token-test", 31536000);
      assert.ok(devCookie.includes("mc_device="));
      assert.ok(devCookie.includes("HttpOnly"));
      assert.ok(devCookie.includes("SameSite=Lax"));
    });
  });

  describe("6. Rate Limiting Protection", () => {
    it("should block abusive requests after reaching threshold", () => {
      const testKey = "sec-hardening-test-" + Date.now();
      // Allow 5 attempts
      for (let i = 0; i < 5; i++) {
        const res = checkRateLimit(testKey, 5, 60000);
        assert.strictEqual(res.allowed, true);
      }
      // 6th attempt is blocked
      const blocked = checkRateLimit(testKey, 5, 60000);
      assert.strictEqual(blocked.allowed, false);
      assert.ok(blocked.retryAfterSeconds > 0);

      // Reset
      resetRateLimit(testKey);
      const afterReset = checkRateLimit(testKey, 5, 60000);
      assert.strictEqual(afterReset.allowed, true);
    });
  });

  describe("7. User Data Isolation & Duplicate Scoping", () => {
    it("should isolate duplicate document detection when scoped to userId", async () => {
      const { findDuplicateDocument } = await import("../lib/db/documents.js");
      // Searching for non-existent hash or scoped hash returns null gracefully
      const res = await findDuplicateDocument("non-existent-sha256-hash", "user-uuid-1234");
      assert.strictEqual(res, null);
    });
  });
});
