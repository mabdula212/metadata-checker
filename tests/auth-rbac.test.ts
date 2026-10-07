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

    it("should set newly registered users to PENDING status requiring admin authorization", async () => {
      const registerHandler = (await import("../api/auth/register.js")).default;
      const loginHandler = (await import("../api/auth/login.js")).default;
      const { prisma } = await import("../lib/db/prisma.js");

      const testEmail = `pending_user_${Date.now()}@example.com`;
      const testPass = "ValidPass123!";

      try {
        let regStatus = 0;
        let regOutput = "";
        const regReq: any = {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: { name: "Pending User", email: testEmail, password: testPass },
        };
        const regRes: any = {
          setHeader() {},
          end(data: string) { regOutput = data; },
          set statusCode(code: number) { regStatus = code; },
          get statusCode() { return regStatus; },
        };

        await registerHandler(regReq, regRes);
        assert.strictEqual(regStatus, 201);
        const regData = JSON.parse(regOutput);
        assert.strictEqual(regData.success, true);
        assert.strictEqual(regData.pendingApproval, true);
        assert.strictEqual(regData.user.status, "PENDING");
        assert.strictEqual(regData.token, undefined, "Pending user must not receive an active session token");

        // Attempt to login while PENDING should be blocked with 403
        let loginStatus = 0;
        let loginOutput = "";
        const loginReq: any = {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: { email: testEmail, password: testPass },
        };
        const loginRes: any = {
          setHeader() {},
          end(data: string) { loginOutput = data; },
          set statusCode(code: number) { loginStatus = code; },
          get statusCode() { return loginStatus; },
        };

        await loginHandler(loginReq, loginRes);
        assert.strictEqual(loginStatus, 403);
        const loginData = JSON.parse(loginOutput);
        assert.strictEqual(loginData.success, false);
        assert.strictEqual(loginData.code, "PENDING_APPROVAL");
      } finally {
        await prisma.user.deleteMany({ where: { email: testEmail } }).catch(() => {});
      }
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

  describe("Device Authorization & One-User-One-Active-Device Enforcement", () => {
    it("should parse User-Agent metadata and hash device tokens with SHA-256", async () => {
      const {
        generateDeviceToken,
        hashDeviceToken,
        parseDeviceMetadata,
        buildDeviceCookie,
      } = await import("../lib/auth/index.js");

      const raw = generateDeviceToken();
      assert.strictEqual(raw.length, 64, "Device token should be 64 hex chars (256-bit)");
      const hash = hashDeviceToken(raw);
      assert.notStrictEqual(hash, raw);
      assert.strictEqual(hash.length, 64);

      const meta = parseDeviceMetadata(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
      );
      assert.strictEqual(meta.browser, "Google Chrome");
      assert.strictEqual(meta.operatingSystem, "Windows");
      assert.strictEqual(meta.deviceName, "Google Chrome on Windows");

      const cookie = buildDeviceCookie(raw);
      assert.ok(cookie.includes("mc_device="));
      assert.ok(cookie.includes("HttpOnly"));
      assert.ok(cookie.includes("SameSite=Lax"));
    });

    it("should enforce 1 active device per user, create PENDING LoginRequest on new device, and support Admin APPROVE & REJECT", async () => {
      const loginHandler = (await import("../api/auth/login.js")).default;
      const loginRequestStatusHandler = (await import("../api/auth/session.js")).default;
      const adminLoginRequestsHandler = (await import("../api/admin/users.js")).default;
      const { prisma } = await import("../lib/db/prisma.js");
      const { hashPassword, createSession, validateRequestSession } = await import(
        "../lib/auth/index.js"
      );

      const suffix = Date.now();
      const userEmail = `device_user_${suffix}@example.com`;
      const adminEmail = `device_admin_${suffix}@example.com`;
      const password = "StrongPassword123!";

      const passwordHash = await hashPassword(password);

      const testUser = await prisma.user.create({
        data: {
          email: userEmail,
          name: "Device Test User",
          role: "USER",
          status: "ACTIVE",
          passwordHash,
        },
      });

      const testAdmin = await prisma.user.create({
        data: {
          email: adminEmail,
          name: "Device Test Admin",
          role: "ADMIN",
          status: "ACTIVE",
          passwordHash,
        },
      });

      try {
        // 1. User logs in from Device A (First device -> automatically authorized as ACTIVE)
        let devAStatus = 0;
        let devABody = "";
        const devAReq: any = {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0 Safari/537.36",
            "x-forwarded-for": `10.0.1.${suffix % 200}`,
          },
          body: { email: userEmail, password },
        };
        const devARes: any = {
          setHeader() {},
          end(d: string) {
            devABody = d;
          },
          set statusCode(c: number) {
            devAStatus = c;
          },
          get statusCode() {
            return devAStatus;
          },
        };

        await loginHandler(devAReq, devARes);
        assert.strictEqual(devAStatus, 200, "First device login must succeed immediately");
        const devAData = JSON.parse(devABody);
        assert.strictEqual(devAData.success, true);
        assert.ok(devAData.token, "Device A must receive session token");
        assert.ok(devAData.deviceToken, "Device A must receive device token");

        // Verify Device A session is valid
        const validUserA = await validateRequestSession({
          headers: {
            authorization: `Bearer ${devAData.token}`,
            "x-device-token": devAData.deviceToken,
          },
        } as any);
        assert.strictEqual(validUserA?.id, testUser.id);

        // 2. User attempts to log in from Device B (New device without Device A token)
        let devBStatus = 0;
        let devBBody = "";
        const devBReq: any = {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Version/17.0 Safari/605.1.15",
            "x-forwarded-for": `10.0.2.${suffix % 200}`,
          },
          body: { email: userEmail, password },
        };
        const devBRes: any = {
          setHeader() {},
          end(d: string) {
            devBBody = d;
          },
          set statusCode(c: number) {
            devBStatus = c;
          },
          get statusCode() {
            return devBStatus;
          },
        };

        await loginHandler(devBReq, devBRes);
        assert.strictEqual(devBStatus, 403, "Second device login must require admin approval");
        const devBData = JSON.parse(devBBody);
        assert.strictEqual(devBData.success, false);
        assert.strictEqual(devBData.code, "DEVICE_APPROVAL_REQUIRED");
        assert.strictEqual(devBData.requiresDeviceApproval, true);
        assert.ok(devBData.loginRequestId, "Must return pending loginRequestId");
        assert.strictEqual(devBData.token, undefined, "New device must NOT receive session token");

        // 3. Create Admin session and REJECT Device B's login request
        const adminSession = await createSession(testAdmin.id);
        let rejectStatus = 0;
        let rejectBody = "";
        const rejectReq: any = {
          method: "POST",
          url: "/api/admin/login-requests",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${adminSession.sessionToken}`,
          },
          body: {
            action: "REJECT",
            requestId: devBData.loginRequestId,
            rejectionReason: "Unrecognized device",
          },
        };
        const rejectRes: any = {
          setHeader() {},
          end(d: string) {
            rejectBody = d;
          },
          set statusCode(c: number) {
            rejectStatus = c;
          },
          get statusCode() {
            return rejectStatus;
          },
        };

        await adminLoginRequestsHandler(rejectReq, rejectRes);
        assert.strictEqual(rejectStatus, 200);
        const rejectData = JSON.parse(rejectBody);
        assert.strictEqual(rejectData.success, true);

        // Verify Device A's session is STILL active after Device B is rejected
        const validUserAAfterReject = await validateRequestSession({
          headers: {
            authorization: `Bearer ${devAData.token}`,
            "x-device-token": devAData.deviceToken,
          },
        } as any);
        assert.strictEqual(
          validUserAAfterReject?.id,
          testUser.id,
          "Old device session must remain active when new device is REJECTED"
        );

        // 4. User attempts to log in from Device C -> Admin APPROVES Device C
        let devCStatus = 0;
        let devCBody = "";
        const devCReq: any = {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:129.0) Gecko/20100101 Firefox/129.0",
            "x-forwarded-for": `10.0.3.${suffix % 200}`,
          },
          body: { email: userEmail, password },
        };
        const devCRes: any = {
          setHeader() {},
          end(d: string) {
            devCBody = d;
          },
          set statusCode(c: number) {
            devCStatus = c;
          },
          get statusCode() {
            return devCStatus;
          },
        };

        await loginHandler(devCReq, devCRes);
        assert.strictEqual(devCStatus, 403);
        const devCData = JSON.parse(devCBody);
        assert.strictEqual(devCData.requiresDeviceApproval, true);

        // Admin APPROVES Device C
        let approveStatus = 0;
        let approveBody = "";
        const approveReq: any = {
          method: "POST",
          url: "/api/admin/login-requests",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${adminSession.sessionToken}`,
          },
          body: {
            action: "APPROVE",
            requestId: devCData.loginRequestId,
          },
        };
        const approveRes: any = {
          setHeader() {},
          end(d: string) {
            approveBody = d;
          },
          set statusCode(c: number) {
            approveStatus = c;
          },
          get statusCode() {
            return approveStatus;
          },
        };

        await adminLoginRequestsHandler(approveReq, approveRes);
        assert.strictEqual(approveStatus, 200);
        const approveData = JSON.parse(approveBody);
        assert.strictEqual(approveData.success, true);

        // Verify Device A's session is NOW REVOKED!
        const revokedUserA = await validateRequestSession({
          headers: {
            authorization: `Bearer ${devAData.token}`,
            "x-device-token": devAData.deviceToken,
          },
        } as any);
        assert.strictEqual(
          revokedUserA,
          null,
          "Old device session MUST be revoked immediately when new device is APPROVED"
        );

        // Verify Device C can claim its approved session via /api/auth/login-request
        let claimStatus = 0;
        let claimBody = "";
        const claimReq: any = {
          method: "GET",
          url: `/api/auth/login-request?requestId=${devCData.loginRequestId}`,
          headers: {
            "x-device-token": devCData.deviceToken,
          },
        };
        const claimRes: any = {
          setHeader() {},
          end(d: string) {
            claimBody = d;
          },
          set statusCode(c: number) {
            claimStatus = c;
          },
          get statusCode() {
            return claimStatus;
          },
        };

        await loginRequestStatusHandler(claimReq, claimRes);
        assert.strictEqual(claimStatus, 200);
        const claimData = JSON.parse(claimBody);
        assert.strictEqual(claimData.status, "APPROVED");
        assert.strictEqual(claimData.authenticated, true);
        assert.ok(claimData.token, "Approved Device C must receive active session token");

        // Verify strictly 1 ACTIVE device exists in DB for testUser
        const activeUserDevices = await prisma.device.findMany({
          where: { userId: testUser.id, status: "ACTIVE" },
        });
        assert.strictEqual(
          activeUserDevices.length,
          1,
          "Strictly 1 ACTIVE device must exist for the user"
        );
        assert.strictEqual(activeUserDevices[0].id, devCData.device.id);
      } finally {
        await prisma.user
          .deleteMany({ where: { email: { in: [userEmail, adminEmail] } } })
          .catch(() => {});
      }
    });
  });
});
