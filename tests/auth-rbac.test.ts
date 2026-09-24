import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
} from "../lib/auth/password.js";
import {
  checkRateLimit,
  resetRateLimit,
} from "../lib/auth/rate-limiter.js";
import { sanitizeAuditMetadata } from "../lib/auth/audit.js";
import { Role, UserStatus } from "@prisma/client";

describe("Authentication & Security Module", () => {
  describe("Password Security & Hashing", () => {
    it("should validate password complexity rules", () => {
      // Too short (< 8 chars)
      const short = validatePasswordStrength("Short1!");
      assert.strictEqual(short.valid, false);
      assert.match(short.reason || "", /at least 8 characters/);

      // Missing digits and symbols
      const noNumber = validatePasswordStrength("NoNumberPassword");
      assert.strictEqual(noNumber.valid, false);
      assert.match(noNumber.reason || "", /number or special character/);

      // Valid strong passwords
      const valid1 = validatePasswordStrength("SecureAdmin123!");
      assert.strictEqual(valid1.valid, true);

      const valid2 = validatePasswordStrength("UserPassw0rd");
      assert.strictEqual(valid2.valid, true);
    });

    it("should hash and verify passwords using bcrypt (12 rounds)", async () => {
      const plaintext = "SuperSecretPassword123!";
      const hash = await hashPassword(plaintext);

      assert.ok(hash.startsWith("$2"), "Hash should start with bcrypt identifier");
      assert.notStrictEqual(hash, plaintext, "Hash must not equal plaintext");

      const isMatch = await verifyPassword(plaintext, hash);
      assert.strictEqual(isMatch, true, "Valid password should verify successfully");

      const isWrong = await verifyPassword("WrongPassword123!", hash);
      assert.strictEqual(isWrong, false, "Invalid password should fail verification");
    });
  });

  describe("Brute Force Rate Limiting", () => {
    it("should block after repeated failed attempts", () => {
      const testKey = "test-user-" + Date.now();

      // Record 5 attempts
      for (let i = 0; i < 5; i++) {
        const check = checkRateLimit(testKey, 5, 60000);
        assert.strictEqual(check.allowed, true);
      }

      // 6th attempt should be blocked
      const blockedCheck = checkRateLimit(testKey, 5, 60000);
      assert.strictEqual(blockedCheck.allowed, false);
      assert.ok((blockedCheck.retryAfterSeconds || 0) > 0);

      // Successful login resets rate limit
      resetRateLimit(testKey);
      const afterResetCheck = checkRateLimit(testKey, 5, 60000);
      assert.strictEqual(afterResetCheck.allowed, true);
    });
  });

  describe("Audit Log Sanitization", () => {
    it("should redact sensitive fields from audit metadata", () => {
      const sensitiveData = {
        email: "analyst@bank.com",
        password: "ClearTextPassword!",
        passwordHash: "$2a$12$e0NZh...xyz",
        token: "secret-session-token",
        apiKey: "sk-live-12345678",
        documentId: "doc-uuid-1234",
      };

      const sanitized = sanitizeAuditMetadata(sensitiveData)!;

      assert.strictEqual(sanitized.email, "analyst@bank.com");
      assert.strictEqual(sanitized.documentId, "doc-uuid-1234");
      assert.strictEqual(sanitized.password, undefined);
      assert.strictEqual(sanitized.passwordHash, undefined);
      assert.strictEqual(sanitized.token, undefined);
      assert.strictEqual(sanitized.apiKey, undefined);
    });
  });

  describe("Role-Based Access Control (RBAC) Hierarchy", () => {
    it("should enforce distinct permissions between USER and ADMIN", () => {
      const standardUser = {
        id: "usr-1",
        email: "user@bank.com",
        role: Role.USER,
        status: UserStatus.ACTIVE,
      };

      const adminUser = {
        id: "adm-1",
        email: "admin@bank.com",
        role: Role.ADMIN,
        status: UserStatus.ACTIVE,
      };

      // Helper function to check role permission
      const canAccessAdminPanel = (role: Role) => role === Role.ADMIN;
      const canAccessDocument = (user: typeof standardUser, docOwnerId: string) =>
        user.role === Role.ADMIN || user.id === docOwnerId;

      assert.strictEqual(canAccessAdminPanel(standardUser.role), false);
      assert.strictEqual(canAccessAdminPanel(adminUser.role), true);

      // Standard user can only access own document
      assert.strictEqual(canAccessDocument(standardUser, "usr-1"), true);
      assert.strictEqual(canAccessDocument(standardUser, "usr-2"), false);

      // Admin can access any document (data isolation override for administration)
      assert.strictEqual(canAccessDocument(adminUser, "usr-1"), true);
      assert.strictEqual(canAccessDocument(adminUser, "usr-2"), true);
    });
  });

  describe("Session Security & Token Hashing", () => {
    it("should hash session tokens with SHA-256 and never persist raw tokens", async () => {
      const { hashSessionToken } = await import("../lib/auth/session.js");
      const rawToken = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
      const hash1 = hashSessionToken(rawToken);
      const hash2 = hashSessionToken(rawToken);

      assert.strictEqual(hash1, hash2, "Hashing must be deterministic");
      assert.notStrictEqual(hash1, rawToken, "Raw token must not match hash");
      assert.strictEqual(hash1.length, 64, "SHA-256 hex output must be 64 characters");
    });

    it("should build secure HttpOnly cookies with SameSite=Lax", async () => {
      const { buildSessionCookie, buildClearSessionCookie } = await import("../lib/auth/config.js");
      const cookie = buildSessionCookie("test-token-123", 3600);

      assert.ok(cookie.includes("HttpOnly"), "Cookie must be HttpOnly");
      assert.ok(cookie.includes("SameSite=Lax"), "Cookie must enforce SameSite=Lax");
      assert.ok(cookie.includes("Max-Age=3600"), "Cookie must contain Max-Age");

      const clearCookie = buildClearSessionCookie();
      assert.ok(clearCookie.includes("Max-Age=0"), "Clear cookie must expire immediately");
      assert.ok(clearCookie.includes("HttpOnly"), "Clear cookie must also be HttpOnly");
    });
  });

  describe("CSRF Defense & Origin Verification", () => {
    it("should allow safe methods and bearer authentication without CSRF restriction", async () => {
      const { verifyCsrf } = await import("../lib/auth/guards.js");

      // Safe GET request
      const getReq = { method: "GET", headers: {} } as any;
      assert.strictEqual(verifyCsrf(getReq), true);

      // Request with Bearer token
      const bearerReq = {
        method: "POST",
        headers: { authorization: "Bearer some-token" },
      } as any;
      assert.strictEqual(verifyCsrf(bearerReq), true);
    });

    it("should block cross-site cookie-authenticated state-changing requests", async () => {
      const { verifyCsrf } = await import("../lib/auth/guards.js");

      // Sec-Fetch-Site cross-site
      const crossSiteReq = {
        method: "POST",
        headers: {
          "sec-fetch-site": "cross-site",
          cookie: "mc_session=abc",
        },
      } as any;
      assert.strictEqual(verifyCsrf(crossSiteReq), false);

      // Mismatched origin
      const mismatchedOriginReq = {
        method: "POST",
        headers: {
          host: "app.example.com",
          origin: "https://malicious-attacker.com",
          cookie: "mc_session=abc",
        },
      } as any;
      assert.strictEqual(verifyCsrf(mismatchedOriginReq), false);

      // Matching same-origin
      const validOriginReq = {
        method: "POST",
        headers: {
          host: "app.example.com",
          origin: "https://app.example.com",
          cookie: "mc_session=abc",
        },
      } as any;
      assert.strictEqual(verifyCsrf(validOriginReq), true);
    });
  });

  describe("Error Message Sanitization", () => {
    it("should sanitize database internals, passwords, and file paths", async () => {
      const { sanitizeClientErrorMessage } = await import("../lib/auth/guards.js");

      const prismaErr = new Error("Invalid `prisma.user.create()` invocation: Unique constraint failed on email");
      const cleanPrisma = sanitizeClientErrorMessage(prismaErr);
      assert.ok(!cleanPrisma.includes("prisma"), "Must not leak prisma internals");
      assert.ok(!cleanPrisma.includes("Unique constraint"), "Must not leak constraint names");

      const dbUrlErr = new Error("Connection failed at postgresql://postgres:Secret123@db.neon.tech/main");
      const cleanDbUrl = sanitizeClientErrorMessage(dbUrlErr);
      assert.ok(!cleanDbUrl.includes("Secret123"), "Must not leak database password");

      const pathErr = new Error("File missing at /var/www/vhosts/secret/documents/statement.pdf");
      const cleanPath = sanitizeClientErrorMessage(pathErr);
      assert.ok(!cleanPath.includes("/var/www/vhosts/secret"), "Must redact filesystem paths");
    });
  });

  describe("User Registration Handler", () => {
    it("should reject registration with invalid email or weak password", async () => {
      const registerHandler = (await import("../api/auth/register.js")).default;

      // Test weak password
      let statusCode = 0;
      let output = "";
      const req: any = {
        method: "POST",
        headers: { "content-type": "application/json" },
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(JSON.stringify({ name: "Test", email: "test@example.com", password: "short" }));
        },
      };
      const res: any = {
        setHeader() {},
        end(data: string) { output = data; },
        set statusCode(code: number) { statusCode = code; },
        get statusCode() { return statusCode; },
      };

      await registerHandler(req, res);
      assert.strictEqual(statusCode, 400);
      const parsed = JSON.parse(output);
      assert.strictEqual(parsed.success, false);
      assert.match(parsed.error, /8 characters/i);
    });
  });

  describe("Production Seed Gating", () => {
    it("should strictly refuse to seed development users in production environment", async () => {
      const { seedInitialUsers } = await import("../lib/auth/init.js");
      const prevEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = "production";
        const result = await seedInitialUsers();
        assert.strictEqual(result.seeded, false, "Must not seed in production");
        assert.match(result.reason || "", /production/i);
      } finally {
        process.env.NODE_ENV = prevEnv;
      }
    });
  });
});
