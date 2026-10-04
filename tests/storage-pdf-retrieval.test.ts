import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { Role } from "@prisma/client";
import { BlobNotFoundError } from "@vercel/blob";
import {
  LocalStorageProvider,
  VercelBlobStorageProvider,
  generateStorageKey,
  isPdfBuffer,
  getDocumentPdf,
  getStorageProvider,
  setStorageProvider,
  resolveStorageProviderName,
  validateStorageConfiguration,
  assertStorageConfigured,
  setGlobalMockBlobClient,
  categorizeBlobError,
  getStorageDiagnostic,
} from "../lib/storage/index.js";
import { prisma } from "../lib/db/prisma.js";
import { defaultBankDetectionEngine } from "../lib/bank-detection/index.js";
import { defaultTransactionExtractionEngine } from "../lib/transaction-extraction/index.js";
import { extractPdfText } from "../lib/pdf/pdf-text-extractor.js";
import {
  findDuplicateDocument,
  processAndSaveDocument,
  runBankDetectionOnDocument,
  runTransactionExtractionOnDocument,
} from "../lib/db/documents.js";
import { inspectPdfMetadata } from "../lib/pdf/pdf-inspector.js";
import { requireDocumentOwner } from "../lib/auth/guards.js";
import { createSession } from "../lib/auth/session.js";

// Temporary test directory for isolated local storage testing
const TEST_STORAGE_DIR = path.join(process.cwd(), "tmp_test_storage");

// In-memory mock store for Vercel Blob REST requests
const blobMockStore = new Map<string, { buffer: Buffer; contentType: string }>();

/**
 * Creates a synthetic, valid PDF buffer using pdf-lib.
 */
