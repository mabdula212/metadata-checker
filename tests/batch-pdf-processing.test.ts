import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "events";
import { PDFDocument } from "pdf-lib";
import { encryptPDF } from "@pdfsmaller/pdf-encrypt";
import { Role, UserStatus, BatchStatus } from "@prisma/client";
import { prisma } from "../lib/db/prisma.js";
import { createSession } from "../lib/auth/session.js";
import batchesHandler from "../server/batches.js";
import documentsHandler from "../server/documents.js";
import dashboardHandler from "../server/dashboard.js";

// Helper to create mock HTTP requests and responses
function createMockHttp(options: {
  method: string;
  url: string;
  token?: string;
  cookie?: string;
  headers?: Record<string, string>;
  body?: any;
}) {
  const req = new EventEmitter() as any;
  req.method = options.method;
  req.url = options.url;
  req.headers = { ...(options.headers || {}) };

  if (options.token) {
    req.headers["authorization"] = `Bearer ${options.token}`;
  } else if (options.cookie) {
    req.headers["cookie"] = options.cookie;
  }

  let bodyData = "";
  if (options.body !== undefined) {
    if (typeof options.body === "string" || Buffer.isBuffer(options.body)) {
      bodyData = options.body.toString();
    } else {
      bodyData = JSON.stringify(options.body);
      if (!req.headers["content-type"]) {
        req.headers["content-type"] = "application/json";
      }
    }
  }

  req.body = bodyData;
  req.readableEnded = false;

  req.pipe = function (dest: any) {
    if (bodyData) {
      dest.write(bodyData);
    }
    dest.end();
    return dest;
  };

  process.nextTick(() => {
    if (bodyData) {
      req.emit("data", Buffer.from(bodyData));
    }
    req.emit("end");
  });

  let statusCode = 200;
  const resHeaders: Record<string, string> = {};
  let resBody = "";

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
      if (chunk) resBody += chunk;
    },
    get body() {
      return resBody;
    },
    get json() {
      try {
        return JSON.parse(resBody);
      } catch {
        return null;
      }
    },
  };

  return { req, res };
}

