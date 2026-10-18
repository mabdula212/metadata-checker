import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../lib/db/prisma.js";
import { createSession } from "../lib/auth/session.js";
import { AUTH_COOKIE_NAME } from "../lib/auth/config.js";
import { Role, UserStatus, DocumentStatus, DocumentType } from "@prisma/client";
import dashboardHandler from "../api/dashboard.js";
import documentsHandler from "../api/documents.js";

// Helper to create mock HTTP requests and responses
function createMockHttp(options: {
  method: string;
  url: string;
  token?: string;
  cookie?: string;
  headers?: Record<string, string>;
}) {
  const headers: Record<string, string> = { ...(options.headers || {}) };
  if (options.token) {
    headers["authorization"] = `Bearer ${options.token}`;
  } else if (options.cookie) {
    headers["cookie"] = options.cookie;
  }

  const req: any = {
    method: options.method,
    url: options.url,
    headers,
  };

  let statusCode = 200;
  const resHeaders: Record<string, string> = {};
  let body = "";

  const res: any = {
    setHeader(key: string, value: string) {
      resHeaders[key.toLowerCase()] = value;
    },
    getHeader(key: string) {
      return resHeaders[key.toLowerCase()];
    },
    set statusCode(code: number) {
      statusCode = code;
    },
    get statusCode() {
      return statusCode;
    },
    end(chunk?: string) {
      if (chunk) body += chunk;
    },
    get body() {
      return body;
    },
    get json() {
      try {
        return JSON.parse(body);
      } catch {
        return null;
      }
    },
  };

  return { req, res };
}