async function createSyntheticPdf(textLines: string[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  let y = 750;
  for (const line of textLines) {
    page.drawText(line, {
      x: 50,
      y,
      size: 10,
      font,
      color: rgb(0, 0, 0),
    });
    y -= 15;
  }

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}

describe("Persistent PDF Storage & Retrieval Engine — Vercel Blob & Local Providers", () => {
  let localTestProvider: LocalStorageProvider;
  let restoreFetch: () => void;

  before(async () => {
    if (!fs.existsSync(TEST_STORAGE_DIR)) {
      fs.mkdirSync(TEST_STORAGE_DIR, { recursive: true });
    }
    localTestProvider = new LocalStorageProvider(TEST_STORAGE_DIR);

    // Register official @vercel/blob SDK mock client
    setGlobalMockBlobClient({
      put: async (pathname, body, options) => {
        let buf: Buffer;
        if (Buffer.isBuffer(body)) buf = body;
        else if (body instanceof Uint8Array) buf = Buffer.from(body);
        else if (typeof body === "string") buf = Buffer.from(body);
        else buf = Buffer.alloc(0);

        const contentType = options?.contentType || "application/pdf";
        blobMockStore.set(pathname, { buffer: buf, contentType });
        return {
          url: `https://teststore.private.blob.vercel-storage.com/${pathname}`,
          downloadUrl: `https://teststore.private.blob.vercel-storage.com/${pathname}?download=1`,
          pathname,
          contentType,
          contentDisposition: "inline",
        };
      },
      get: async (pathname) => {
        const item = blobMockStore.get(pathname);
        if (!item) return null;
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(item.buffer));
            controller.close();
          },
        });
        return {
          statusCode: 200,
          stream,
          headers: new Headers() as any,
          blob: {
            url: `https://teststore.private.blob.vercel-storage.com/${pathname}`,
            downloadUrl: `https://teststore.private.blob.vercel-storage.com/${pathname}?download=1`,
            pathname,
            contentType: item.contentType,
            contentDisposition: "inline",
            cacheControl: "no-cache",
            uploadedAt: new Date(),
            etag: "test-etag",
            size: item.buffer.length,
          },
        };
      },
      head: async (pathname) => {
        const item = blobMockStore.get(pathname);
        if (!item) {
          throw new BlobNotFoundError();
        }
        return {
          url: `https://teststore.private.blob.vercel-storage.com/${pathname}`,
          downloadUrl: `https://teststore.private.blob.vercel-storage.com/${pathname}?download=1`,
          pathname,
          contentType: item.contentType,
          contentDisposition: "inline",
          cacheControl: "no-cache",
          uploadedAt: new Date(),
          etag: "test-etag",
          size: item.buffer.length,
        };
      },
      del: async (pathname) => {
        if (Array.isArray(pathname)) {
          pathname.forEach((p) => blobMockStore.delete(p));
        } else {
          blobMockStore.delete(pathname);
        }
      },
    });

    // Mock fetch for Vercel Blob REST endpoints
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlStr =
        typeof input === "string"
          ? input
          : input instanceof URL
          ? input.toString()
          : (input as Request).url;

      if (urlStr.includes("blob.vercel.com")) {
        const headers = (init?.headers as Record<string, string>) || {};
        const auth = headers.authorization || headers.Authorization || "";
        if (!auth.startsWith("Bearer ") || auth.replace("Bearer ", "").trim().length === 0) {
          return new Response("Unauthorized", { status: 401 });
        }

        const method = (init?.method || "GET").toUpperCase();
        const cleanKey = urlStr
          .replace(/^https:\/\/blob\.vercel\.com\/?/, "")
          .replace(/^\/+/, "");

        if (method === "PUT") {
          let bodyBuffer: Buffer;
          if (Buffer.isBuffer(init?.body)) {
            bodyBuffer = init.body;
          } else if (init?.body instanceof Uint8Array) {
            bodyBuffer = Buffer.from(init.body);
          } else if (init?.body) {
            bodyBuffer = Buffer.from(await new Response(init.body as any).arrayBuffer());
          } else {
            bodyBuffer = Buffer.alloc(0);
          }
          const contentType = headers["x-content-type"] || "application/pdf";
          blobMockStore.set(cleanKey, { buffer: bodyBuffer, contentType });
          return new Response(
            JSON.stringify({
              url: `https://blob.vercel.com/${cleanKey}`,
              pathname: cleanKey,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        if (method === "GET") {
          const item = blobMockStore.get(cleanKey);
          if (!item) {
            return new Response("Not found", { status: 404 });
          }
          return new Response(item.buffer, {
            status: 200,
            headers: { "Content-Type": item.contentType },
          });
        }

        if (method === "HEAD") {
          const item = blobMockStore.get(cleanKey);
          return new Response(null, { status: item ? 200 : 404 });
        }

        if (method === "POST" && urlStr.includes("/delete")) {
          const body = JSON.parse((init?.body as string) || "{}");
          for (const u of body.urls || []) {
            const k = (u as string).replace(/^https:\/\/blob\.vercel\.com\/?/, "").replace(/^\/+/, "");
            blobMockStore.delete(k);
          }
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
      }

      return originalFetch(input, init);
    };

    restoreFetch = () => {
      globalThis.fetch = originalFetch;
      blobMockStore.clear();
    };
  });

  after(async () => {
    setStorageProvider(null);
    setGlobalMockBlobClient(null);
    if (restoreFetch) restoreFetch();
    if (fs.existsSync(TEST_STORAGE_DIR)) {
      fs.rmSync(TEST_STORAGE_DIR, { recursive: true, force: true });
    }
  });

  // --------------------------------------------------------------------------
  // TASK 9 SPECIFIC TEST REQUIREMENTS (1 through 11)
  // --------------------------------------------------------------------------

  it("1. local provider selection", () => {
    const origVercel = process.env.VERCEL;
    const origStorageProvider = process.env.STORAGE_PROVIDER;
    delete process.env.VERCEL;
    delete process.env.STORAGE_PROVIDER;
    setStorageProvider(null);

    try {
      assert.equal(resolveStorageProviderName(), "local");
      const provider = getStorageProvider();
      assert.equal(provider.name, "local");
      assert.ok(provider instanceof LocalStorageProvider);
    } finally {
      if (origVercel !== undefined) process.env.VERCEL = origVercel;
      if (origStorageProvider !== undefined) process.env.STORAGE_PROVIDER = origStorageProvider;
      setStorageProvider(null);
    }
  });

  it("2. production provider selection", () => {
    const origVercel = process.env.VERCEL;
    const origStorageProvider = process.env.STORAGE_PROVIDER;
    process.env.VERCEL = "1";
    delete process.env.STORAGE_PROVIDER;
    setStorageProvider(null);

    try {
      assert.equal(resolveStorageProviderName(), "vercel-blob");
      const provider = getStorageProvider();
      assert.equal(provider.name, "vercel-blob");
      assert.ok(provider instanceof VercelBlobStorageProvider);
    } finally {
      if (origVercel !== undefined) process.env.VERCEL = origVercel; else delete process.env.VERCEL;
      if (origStorageProvider !== undefined) process.env.STORAGE_PROVIDER = origStorageProvider; else delete process.env.STORAGE_PROVIDER;
      setStorageProvider(null);
    }
  });

  it("3. production must not fall back to local", () => {
    const origVercel = process.env.VERCEL;
    const origStorageProvider = process.env.STORAGE_PROVIDER;
    process.env.VERCEL = "1";
    process.env.STORAGE_PROVIDER = "local";
    setStorageProvider(null);

    try {
      // Must throw fatal error rather than silently falling back to local
      assert.throws(
        () => resolveStorageProviderName(),
        /Local filesystem storage is not permitted in production/
      );
      assert.throws(
        () => getStorageProvider(),
        /Local filesystem storage is not permitted in production/
      );
      assert.throws(
        () => new LocalStorageProvider(),
        /Local filesystem storage is not permitted in production/
      );
    } finally {
      if (origVercel !== undefined) process.env.VERCEL = origVercel; else delete process.env.VERCEL;
      if (origStorageProvider !== undefined) process.env.STORAGE_PROVIDER = origStorageProvider; else delete process.env.STORAGE_PROVIDER;
      setStorageProvider(null);
    }
  });

  it("4. missing production Blob configuration", () => {
    const origVercel = process.env.VERCEL;
    const origToken = process.env.BLOB_READ_WRITE_TOKEN;
    const origStorageProvider = process.env.STORAGE_PROVIDER;

    process.env.VERCEL = "1";
    delete process.env.STORAGE_PROVIDER;
    delete process.env.BLOB_READ_WRITE_TOKEN;

    try {
      const status = validateStorageConfiguration();
      assert.equal(status.valid, false);
      assert.equal(status.provider, "vercel-blob");
      assert.match(status.error || "", /BLOB_READ_WRITE_TOKEN environment variable is not configured/);

      assert.throws(
        () => assertStorageConfigured(),
        /BLOB_READ_WRITE_TOKEN environment variable is not configured/
      );

      const unconfiguredBlob = new VercelBlobStorageProvider("");
      assert.throws(
        () => (unconfiguredBlob as any).ensureConfigured(),
        /BLOB_READ_WRITE_TOKEN environment variable is not configured/
      );
    } finally {
      if (origVercel !== undefined) process.env.VERCEL = origVercel; else delete process.env.VERCEL;
      if (origToken !== undefined) process.env.BLOB_READ_WRITE_TOKEN = origToken; else delete process.env.BLOB_READ_WRITE_TOKEN;
      if (origStorageProvider !== undefined) process.env.STORAGE_PROVIDER = origStorageProvider; else delete process.env.STORAGE_PROVIDER;
    }
  });

  it("5. Blob upload", async () => {
    const blobProvider = new VercelBlobStorageProvider("test-blob-token-upload");
    const syntheticBuffer = await createSyntheticPdf(["Vercel Blob Upload Test", "Bank Statement"]);
    const docId = crypto.randomUUID();
    const { storageKey, storedFileName } = generateStorageKey(docId, "blob_upload_test.pdf");

    const result = await blobProvider.upload(storageKey, syntheticBuffer, {
      contentType: "application/pdf",
    });

    assert.equal(result.storageKey, storageKey);
    assert.equal(result.storedFileName, storedFileName);
    assert.equal(result.size, syntheticBuffer.length);
    assert.equal(await blobProvider.exists(storageKey), true);
  });

  it("6. Blob retrieval", async () => {
    const blobProvider = new VercelBlobStorageProvider("test-blob-token-download");
    const syntheticBuffer = await createSyntheticPdf(["Byte-for-byte Blob Retrieval Check"]);
    const docId = crypto.randomUUID();
    const { storageKey } = generateStorageKey(docId, "blob_retrieval_test.pdf");

    await blobProvider.upload(storageKey, syntheticBuffer);
    const downloaded = await blobProvider.download(storageKey);

    assert.equal(downloaded.length, syntheticBuffer.length);
    assert.deepEqual(downloaded, syntheticBuffer);
    assert.equal(isPdfBuffer(downloaded), true);
  });

  it("7. missing Blob object", async () => {
    const blobProvider = new VercelBlobStorageProvider("test-blob-token-missing");
    const nonExistentKey = "documents/missing-id/missing-blob-file.pdf";

    assert.equal(await blobProvider.exists(nonExistentKey), false);
    await assert.rejects(
      async () => {
        await blobProvider.download(nonExistentKey);
      },
      {
        message: /Storage object not found in Vercel Blob/,
      }
    );
  });

  it("8. cross-user document access", async () => {
    const userA = await prisma.user.upsert({
      where: { email: "blob_owner_user_a@test.com" },
      update: {},
      create: {
        email: "blob_owner_user_a@test.com",
        name: "Blob User A",
        role: Role.USER,
      },
    });

    const docA = await prisma.document.create({
      data: {
        userId: userA.id,
        originalFileName: "blob_user_a_doc.pdf",
        storedFileName: "blob_user_a_doc.pdf",
        mimeType: "application/pdf",
        fileSize: 1024,
        storageKey: `documents/${userA.id}/sample.pdf`,
      },
    });

    const userB = await prisma.user.upsert({
      where: { email: "blob_intruder_user_b@test.com" },
      update: {},
      create: {
        email: "blob_intruder_user_b@test.com",
        name: "Blob Intruder B",
        role: Role.USER,
      },
    });

    const sessionB = await createSession(userB.id);

    const mockReq = {
      headers: {
        authorization: `Bearer ${sessionB.sessionToken}`,
      },
    } as any;

    let resStatusCode = 200;
    const mockRes = {
      setHeader: () => {},
      end: () => {},
      set statusCode(val: number) {
        resStatusCode = val;
      },
      get statusCode() {
        return resStatusCode;
      },
    } as any;

    const authUser = await requireDocumentOwner(mockReq, mockRes, docA.id);
    assert.equal(authUser, null, "Intruder B must not be granted access to Document A");
    assert.equal(mockRes.statusCode, 403, "Access to another user's document must return 403 Forbidden");
  });

  it("9. PDF inspection using Blob", async () => {
    const testUser = await prisma.user.upsert({
      where: { email: "blob_inspect_user@test.com" },
      update: {},
      create: {
        email: "blob_inspect_user@test.com",
        name: "Blob Inspect User",
        role: Role.USER,
      },
    });

    const bcaContent = [
      "PT BANK CENTRAL ASIA TBK",
      "REKENING KORAN",
      "KCU JAKARTA",
      "NOMOR REKENING: 1234567890",
      "PERIODE: 01/01/2026 - 31/01/2026",
      "MATA UANG: IDR",
    ];
    const bcaPdfBuffer = await createSyntheticPdf(bcaContent);

    // Set storage provider to Vercel Blob
    const blobProvider = new VercelBlobStorageProvider("test-blob-token-inspection");
    setStorageProvider(blobProvider);

    // Inspect metadata
    const extractedMetadata = await inspectPdfMetadata(bcaPdfBuffer);
    assert.ok(extractedMetadata);

    // Process and save document
    const result = await processAndSaveDocument({
      originalFileName: "blob_inspected_statement.pdf",
      fileSize: bcaPdfBuffer.length,
      buffer: bcaPdfBuffer,
      extractedMetadata,
      userId: testUser.id,
    });

    assert.equal(result.document.originalFileName, "blob_inspected_statement.pdf");
    assert.equal(result.document.status, "COMPLETED");
    assert.ok(result.document.storageKey.startsWith("documents/"));

    // Verify it was stored in Blob store and not local disk
    const storedInBlob = await blobProvider.exists(result.document.storageKey);
    assert.equal(storedInBlob, true);
    assert.equal(blobMockStore.has(result.document.storageKey), true);
  });

  it("10. bank detection using Blob", async () => {
    const doc = await prisma.document.findFirst({
      where: { originalFileName: "blob_inspected_statement.pdf" },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(doc, "Document must exist in database");

    // Ensure blobProvider is active
    const blobProvider = new VercelBlobStorageProvider("test-blob-token-inspection");
    setStorageProvider(blobProvider);

    // Execute bank detection workflow
    const detectionResult = await runBankDetectionOnDocument(doc.id);
    assert.equal(detectionResult.document.documentType, "BANK_STATEMENT");
    assert.equal(detectionResult.detection.bankCode, "BCA");
    assert.equal(detectionResult.detection.accountNumberMasked, "******7890");
    assert.equal(detectionResult.detection.confidence, "HIGH");
  });

  it("11. transaction extraction using Blob", async () => {
    const testUser = await prisma.user.upsert({
      where: { email: "blob_tx_user@test.com" },
      update: {},
      create: {
        email: "blob_tx_user@test.com",
        name: "Blob TX User",
        role: Role.USER,
      },
    });

    const txContent = [
      "PT BANK CENTRAL ASIA TBK",
      "REKENING KORAN",
      "NO. REKENING : 1234567890",
      "PERIODE : 01/08/2026 s/d 31/08/2026",
      "SALDO AWAL : 10,000,000.00",
      "TGL  KETERANGAN  CB  MUTASI  SALDO",
      "01/08  TRSF E-BANKING CR",
      "       TRANSFER DARI BUDI",
      "       0010  5,000,000.00 CR  15,000,000.00",
      "02/08  BIAYA ADM BULANAN",
      "       0010  15,000.00 DB  14,985,000.00",
      "SALDO AKHIR : 14,985,000.00",
    ];
    const txPdfBuffer = await createSyntheticPdf(txContent);

    const blobProvider = new VercelBlobStorageProvider("test-blob-token-tx");
    setStorageProvider(blobProvider);

    const metadata = await inspectPdfMetadata(txPdfBuffer);
    const saveResult = await processAndSaveDocument({
      originalFileName: "blob_tx_statement.pdf",
      fileSize: txPdfBuffer.length,
      buffer: txPdfBuffer,
      extractedMetadata: metadata,
      userId: testUser.id,
    });

    // Run bank detection first so document has statement record
    await runBankDetectionOnDocument(saveResult.document.id);

    // Run transaction extraction
    const extractionResult = await runTransactionExtractionOnDocument(saveResult.document.id);
    assert.equal(extractionResult.status, "COMPLETED");
    assert.ok(extractionResult.summary.totalTransactionsParsed >= 1);
  });

  // --------------------------------------------------------------------------
  // ADDITIONAL RESILIENCE & LOCAL FALLBACK SUITE
  // --------------------------------------------------------------------------

  it("12. local storage uploads and retrieves byte-for-byte in development", async () => {
    setStorageProvider(localTestProvider);
    const syntheticBuffer = await createSyntheticPdf(["Original Unaltered Bytes", "Checksum 12345"]);
    const docId = crypto.randomUUID();
    const { storageKey } = generateStorageKey(docId, "local_download_test.pdf");

    await localTestProvider.upload(storageKey, syntheticBuffer);
    const downloaded = await localTestProvider.download(storageKey);

    assert.equal(downloaded.length, syntheticBuffer.length);
    assert.deepEqual(downloaded, syntheticBuffer);
    assert.equal(isPdfBuffer(downloaded), true);
  });

  it("13. local storage handles missing storage object gracefully", async () => {
    setStorageProvider(localTestProvider);
    const nonExistentKey = "documents/fake-id/missing-local-file.pdf";

    assert.equal(await localTestProvider.exists(nonExistentKey), false);
    await assert.rejects(
      async () => {
        await localTestProvider.download(nonExistentKey);
      },
      {
        message: /Storage object not found/,
      }
    );
  });

  it("14. rejects invalid or corrupted non-PDF content", async () => {
    const textBuffer = Buffer.from("Plain text content without PDF header signature");
    assert.equal(isPdfBuffer(textBuffer), false);

    const emptyBuffer = Buffer.alloc(0);
    assert.equal(isPdfBuffer(emptyBuffer), false);

    const partialHeader = Buffer.from("%PDF");
    assert.equal(isPdfBuffer(partialHeader), false);

    const validHeader = Buffer.from("%PDF-1.7 standard header");
    assert.equal(isPdfBuffer(validHeader), true);
  });

  it("15. validates duplicate SHA-256 document handling", async () => {
    const syntheticBuffer = await createSyntheticPdf(["Unique Statement For Hash Test"]);
    const hash = crypto.createHash("sha256").update(syntheticBuffer).digest("hex");

    assert.equal(typeof hash, "string");
    assert.equal(hash.length, 64);

    const existing = await findDuplicateDocument(`non-existent-hash-${Date.now()}`);
    assert.equal(existing, null);
  });

  it("16. validates canonical storage key generation and sanitization", () => {
    const docId = "550e8400-e29b-41d4-a716-446655440000";
    const dirtyFileName = "My Bank Statement #1 (Jan & Feb) ../../*.pdf";

    const { storageKey, storedFileName } = generateStorageKey(docId, dirtyFileName);

    assert.match(storageKey, /^documents\/550e8400-e29b-41d4-a716-446655440000\/\d+-[a-f0-9]{8}-My_Bank_Statement/);
    assert.doesNotMatch(storageKey, /\.\./);
    assert.doesNotMatch(storageKey, /[#&*?]/);
    assert.equal(storageKey.startsWith(`documents/${docId}/`), true);
    assert.equal(storageKey.endsWith(storedFileName), true);
  });

  it("17. retrieves Document and PDF through getDocumentPdf with security validation", async () => {
    await assert.rejects(
      async () => {
        await getDocumentPdf("");
      },
      { message: /Invalid document ID/ }
    );

    await assert.rejects(
      async () => {
        await getDocumentPdf("00000000-0000-0000-0000-000000000000");
      },
      { message: /Document not found/ }
    );
  });

  it("18. categorizes Blob errors accurately without leaking secrets", () => {
    assert.equal(
      categorizeBlobError(new Error("BLOB_READ_WRITE_TOKEN is not configured")),
      "configuration_error"
    );
    assert.equal(
      categorizeBlobError(new Error("The deployment could not be found on Vercel. DEPLOYMENT_NOT_FOUND")),
      "deployment_not_found"
    );
    assert.equal(
      categorizeBlobError(new Error("401 Unauthorized: token expired")),
      "authentication_error"
    );
    assert.equal(
      categorizeBlobError(new Error("403 Forbidden: access denied")),
      "authorization_error"
    );
    assert.equal(
      categorizeBlobError(new Error("fetch failed: ECONNRESET")),
      "network_error"
    );
    assert.equal(
      categorizeBlobError(new Error("Vercel Blob: rate limited")),
      "blob_api_error"
    );
  });

  it("19. logs DEPLOYMENT_NOT_FOUND error category and preserves sanitization on upload failure", async () => {
    const errorLogs: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      errorLogs.push(args.map(String).join(" "));
    };

    const failingClient = {
      put: async () => {
        throw new Error(
          "Vercel Blob upload failed (404): The deployment could not be found on Vercel. DEPLOYMENT_NOT_FOUND for token vercel_blob_rw_secret123"
        );
      },
      get: async () => null,
      head: async () => { throw new Error("not found"); },
      del: async () => {},
    };

    const failingProvider = new VercelBlobStorageProvider("test-token", {
      client: failingClient as any,
    });

    try {
      await assert.rejects(
        async () => {
          await failingProvider.upload("documents/test/sample.pdf", Buffer.from("%PDF-1.4 test"));
        },
        (err: Error) => {
          assert.doesNotMatch(err.message, /vercel_blob_rw_secret123/);
          assert.match(err.message, /\[REDACTED_BLOB_TOKEN\]/);
          return true;
        }
      );

      assert.ok(errorLogs.some((l) => l.includes("[STORAGE] Vercel Blob upload failed")));
      assert.ok(errorLogs.some((l) => l.includes("[STORAGE] provider=vercel-blob")));
      assert.ok(errorLogs.some((l) => l.includes("[STORAGE] error_category=deployment_not_found")));
    } finally {
      console.error = origError;
    }
  });

  it("20. safe server storage diagnostic reports provider and adapter without leaking secrets", () => {
    const origToken = process.env.BLOB_READ_WRITE_TOKEN;
    const origProvider = process.env.STORAGE_PROVIDER;

    try {
      process.env.STORAGE_PROVIDER = "vercel-blob";
      process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_supersecrettoken_12345";

      const diag = getStorageDiagnostic();
      assert.equal(diag.provider, "vercel-blob");
      assert.equal(diag.blobConfigured, true);
      assert.equal(diag.adapter, "VercelBlobStorageProvider");

      // Verify JSON serialized diagnostic contains NO secrets
      const serialized = JSON.stringify(diag);
      assert.doesNotMatch(serialized, /supersecrettoken/);
      assert.doesNotMatch(serialized, /token/i);
    } finally {
      if (origToken !== undefined) process.env.BLOB_READ_WRITE_TOKEN = origToken;
      else delete process.env.BLOB_READ_WRITE_TOKEN;
      if (origProvider !== undefined) process.env.STORAGE_PROVIDER = origProvider;
      else delete process.env.STORAGE_PROVIDER;
    }
  });

  it("21. Excel and PDF storage integration uses the unified StorageProvider abstraction", async () => {
    const blobProvider = new VercelBlobStorageProvider("test-blob-token-unified");
    setStorageProvider(blobProvider);

    const pdfBuffer = await createSyntheticPdf(["Unified Storage Provider Verification"]);
    const uploadResult = await blobProvider.upload("documents/unified-test/test.pdf", pdfBuffer, {
      contentType: "application/pdf",
    });

    assert.equal(uploadResult.storageKey, "documents/unified-test/test.pdf");
    assert.equal(await blobProvider.exists("documents/unified-test/test.pdf"), true);

    const downloadedPdf = await blobProvider.download("documents/unified-test/test.pdf");
    assert.deepEqual(downloadedPdf, pdfBuffer);

    // Verify XLSX upload through same abstraction
    const excelBuffer = Buffer.from("PK\x03\x04mock-excel-binary");
    const excelResult = await blobProvider.upload("exports/unified-test/statement.xlsx", excelBuffer, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    assert.equal(excelResult.storageKey, "exports/unified-test/statement.xlsx");
    assert.equal(await blobProvider.exists("exports/unified-test/statement.xlsx"), true);

    const downloadedExcel = await blobProvider.download("exports/unified-test/statement.xlsx");
    assert.deepEqual(downloadedExcel, excelBuffer);
  });
});