describe("Batch PDF Processing Test Suite", () => {
  let userA: any;
  let userB: any;
  let sessionTokenA: string;
  let sessionTokenB: string;

  const TEST_PASSWORD = "PasswordBCA2026!";
  let bcaPdfBase64: string;
  let bniPdfBase64: string;
  let encryptedBcaPdfBase64: string;

  before(async () => {
    // 1. Create User A and User B
    userA = await prisma.user.create({
      data: {
        email: `batch_user_a_${Date.now()}@example.com`,
        name: "User Alpha Batch",
        role: Role.USER,
        status: UserStatus.ACTIVE,
      },
    });

    userB = await prisma.user.create({
      data: {
        email: `batch_user_b_${Date.now()}@example.com`,
        name: "User Beta Batch",
        role: Role.USER,
        status: UserStatus.ACTIVE,
      },
    });

    const sessionA = await createSession(userA.id);
    const sessionB = await createSession(userB.id);
    sessionTokenA = sessionA.sessionToken;
    sessionTokenB = sessionB.sessionToken;

    // 2. Generate BCA PDF fixture
    const docBca = await PDFDocument.create();
    docBca.setTitle("BCA Rekening Koran Batch Test");
    docBca.setAuthor("PT BANK CENTRAL ASIA TBK");
    const pageBca = docBca.addPage([600, 800]);
    pageBca.drawText("PT BANK CENTRAL ASIA TBK", { x: 50, y: 750, size: 12 });
    pageBca.drawText("REKENING KORAN", { x: 50, y: 730, size: 10 });
    pageBca.drawText("NO. REKENING : 1234567890", { x: 50, y: 710, size: 10 });
    pageBca.drawText("PERIODE : 01/01/26 - 31/01/26", { x: 50, y: 690, size: 10 });
    pageBca.drawText("SALDO AWAL : 5,000,000.00", { x: 50, y: 670, size: 10 });
    pageBca.drawText("05/01 SETORAN CR 2,000,000.00 7,000,000.00", { x: 50, y: 650, size: 10 });
    pageBca.drawText("SALDO AKHIR : 7,000,000.00", { x: 50, y: 630, size: 10 });
    const bcaBytes = await docBca.save();
    bcaPdfBase64 = Buffer.from(bcaBytes).toString("base64");

    // 3. Generate BNI PDF fixture
    const docBni = await PDFDocument.create();
    docBni.setTitle("BNI Rekening Koran E-Statement");
    docBni.setAuthor("PT BANK NEGARA INDONESIA (PERSERO) TBK");
    const pageBni = docBni.addPage([595, 842]);
    pageBni.drawText("PT BANK NEGARA INDONESIA (PERSERO) TBK", { x: 40, y: 800, size: 10 });
    pageBni.drawText("REKENING KORAN", { x: 40, y: 780, size: 10 });
    pageBni.drawText("NO. REKENING : 9876543210", { x: 40, y: 760, size: 10 });
    pageBni.drawText("PERIODE : 01/02/2026 - 28/02/2026", { x: 40, y: 740, size: 10 });
    pageBni.drawText("SALDO AWAL : 10,000,000.00", { x: 40, y: 720, size: 10 });
    pageBni.drawText("TANGGAL URAIAN TRANSAKSI CABANG DEBET KREDIT SALDO", { x: 40, y: 700, size: 9 });
    pageBni.drawText("10/02 TRANSFER MASUK 001 0.00 1,500,000.00 11,500,000.00", { x: 40, y: 680, size: 9 });
    pageBni.drawText("SALDO AKHIR : 11,500,000.00", { x: 40, y: 660, size: 10 });
    const bniBytes = await docBni.save();
    bniPdfBase64 = Buffer.from(bniBytes).toString("base64");

    // 4. Encrypted BCA PDF
    const encBcaBytes = await encryptPDF(bcaBytes, TEST_PASSWORD);
    encryptedBcaPdfBase64 = Buffer.from(encBcaBytes).toString("base64");
  });

  after(async () => {
    // Cleanup created test records
    await prisma.processingBatch.deleteMany({
      where: { userId: { in: [userA.id, userB.id] } },
    });
    await prisma.document.deleteMany({
      where: { userId: { in: [userA.id, userB.id] } },
    });
    await prisma.session.deleteMany({
      where: { userId: { in: [userA.id, userB.id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [userA.id, userB.id] } },
    });
  });

  // Suite 1: Authentication rejection
  it("Suite 1: should reject unauthenticated requests to batch endpoints with 401", async () => {
    const { req: req1, res: res1 } = createMockHttp({
      method: "POST",
      url: "/api/batches",
      body: { files: [] },
    });
    await batchesHandler(req1, res1);
    assert.equal(res1.statusCode, 401);

    const { req: req2, res: res2 } = createMockHttp({
      method: "GET",
      url: "/api/batches/any-id",
    });
    await batchesHandler(req2, res2);
    assert.equal(res2.statusCode, 401);

    const { req: req3, res: res3 } = createMockHttp({
      method: "GET",
      url: "/api/batches/any-id/status",
    });
    await batchesHandler(req3, res3);
    assert.equal(res3.statusCode, 401);

    const { req: req4, res: res4 } = createMockHttp({
      method: "POST",
      url: "/api/batches/any-id/cancel",
    });
    await batchesHandler(req4, res4);
    assert.equal(res4.statusCode, 401);
  });

  // Suite 2: Single file batch upload & processing
  it("Suite 2: should successfully process a 1-file batch upload", async () => {
    const { req, res } = createMockHttp({
      method: "POST",
      url: "/api/batches",
      token: sessionTokenA,
      body: {
        files: [
          {
            fileName: "single_bca_statement.pdf",
            fileBase64: bcaPdfBase64,
          },
        ],
      },
    });

    await batchesHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json?.success, true);
    assert.ok(res.json?.batchId);
    assert.equal(res.json?.status, "COMPLETED");
    assert.equal(res.json?.summary?.total, 1);
    assert.equal(res.json?.summary?.completed, 1);
    assert.equal(res.json?.summary?.failed, 0);

    const doc = res.json?.documents?.[0];
    assert.ok(doc);
    assert.equal(doc.fileName, "single_bca_statement.pdf");
    assert.equal(doc.status, "COMPLETED");
    assert.equal(doc.bank, "BCA");
    assert.ok(doc.transactionCount >= 1);
  });

  // Suite 3: Multiple files mixed banks
  it("Suite 3: should process multiple files from mixed banks (BCA + BNI) concurrently", async () => {
    const { req, res } = createMockHttp({
      method: "POST",
      url: "/api/batches",
      token: sessionTokenA,
      body: {
        files: [
          {
            fileName: "batch_bca_multi.pdf",
            fileBase64: bcaPdfBase64,
          },
          {
            fileName: "batch_bni_multi.pdf",
            fileBase64: bniPdfBase64,
          },
        ],
      },
    });

    await batchesHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json?.success, true);
    assert.equal(res.json?.status, "COMPLETED");
    assert.equal(res.json?.summary?.total, 2);
    assert.equal(res.json?.summary?.completed, 2);

    const bcaDoc = res.json?.documents?.find((d: any) => d.fileName === "batch_bca_multi.pdf");
    const bniDoc = res.json?.documents?.find((d: any) => d.fileName === "batch_bni_multi.pdf");
    assert.ok(bcaDoc);
    assert.ok(bniDoc);
    assert.equal(bcaDoc.bank, "BCA");
    assert.equal(bniDoc.bank, "BNI");
  });

  // Suite 4: Duplicate document handling within batch
  it("Suite 4: should detect and handle duplicate documents gracefully", async () => {
    // Process BCA statement again with same user
    const { req, res } = createMockHttp({
      method: "POST",
      url: "/api/batches",
      token: sessionTokenA,
      body: {
        files: [
          {
            fileName: "duplicate_bca.pdf",
            fileBase64: bcaPdfBase64,
          },
        ],
      },
    });

    await batchesHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json?.success, true);
    const doc = res.json?.documents?.[0];
    assert.ok(doc);
    assert.equal(doc.isDuplicate, true);
    assert.equal(doc.status, "COMPLETED");
    assert.equal(doc.bank, "BCA");
  });

  // Suite 5: Invalid PDFs handling
  it("Suite 5: should handle invalid or corrupt PDF buffers safely", async () => {
    const corruptedBase64 = Buffer.from("NOT_A_VALID_PDF_STREAM_12345").toString("base64");
    const { req, res } = createMockHttp({
      method: "POST",
      url: "/api/batches",
      token: sessionTokenA,
      body: {
        files: [
          {
            fileName: "corrupt.pdf",
            fileBase64: corruptedBase64,
          },
        ],
      },
    });

    await batchesHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json?.status, "FAILED");
    assert.equal(res.json?.summary?.failed, 1);

    const doc = res.json?.documents?.[0];
    assert.equal(doc.status, "FAILED");
    assert.ok(doc.error);
  });

  // Suite 6: Password-protected PDFs
  it("Suite 6: should handle password-protected PDFs (missing vs correct password)", async () => {
    // 6a: Upload protected PDF without password
    const { req: reqNoPass, res: resNoPass } = createMockHttp({
      method: "POST",
      url: "/api/batches",
      token: sessionTokenA,
      body: {
        files: [
          {
            fileName: "encrypted_no_pass.pdf",
            fileBase64: encryptedBcaPdfBase64,
          },
        ],
      },
    });

    await batchesHandler(reqNoPass, resNoPass);
    assert.equal(resNoPass.statusCode, 200);
    const docNoPass = resNoPass.json?.documents?.[0];
    assert.equal(docNoPass.status, "PASSWORD_REQUIRED");

    // 6b: Upload protected PDF with correct password
    const { req: reqWithPass, res: resWithPass } = createMockHttp({
      method: "POST",
      url: "/api/batches",
      token: sessionTokenA,
      body: {
        password: TEST_PASSWORD,
        files: [
          {
            fileName: "encrypted_with_pass.pdf",
            fileBase64: encryptedBcaPdfBase64,
          },
        ],
      },
    });

    await batchesHandler(reqWithPass, resWithPass);
    assert.equal(resWithPass.statusCode, 200);
    const docWithPass = resWithPass.json?.documents?.[0];
    assert.equal(docWithPass.status, "COMPLETED");
    assert.equal(docWithPass.bank, "BCA");
  });

  // Suite 7: Partial status when some succeed and some fail
  it("Suite 7: should assign PARTIAL batch status when mixed valid and invalid files are uploaded", async () => {
    const corruptBase64 = Buffer.from("INVALID_CONTENT").toString("base64");
    const { req, res } = createMockHttp({
      method: "POST",
      url: "/api/batches",
      token: sessionTokenA,
      body: {
        files: [
          {
            fileName: "valid_bni.pdf",
            fileBase64: bniPdfBase64,
          },
          {
            fileName: "broken_file.pdf",
            fileBase64: corruptBase64,
          },
        ],
      },
    });

    await batchesHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json?.status, "PARTIAL");
    assert.equal(res.json?.summary?.total, 2);
    assert.equal(res.json?.summary?.completed, 1);
    assert.equal(res.json?.summary?.failed, 1);
  });

  // Suite 8: Batch cancellation
  it("Suite 8: should successfully cancel an active batch via POST /api/batches/:id/cancel", async () => {
    // Create batch in DB
    const batch = await prisma.processingBatch.create({
      data: {
        userId: userA.id,
        status: BatchStatus.PROCESSING,
        totalDocuments: 3,
        completedDocuments: 1,
        failedDocuments: 0,
      },
    });

    const { req, res } = createMockHttp({
      method: "POST",
      url: `/api/batches/${batch.id}/cancel`,
      token: sessionTokenA,
    });

    await batchesHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json?.success, true);
    assert.equal(res.json?.status, "CANCELLED");

    const updated = await prisma.processingBatch.findUnique({
      where: { id: batch.id },
    });
    assert.equal(updated?.status, BatchStatus.CANCELLED);
  });

  // Suite 9: IDOR defense
  it("Suite 9: should enforce IDOR protection preventing cross-user batch inspection", async () => {
    // User A creates a batch
    const batchA = await prisma.processingBatch.create({
      data: {
        userId: userA.id,
        status: BatchStatus.COMPLETED,
        totalDocuments: 1,
        completedDocuments: 1,
      },
    });

    // User B attempts to access User A's batch details
    const { req: reqDetail, res: resDetail } = createMockHttp({
      method: "GET",
      url: `/api/batches/${batchA.id}`,
      token: sessionTokenB,
    });
    await batchesHandler(reqDetail, resDetail);
    assert.equal(resDetail.statusCode, 403);

    // User B attempts to access User A's batch status
    const { req: reqStatus, res: resStatus } = createMockHttp({
      method: "GET",
      url: `/api/batches/${batchA.id}/status`,
      token: sessionTokenB,
    });
    await batchesHandler(reqStatus, resStatus);
    assert.equal(resStatus.statusCode, 403);

    // User B attempts to cancel User A's batch
    const { req: reqCancel, res: resCancel } = createMockHttp({
      method: "POST",
      url: `/api/batches/${batchA.id}/cancel`,
      token: sessionTokenB,
    });
    await batchesHandler(reqCancel, resCancel);
    assert.equal(resCancel.statusCode, 403);
  });

  // Suite 10: Status polling endpoint
  it("Suite 10: should provide lightweight polling data via GET /api/batches/:id/status", async () => {
    const batch = await prisma.processingBatch.create({
      data: {
        userId: userA.id,
        status: BatchStatus.PROCESSING,
        totalDocuments: 5,
        completedDocuments: 3,
        failedDocuments: 1,
      },
    });

    const { req, res } = createMockHttp({
      method: "GET",
      url: `/api/batches/${batch.id}/status`,
      token: sessionTokenA,
    });

    await batchesHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json?.success, true);
    assert.equal(res.json?.batchId, batch.id);
    assert.equal(res.json?.status, "PROCESSING");
    assert.equal(res.json?.totalDocuments, 5);
    assert.equal(res.json?.completedDocuments, 3);
    assert.equal(res.json?.failedDocuments, 1);
  });

  // Suite 11: Regression test
  it("Suite 11: should ensure existing /api/documents and /api/dashboard remain functional", async () => {
    // 1. Dashboard endpoint
    const { req: reqDash, res: resDash } = createMockHttp({
      method: "GET",
      url: "/api/dashboard",
      token: sessionTokenA,
    });
    await dashboardHandler(reqDash, resDash);
    assert.equal(resDash.statusCode, 200);
    assert.equal(resDash.json?.success, true);
    assert.ok(resDash.json?.data?.stats);

    // 2. Documents list endpoint
    const { req: reqDocs, res: resDocs } = createMockHttp({
      method: "GET",
      url: "/api/documents",
      token: sessionTokenA,
    });
    await documentsHandler(reqDocs, resDocs);
    assert.equal(resDocs.statusCode, 200);
    assert.equal(resDocs.json?.success, true);
    assert.ok(Array.isArray(resDocs.json?.data));
  });
});