describe("Metadata Checker 1.2 — Dashboard and Document History Test Suite", () => {
  let userA: any;
  let userB: any;
  let sessionTokenA: string;
  let sessionTokenB: string;

  let docA1Id: string;
  let docA2Id: string;
  let docB1Id: string;

  before(async () => {
    // 1. Create User A and User B
    userA = await prisma.user.create({
      data: {
        email: `dashboard_user_a_${Date.now()}@example.com`,
        name: "User Alpha",
        role: Role.USER,
        status: UserStatus.ACTIVE,
      },
    });

    userB = await prisma.user.create({
      data: {
        email: `dashboard_user_b_${Date.now()}@example.com`,
        name: "User Beta",
        role: Role.USER,
        status: UserStatus.ACTIVE,
      },
    });

    // 2. Create Active Sessions
    const sessionA = await createSession(userA.id);
    const sessionB = await createSession(userB.id);
    sessionTokenA = sessionA.sessionToken;
    sessionTokenB = sessionB.sessionToken;

    // 3. Seed Document A1 (BCA, COMPLETED)
    const docA1 = await prisma.document.create({
      data: {
        userId: userA.id,
        originalFileName: "rekening_koran_bca_jan2026.pdf",
        storedFileName: "bca_stored_1.pdf",
        mimeType: "application/pdf",
        fileSize: 1048576, // 1 MB
        storageKey: `test/docs/${userA.id}/bca_1.pdf`,
        status: DocumentStatus.COMPLETED,
        documentType: DocumentType.BANK_STATEMENT,
        processingDuration: 1250,
        statement: {
          create: {
            bankName: "BCA",
            accountNumberMasked: "123****789",
            accountHolderName: "User Alpha",
            statementPeriodStart: new Date("2026-01-01"),
            statementPeriodEnd: new Date("2026-01-31"),
            transactionCount: 25,
            totalCredit: 5000000,
            totalDebit: 3000000,
            transactions: {
              create: [
                {
                  transactionDate: new Date("2026-01-05"),
                  description: "TRANSFER DARI PT ABC",
                  credit: 5000000,
                  balance: 5000000,
                  transactionType: "TRANSFER_IN",
                },
                {
                  transactionDate: new Date("2026-01-10"),
                  description: "PEMBAYARAN LISTRIK",
                  debit: 500000,
                  balance: 4500000,
                  transactionType: "BILL_PAYMENT",
                },
              ],
            },
          },
        },
        metadata: {
          create: {
            title: "Rekening Koran BCA Januari 2026",
            pageCount: 2,
            fileHash: "sha256-mock-hash-a1",
            rawMetadataJson: {
              extractionStatus: "COMPLETED",
              balanceReconciliationStatus: "BALANCED",
            },
          },
        },
      },
    });
    docA1Id = docA1.id;

    // 4. Seed Document A2 (Mandiri, FAILED/NEEDS_REVIEW)
    const docA2 = await prisma.document.create({
      data: {
        userId: userA.id,
        originalFileName: "statement_mandiri_feb2026.pdf",
        storedFileName: "mandiri_stored_2.pdf",
        mimeType: "application/pdf",
        fileSize: 2097152, // 2 MB
        storageKey: `test/docs/${userA.id}/mandiri_2.pdf`,
        status: DocumentStatus.FAILED,
        documentType: DocumentType.BANK_STATEMENT,
        processingDuration: 850,
        statement: {
          create: {
            bankName: "Bank Mandiri",
            accountNumberMasked: "987****321",
            accountHolderName: "User Alpha",
            statementPeriodStart: new Date("2026-02-01"),
            statementPeriodEnd: new Date("2026-02-28"),
            transactionCount: 10,
          },
        },
        metadata: {
          create: {
            title: "Statement Mandiri Februari",
            fileHash: "sha256-mock-hash-a2",
            rawMetadataJson: {
              extractionStatus: "NEEDS_REVIEW",
              balanceReconciliationStatus: "DISCREPANCY",
            },
          },
        },
      },
    });
    docA2Id = docA2.id;

    // 5. Seed Document B1 for User B (BNI, COMPLETED)
    const docB1 = await prisma.document.create({
      data: {
        userId: userB.id,
        originalFileName: "bni_personal_statement.pdf",
        storedFileName: "bni_stored_1.pdf",
        mimeType: "application/pdf",
        fileSize: 524288, // 512 KB
        storageKey: `test/docs/${userB.id}/bni_1.pdf`,
        status: DocumentStatus.COMPLETED,
        documentType: DocumentType.BANK_STATEMENT,
        statement: {
          create: {
            bankName: "BNI",
            transactionCount: 15,
          },
        },
      },
    });
    docB1Id = docB1.id;
  });

  after(async () => {
    // Clean up created test data
    if (userA?.id) {
      await prisma.user.delete({ where: { id: userA.id } }).catch(() => null);
    }
    if (userB?.id) {
      await prisma.user.delete({ where: { id: userB.id } }).catch(() => null);
    }
  });

  // -------------------------------------------------------------
  // 1. Unauthenticated Access Protection
  // -------------------------------------------------------------
  describe("1. Unauthenticated Access Rejection", () => {
    it("should reject GET /api/dashboard with 401 when unauthenticated", async () => {
      const { req, res } = createMockHttp({
        method: "GET",
        url: "/api/dashboard",
      });
      await dashboardHandler(req, res);
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.json?.success, false);
    });

    it("should reject GET /api/documents with 401 when unauthenticated", async () => {
      const { req, res } = createMockHttp({
        method: "GET",
        url: "/api/documents",
      });
      await documentsHandler(req, res);
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.json?.success, false);
    });

    it("should reject GET /api/documents/:id with 401 when unauthenticated", async () => {
      const { req, res } = createMockHttp({
        method: "GET",
        url: `/api/documents/${docA1Id}`,
      });
      await documentsHandler(req, res);
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.json?.success, false);
    });

    it("should reject DELETE /api/documents/:id with 401 when unauthenticated", async () => {
      const { req, res } = createMockHttp({
        method: "DELETE",
        url: `/api/documents/${docA1Id}`,
      });
      await documentsHandler(req, res);
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.json?.success, false);
    });
  });

  // -------------------------------------------------------------
  // 2. Dashboard Statistics & User Data Isolation
  // -------------------------------------------------------------
  describe("2. Dashboard Statistics & Aggregations", () => {
    it("should return correct isolated statistics for User A", async () => {
      const { req, res } = createMockHttp({
        method: "GET",
        url: "/api/dashboard",
        token: sessionTokenA,
      });
      await dashboardHandler(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json?.success, true);

      const stats = res.json.data.stats;
      // User A has 2 documents
      assert.strictEqual(stats.documentsAnalyzed, 2);
      // User A total transactions = 25 (BCA) + 10 (Mandiri) = 35
      assert.strictEqual(stats.transactionsExtracted, 35);
      // Needs review count >= 1 (docA2 is FAILED and DISCREPANCY)
      assert.ok(stats.needsReview >= 1);
      // Storage used = 1MB + 2MB = 3MB
      assert.strictEqual(stats.storageUsed.bytes, 3145728);
      assert.ok(stats.storageUsed.formatted.includes("MB"));

      // Recent documents list contains User A's docs
      const recent = res.json.data.recentDocuments;
      assert.ok(recent.length >= 2);
      assert.strictEqual(recent[0].id, docA2Id); // Ordered desc
      assert.strictEqual(recent[1].id, docA1Id);
      assert.strictEqual(recent[1].bank, "BCA");
      assert.strictEqual(recent[1].transactionCount, 25);

      // Bank distribution includes BCA and Mandiri
      const dist = res.json.data.bankDistribution;
      assert.ok(dist.some((d: any) => d.bank === "BCA"));
      assert.ok(dist.some((d: any) => d.bank === "Bank Mandiri"));
    });

    it("should isolate User B's dashboard from User A's data", async () => {
      const { req, res } = createMockHttp({
        method: "GET",
        url: "/api/dashboard",
        token: sessionTokenB,
      });
      await dashboardHandler(req, res);
      assert.strictEqual(res.statusCode, 200);

      const stats = res.json.data.stats;
      // User B only has 1 document
      assert.strictEqual(stats.documentsAnalyzed, 1);
      assert.strictEqual(stats.transactionsExtracted, 15);
      assert.strictEqual(stats.storageUsed.bytes, 524288); // 512 KB
    });

    it("should handle empty state gracefully for a brand new user", async () => {
      const newUser = await prisma.user.create({
        data: {
          email: `empty_user_${Date.now()}@example.com`,
          name: "Empty User",
          role: Role.USER,
        },
      });
      const newSession = await createSession(newUser.id);

      const { req, res } = createMockHttp({
        method: "GET",
        url: "/api/dashboard",
        token: newSession.sessionToken,
      });
      await dashboardHandler(req, res);
      assert.strictEqual(res.statusCode, 200);

      const stats = res.json.data.stats;
      assert.strictEqual(stats.documentsAnalyzed, 0);
      assert.strictEqual(stats.transactionsExtracted, 0);
      assert.strictEqual(stats.needsReview, 0);
      assert.strictEqual(stats.storageUsed.bytes, 0);
      assert.deepStrictEqual(res.json.data.recentDocuments, []);
      assert.deepStrictEqual(res.json.data.bankDistribution, []);

      // Cleanup
      await prisma.user.delete({ where: { id: newUser.id } });
    });
  });

  // -------------------------------------------------------------
  // 3. Document History (Filters, Search, Pagination)
  // -------------------------------------------------------------
  describe("3. Document History Querying, Filtering & Pagination", () => {
    it("should list User A's documents with pagination meta", async () => {
      const { req, res } = createMockHttp({
        method: "GET",
        url: "/api/documents?page=1&limit=10",
        token: sessionTokenA,
      });
      await documentsHandler(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json?.success, true);
      assert.strictEqual(res.json.data.length, 2);
      assert.strictEqual(res.json.pagination.total, 2);
      assert.strictEqual(res.json.pagination.page, 1);
      assert.strictEqual(res.json.pagination.totalPages, 1);
      assert.strictEqual(res.json.pagination.hasNextPage, false);
      assert.strictEqual(res.json.pagination.hasPrevPage, false);
    });

    it("should paginate correctly with small page limit", async () => {
      const { req, res } = createMockHttp({
        method: "GET",
        url: "/api/documents?page=1&limit=1",
        token: sessionTokenA,
      });
      await documentsHandler(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json.data.length, 1);
      assert.strictEqual(res.json.pagination.total, 2);
      assert.strictEqual(res.json.pagination.totalPages, 2);
      assert.strictEqual(res.json.pagination.hasNextPage, true);
      assert.strictEqual(res.json.pagination.hasPrevPage, false);

      // Fetch page 2
      const { req: req2, res: res2 } = createMockHttp({
        method: "GET",
        url: "/api/documents?page=2&limit=1",
        token: sessionTokenA,
      });
      await documentsHandler(req2, res2);
      assert.strictEqual(res2.statusCode, 200);
      assert.strictEqual(res2.json.data.length, 1);
      assert.strictEqual(res2.json.pagination.page, 2);
      assert.strictEqual(res2.json.pagination.hasNextPage, false);
      assert.strictEqual(res2.json.pagination.hasPrevPage, true);
    });

    it("should filter documents by bank name", async () => {
      // Filter for BCA
      const { req, res } = createMockHttp({
        method: "GET",
        url: "/api/documents?bank=BCA",
        token: sessionTokenA,
      });
      await documentsHandler(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json.data.length, 1);
      assert.strictEqual(res.json.data[0].bankName, "BCA");

      // Filter for non-existent bank for User A
      const { req: reqNone, res: resNone } = createMockHttp({
        method: "GET",
        url: "/api/documents?bank=CIMB%20Niaga",
        token: sessionTokenA,
      });
      await documentsHandler(reqNone, resNone);
      assert.strictEqual(resNone.statusCode, 200);
      assert.strictEqual(resNone.json.data.length, 0);
      assert.strictEqual(resNone.json.pagination.total, 0);
    });

    it("should filter documents by status", async () => {
      const { req, res } = createMockHttp({
        method: "GET",
        url: "/api/documents?status=COMPLETED",
        token: sessionTokenA,
      });
      await documentsHandler(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json.data.length, 1);
      assert.strictEqual(res.json.data[0].status, "COMPLETED");
    });

    it("should filter documents by search query", async () => {
      const { req, res } = createMockHttp({
        method: "GET",
        url: "/api/documents?search=koran",
        token: sessionTokenA,
      });
      await documentsHandler(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json.data.length, 1);
      assert.ok(res.json.data[0].originalFileName.includes("rekening_koran"));
    });

    it("should ignore query param userId and never accept caller's userId as authority", async () => {
      // User A tries to pass User B's ID in query
      const { req, res } = createMockHttp({
        method: "GET",
        url: `/api/documents?userId=${userB.id}`,
        token: sessionTokenA,
      });
      await documentsHandler(req, res);
      assert.strictEqual(res.statusCode, 200);
      // Still only User A's documents returned
      for (const item of res.json.data) {
        assert.notStrictEqual(item.id, docB1Id, "Must never return User B's documents");
      }
    });
  });

  // -------------------------------------------------------------
  // 4. Document Detail & IDOR Defense
  // -------------------------------------------------------------
  describe("4. Document Detail Inspection & IDOR Defense", () => {
    it("should allow User A to open their own document and retrieve full statement details", async () => {
      const { req, res } = createMockHttp({
        method: "GET",
        url: `/api/documents/${docA1Id}`,
        token: sessionTokenA,
      });
      await documentsHandler(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json.success, true);

      const doc = res.json.data;
      assert.strictEqual(doc.id, docA1Id);
      assert.strictEqual(doc.statement.bankName, "BCA");
      assert.strictEqual(doc.statement.transactions.length, 2);
      assert.strictEqual(doc.metadata.title, "Rekening Koran BCA Januari 2026");

      // Verify lastAccessedAt was updated
      const updatedDoc = await prisma.document.findUnique({ where: { id: docA1Id } });
      assert.ok(updatedDoc?.lastAccessedAt !== null);
    });

    it("should reject User B trying to access User A's document with 403 Forbidden (IDOR Defense)", async () => {
      const { req, res } = createMockHttp({
        method: "GET",
        url: `/api/documents/${docA1Id}`,
        token: sessionTokenB,
      });
      await documentsHandler(req, res);
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.json.success, false);
      assert.match(res.json.error, /Access denied|do not own/i);
    });

    it("should return 404 for non-existent document ID", async () => {
      const { req, res } = createMockHttp({
        method: "GET",
        url: "/api/documents/non-existent-uuid-1234",
        token: sessionTokenA,
      });
      await documentsHandler(req, res);
      assert.strictEqual(res.statusCode, 404);
      assert.strictEqual(res.json.success, false);
    });
  });

  // -------------------------------------------------------------
  // 5. Deletion Policy & Soft Delete Verification
  // -------------------------------------------------------------
  describe("5. Document Deletion Policy (Soft Delete & Access Revocation)", () => {
    let docToDeleteId: string;

    before(async () => {
      // Create a temporary document for User A to delete
      const tempDoc = await prisma.document.create({
        data: {
          userId: userA.id,
          originalFileName: "temporary_statement_to_delete.pdf",
          storedFileName: "temp_del.pdf",
          mimeType: "application/pdf",
          fileSize: 100000,
          storageKey: `test/docs/${userA.id}/temp.pdf`,
          status: DocumentStatus.COMPLETED,
        },
      });
      docToDeleteId = tempDoc.id;
    });

    it("should prevent User B from deleting User A's document (IDOR defense)", async () => {
      const { req, res } = createMockHttp({
        method: "DELETE",
        url: `/api/documents/${docToDeleteId}`,
        token: sessionTokenB,
      });
      await documentsHandler(req, res);
      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(res.json.success, false);
    });

    it("should allow User A to soft delete their own document", async () => {
      const { req, res } = createMockHttp({
        method: "DELETE",
        url: `/api/documents/${docToDeleteId}`,
        token: sessionTokenA,
      });
      await documentsHandler(req, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.json.success, true);
      assert.match(res.json.message, /berhasil dihapus/i);

      // Verify deletedAt is set in database
      const dbDoc = await prisma.document.findUnique({ where: { id: docToDeleteId } });
      assert.ok(dbDoc?.deletedAt !== null, "deletedAt timestamp must be set");
    });

    it("should treat deleted document as 404 on subsequent GET /api/documents/:id", async () => {
      const { req, res } = createMockHttp({
        method: "GET",
        url: `/api/documents/${docToDeleteId}`,
        token: sessionTokenA,
      });
      await documentsHandler(req, res);
      assert.strictEqual(res.statusCode, 404);
      assert.match(res.json.error, /deleted|not found/i);
    });

    it("should exclude soft-deleted document from GET /api/documents list", async () => {
      const { req, res } = createMockHttp({
        method: "GET",
        url: "/api/documents",
        token: sessionTokenA,
      });
      await documentsHandler(req, res);
      assert.strictEqual(res.statusCode, 200);
      const items = res.json.data;
      assert.strictEqual(
        items.some((d: any) => d.id === docToDeleteId),
        false,
        "Deleted document must not appear in history list"
      );
    });

    it("should reject deleting an already deleted document with 404", async () => {
      const { req, res } = createMockHttp({
        method: "DELETE",
        url: `/api/documents/${docToDeleteId}`,
        token: sessionTokenA,
      });
      await documentsHandler(req, res);
      assert.strictEqual(res.statusCode, 404);
      assert.strictEqual(res.json.success, false);
    });
  });
});
