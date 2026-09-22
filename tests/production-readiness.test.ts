import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Role } from "@prisma/client";
import { seedInitialUsers } from "../lib/auth/init";
import {
  getStorageProvider,
  setStorageProvider,
  VercelBlobStorageProvider,
  LocalStorageProvider,
  generateStorageKey,
} from "../lib/storage";
import { getAuthSecret } from "../lib/auth/config";
import { createSession } from "../lib/auth/session";
import { requireAuth, requireDocumentOwner, requireExportOwner } from "../lib/auth/guards";
import { sanitizeWorkbookText, generateSafeExportFileName } from "../lib/excel/formatter";
import { validatePdfBuffer, MAX_PDF_SIZE_BYTES } from "../lib/pdf/pdf-inspector";
import { checkDatabaseHealth } from "../lib/db/db-util";
import { prisma } from "../lib/db/prisma";

// Mock HTTP Response for guard assertions
function createMockResponse() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  let body = "";

  return {
    statusCode,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
    end(chunk?: string) {
      if (chunk) body += chunk;
    },
    get statusCodeVal() {
      return this.statusCode;
    },
    get body() {
      return body;
    },
    get headers() {
      return headers;
    },
  };
}

describe("Production Readiness & Vercel Compatibility Audit", () => {
  const originalEnv = { ...process.env };

  after(() => {
    process.env = originalEnv;
    setStorageProvider(null);
  });

  // 1. Production environment disables demo users
  it("1. production environment disables demo users", async () => {
    process.env.NODE_ENV = "production";
    try {
      const result = await seedInitialUsers();
      assert.strictEqual(result.seeded, false);
      assert.match(result.reason || "", /production mode/i);
    } finally {
      process.env.NODE_ENV = "test";
    }
  });

  // 2. Production storage uses Vercel Blob
  it("2. production storage uses Vercel Blob when configured", () => {
    process.env.STORAGE_PROVIDER = "vercel-blob";
    setStorageProvider(null);
    const provider = getStorageProvider();
    assert.strictEqual(provider.name, "vercel-blob");
    assert.ok(provider instanceof VercelBlobStorageProvider);
  });

  // 3. Local storage is not used when provider is vercel-blob
  it("3. local storage is not used when provider is vercel-blob", () => {
    process.env.STORAGE_PROVIDER = "vercel-blob";
    setStorageProvider(null);
    const provider = getStorageProvider();
    assert.notStrictEqual(provider.name, "local");
    assert.ok(!(provider instanceof LocalStorageProvider));
  });

  // 4. Secrets are not exposed to frontend and AUTH_SECRET is required in production
  it("4. secrets are not exposed to frontend and AUTH_SECRET is required in production", () => {
    // Verify no secret variables are prefixed with VITE_ or NEXT_PUBLIC_
    const envKeys = Object.keys(process.env);
    const leakedSecrets = envKeys.filter((k) =>
      (k.startsWith("VITE_") || k.startsWith("NEXT_PUBLIC_")) &&
      (k.includes("DATABASE") || k.includes("SECRET") || k.includes("TOKEN") || k.includes("KEY"))
    );
    assert.deepStrictEqual(leakedSecrets, [], "No secret keys may have client prefixes");

    // Verify AUTH_SECRET enforces production requirement
    process.env.NODE_ENV = "production";
    delete process.env.AUTH_SECRET;
    try {
      assert.throws(
        () => getAuthSecret(),
        /FATAL: AUTH_SECRET environment variable must be configured in production/
      );
    } finally {
      process.env.NODE_ENV = "test";
      process.env.AUTH_SECRET = "test-secret-key-12345";
    }
  });

  // 5. Cross-user storage access is rejected (IDOR protection)
  it("5. cross-user storage access is rejected", async () => {
    // Create an isolated user A and user B
    const userA = await prisma.user.upsert({
      where: { email: "owner_user_a@bank.com" },
      update: {},
      create: {
        email: "owner_user_a@bank.com",
        name: "User A",
        role: Role.USER,
      },
    });

    const docA = await prisma.document.create({
      data: {
        userId: userA.id,
        originalFileName: "user_a_statement.pdf",
        storedFileName: "user_a_statement.pdf",
        mimeType: "application/pdf",
        fileSize: 1024,
        storageKey: `documents/${userA.id}/sample.pdf`,
      },
    });

    const exportA = await prisma.export.create({
      data: {
        userId: userA.id,
        documentId: docA.id,
        format: "XLSX",
        fileName: "user_a_statement.xlsx",
        storageKey: `exports/${userA.id}/sample.xlsx`,
      },
    });

    // Create session for User B using createSession
    const userB = await prisma.user.upsert({
      where: { email: "intruder_user_b@bank.com" },
      update: {},
      create: {
        email: "intruder_user_b@bank.com",
        name: "User B",
        role: Role.USER,
      },
    });

    const sessionB = await createSession(userB.id);
    const tokenB = sessionB.sessionToken;

    const mockReq = {
      headers: {
        authorization: `Bearer ${tokenB}`,
      },
      method: "GET",
      url: `/api/excel-export?exportId=${exportA.id}`,
    } as any;

    const mockRes = createMockResponse() as any;

    // User B tries to access User A's export
    const checkResult = await requireExportOwner(mockReq, mockRes, exportA.id);
    assert.strictEqual(checkResult, null);
    assert.strictEqual(mockRes.statusCode, 403);
    assert.match(mockRes.body, /Access denied/i);

    // User B tries to access User A's document
    const mockResDoc = createMockResponse() as any;
    const docCheckResult = await requireDocumentOwner(mockReq, mockResDoc, docA.id);
    assert.strictEqual(docCheckResult, null);
    assert.strictEqual(mockResDoc.statusCode, 403);
    assert.match(mockResDoc.body, /Access denied/i);
  });

  // 6. Excel formula injection is prevented
  it("6. Excel formula injection is prevented (CWE-1236)", () => {
    const maliciousInputs = [
      "=SUM(A1:A10)",
      "+12345-cmd|' /C calc'!A0",
      "-2+3+cmd|' /C calc'!A0",
      "@SUM(1,2)",
      "\t=HYPERLINK(\"http://evil.com\")",
      "\r+cmd",
    ];

    for (const input of maliciousInputs) {
      const sanitized = sanitizeWorkbookText(input);
      assert.ok(
        sanitized.startsWith("'"),
        `Expected formula injection string "${input}" to be escaped with leading quote, got "${sanitized}"`
      );
    }

    // Normal safe strings should not be prefixed
    const normalString = "Bank Mandiri Payroll Transfer";
    assert.strictEqual(sanitizeWorkbookText(normalString), normalString);
  });

  // 7. Oversized upload is rejected
  it("7. oversized upload is rejected", () => {
    // Buffer exceeding MAX_PDF_SIZE_BYTES (20MB)
    const oversizedBuffer = Buffer.alloc(MAX_PDF_SIZE_BYTES + 1024, "%PDF-1.7 mock");
    const result = validatePdfBuffer(oversizedBuffer);
    assert.strictEqual(result.valid, false);
    assert.match(result.error || "", /exceeds the maximum allowed limit/i);

    // Empty buffer is also rejected
    const emptyResult = validatePdfBuffer(Buffer.alloc(0));
    assert.strictEqual(emptyResult.valid, false);
    assert.match(emptyResult.error || "", /empty/i);
  });

  // 8. Unsafe filename is sanitized against path traversal
  it("8. unsafe filename is sanitized against path traversal and special characters", () => {
    const unsafeName = "../../../etc/passwd%00<script>.pdf";
    const { storageKey, storedFileName } = generateStorageKey("doc-123", unsafeName);

    assert.ok(!storageKey.includes(".."), "Storage key must not contain directory traversal");
    assert.ok(!storedFileName.includes(".."), "Stored file name must not contain directory traversal");
    assert.ok(!storedFileName.includes("<"), "Stored file name must not contain HTML tags");
    assert.ok(!storedFileName.includes(">"), "Stored file name must not contain HTML tags");

    const safeExportName = generateSafeExportFileName("Bank BCA (Cabang Jakarta) ../..", new Date("2026-03-15"));
    assert.ok(!safeExportName.includes(".."), "Export filename must not contain directory traversal");
    assert.match(safeExportName, /^BCA_Statement_March_2026\.xlsx$/, "Export filename should follow safe canonical pattern");
  });

  // 9. Health endpoint does not leak secrets
  it("9. health endpoint does not leak secrets or database credentials", async () => {
    process.env.NODE_ENV = "production";
    try {
      const health = await checkDatabaseHealth();
      assert.ok(typeof health.connected === "boolean");
      assert.ok(typeof health.timestamp === "string");

      const stringified = JSON.stringify(health);
      assert.ok(!stringified.includes("postgres://"), "Health response must not contain raw postgres URL");
      assert.ok(!stringified.includes("postgresql://"), "Health response must not contain raw postgresql URL");
      assert.ok(!stringified.includes("password"), "Health response must not contain database password");
      assert.ok(!stringified.includes("@"), "Health response must not contain connection user/host info");
    } finally {
      process.env.NODE_ENV = "test";
    }
  });

  // 10. Authenticated APIs reject unauthenticated requests
  it("10. authenticated APIs reject unauthenticated requests with 401 Unauthorized", async () => {
    const unauthenticatedReq = {
      headers: {},
      method: "GET",
      url: "/api/pdf/inspect",
    } as any;

    const mockRes = createMockResponse() as any;

    const authResult = await requireAuth(unauthenticatedReq, mockRes);
    assert.strictEqual(authResult, null);
    assert.strictEqual(mockRes.statusCode, 401);
    assert.match(mockRes.body, /Authentication required/i);
  });
});
