import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { Role } from "@prisma/client";
import {
  LocalStorageProvider,
  VercelBlobStorageProvider,
  getStorageProvider,
  setStorageProvider,
  resolveStorageProviderName,
  validateStorageConfiguration,
  assertStorageConfigured,
  getStorageDiagnostic,
  generateStorageKey,
  isPdfBuffer,
  categorizeBlobError,
} from "../lib/storage/index.js";
import { prisma } from "../lib/db/prisma.js";
import { exportBankStatementToExcel } from "../lib/excel/exporter.js";
import { processAndSaveDocument } from "../lib/db/documents.js";
import { inspectPdfMetadata } from "../lib/pdf/pdf-inspector.js";

const AUDIT_STORAGE_DIR = path.join(process.cwd(), "tmp_audit_storage");
const auditBlobStore = new Map<string, { buffer: Buffer; contentType: string }>();

async function createSyntheticPdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Audit Bank Statement Test", { x: 50, y: 750, size: 12, font, color: rgb(0, 0, 0) });
  page.drawText("Saldo Awal: 10.000.000,00", { x: 50, y: 720, size: 10, font, color: rgb(0, 0, 0) });
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

describe("Vercel Blob Storage Provider Audit & Production Readiness Suite", () => {
  before(async () => {
    if (!fs.existsSync(AUDIT_STORAGE_DIR)) {
      fs.mkdirSync(AUDIT_STORAGE_DIR, { recursive: true });
    }

    VercelBlobStorageProvider.mockClient = {
      put: async (pathname: string, body: any, options: any) => {
        const cleanKey = pathname.replace(/^\/+/, "");
        let bodyBuffer: Buffer;
        if (Buffer.isBuffer(body)) {
          bodyBuffer = body;
        } else if (body instanceof Uint8Array) {
          bodyBuffer = Buffer.from(body);
        } else {
          bodyBuffer = Buffer.from(String(body));
        }
        const contentType = options?.contentType || "application/octet-stream";
        auditBlobStore.set(cleanKey, { buffer: bodyBuffer, contentType });
        return {
          url: `https://meoxtwv0oiwwacjk.private.blob.vercel-storage.com/${cleanKey}`,
          downloadUrl: `https://meoxtwv0oiwwacjk.private.blob.vercel-storage.com/${cleanKey}?download=1`,
          pathname: cleanKey,
          contentType,
          contentDisposition: `inline; filename="${cleanKey}"`,
          etag: '"audit-etag-123"',
        };
      },
      get: async (pathname: string) => {
        const cleanKey = pathname.replace(/^\/+/, "");
        const item = auditBlobStore.get(cleanKey);
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
          headers: new Headers({ "content-type": item.contentType }),
          blob: {
            url: `https://meoxtwv0oiwwacjk.private.blob.vercel-storage.com/${cleanKey}`,
            downloadUrl: `https://meoxtwv0oiwwacjk.private.blob.vercel-storage.com/${cleanKey}?download=1`,
            pathname: cleanKey,
            contentDisposition: `inline; filename="${cleanKey}"`,
            cacheControl: "private, max-age=31536000",
            uploadedAt: new Date(),
            etag: '"audit-etag-123"',
            contentType: item.contentType,
            size: item.buffer.length,
          },
        } as any;
      },
      head: async (pathname: string) => {
        const cleanKey = pathname.replace(/^\/+/, "");
        const item = auditBlobStore.get(cleanKey);
        if (!item) throw new Error("Vercel Blob: The requested blob does not exist");
        return {
          url: `https://meoxtwv0oiwwacjk.private.blob.vercel-storage.com/${cleanKey}`,
          downloadUrl: `https://meoxtwv0oiwwacjk.private.blob.vercel-storage.com/${cleanKey}?download=1`,
          pathname: cleanKey,
          contentType: item.contentType,
          contentDisposition: `inline; filename="${cleanKey}"`,
          cacheControl: "private, max-age=31536000",
          uploadedAt: new Date(),
          etag: '"audit-etag-123"',
          size: item.buffer.length,
        } as any;
      },
      del: async (urlOrPathname: string | string[]) => {
        const urls = Array.isArray(urlOrPathname) ? urlOrPathname : [urlOrPathname];
        for (const u of urls) {
          const cleanKey = u.replace(/^https:\/\/[^/]+\//, "").replace(/^\/+/, "");
          auditBlobStore.delete(cleanKey);
        }
      },
    };
  });

  after(() => {
    VercelBlobStorageProvider.mockClient = null;
    setStorageProvider(null);
    if (fs.existsSync(AUDIT_STORAGE_DIR)) {
      fs.rmSync(AUDIT_STORAGE_DIR, { recursive: true, force: true });
    }
  });

  it("1. StorageProvider local adapter handles binary files correctly", async () => {
    const local = new LocalStorageProvider(AUDIT_STORAGE_DIR);
    const key = "test/sample-local.txt";
    const data = Buffer.from("local storage test content");

    const uploadRes = await local.upload(key, data, { contentType: "text/plain" });
    assert.equal(uploadRes.storageKey, key);
    assert.equal(await local.exists(key), true);

    const downloaded = await local.download(key);
    assert.deepEqual(downloaded, data);

    const deleted = await local.delete(key);
    assert.equal(deleted, true);
    assert.equal(await local.exists(key), false);
  });

  it("2. StorageProvider Vercel Blob adapter uploads and downloads private blobs", async () => {
    const blob = new VercelBlobStorageProvider("test-read-write-token");
    const key = "documents/test-doc-id/statement.pdf";
    const pdfData = await createSyntheticPdf();

    const uploadRes = await blob.upload(key, pdfData, { contentType: "application/pdf" });
    assert.equal(uploadRes.storageKey, key);
    assert.equal(uploadRes.size, pdfData.length);
    assert.equal(await blob.exists(key), true);

    const downloaded = await blob.download(key);
    assert.deepEqual(downloaded, pdfData);
    assert.equal(isPdfBuffer(downloaded), true);

    await blob.delete(key);
    assert.equal(await blob.exists(key), false);
  });

  it("3. Missing Blob configuration throws clear error without local fallback", async () => {
    const blob = new VercelBlobStorageProvider("");
    const dummyBuffer = Buffer.from("test");

    await assert.rejects(
      async () => {
        await blob.upload("documents/test.pdf", dummyBuffer);
      },
      {
        message: /Production storage is not configured.*BLOB_READ_WRITE_TOKEN/,
      }
    );

    await assert.rejects(
      async () => {
        await blob.download("documents/test.pdf");
      },
      {
        message: /Production storage is not configured.*BLOB_READ_WRITE_TOKEN/,
      }
    );
  });

  it("4. Categorizes errors properly: deployment_not_found, configuration_error, authentication_error", () => {
    assert.equal(
      categorizeBlobError(new Error("The deployment could not be found on Vercel. DEPLOYMENT_NOT_FOUND")),
      "deployment_not_found"
    );
    assert.equal(
      categorizeBlobError(new Error("Vercel Blob upload failed (404): DEPLOYMENT_NOT_FOUND")),
      "deployment_not_found"
    );
    assert.equal(
      categorizeBlobError(new Error("BLOB_READ_WRITE_TOKEN environment variable is not configured")),
      "configuration_error"
    );
    assert.equal(
      categorizeBlobError(new Error("BlobAccessError: Unauthorized")),
      "authentication_error"
    );
    assert.equal(
      categorizeBlobError(new Error("fetch failed: ECONNREFUSED")),
      "network_error"
    );
    assert.equal(
      categorizeBlobError(new Error("Unexpected internal error")),
      "blob_api_error"
    );
  });

  it("5. DEPLOYMENT_NOT_FOUND error mapping logs error_category=deployment_not_found", async () => {
    const failingClient = {
      put: async () => {
        throw new Error("The deployment could not be found on Vercel. DEPLOYMENT_NOT_FOUND");
      },
    };

    const blob = new VercelBlobStorageProvider("test-token", failingClient as any);
    const logs: string[] = [];
    const origErr = console.error;
    console.error = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      await assert.rejects(
        async () => {
          await blob.upload("test.pdf", Buffer.from("test"));
        },
        {
          message: /DEPLOYMENT_NOT_FOUND/,
        }
      );

      assert.ok(logs.some((l) => l.includes("[STORAGE] Vercel Blob upload failed")));
      assert.ok(logs.some((l) => l.includes("[STORAGE] provider=vercel-blob")));
      assert.ok(logs.some((l) => l.includes("[STORAGE] error_category=deployment_not_found")));
    } finally {
      console.error = origErr;
    }
  });

  it("6. Production environment never falls back to local storage", () => {
    const origVercel = process.env.VERCEL;
    const origStorage = process.env.STORAGE_PROVIDER;

    try {
      process.env.VERCEL = "1";
      process.env.STORAGE_PROVIDER = "local";

      assert.throws(
        () => {
          resolveStorageProviderName();
        },
        {
          message: /Local filesystem storage is not permitted in production/,
        }
      );

      delete process.env.STORAGE_PROVIDER;
      assert.equal(resolveStorageProviderName(), "vercel-blob");
    } finally {
      if (origVercel !== undefined) process.env.VERCEL = origVercel;
      else delete process.env.VERCEL;
      if (origStorage !== undefined) process.env.STORAGE_PROVIDER = origStorage;
      else delete process.env.STORAGE_PROVIDER;
    }
  });

  it("7. PDF storage integration works with Vercel Blob provider", async () => {
    const blobProvider = new VercelBlobStorageProvider("test-audit-token");
    setStorageProvider(blobProvider);

    const testUser = await prisma.user.upsert({
      where: { email: "audit_blob_user@test.com" },
      update: {},
      create: {
        email: "audit_blob_user@test.com",
        name: "Audit Blob User",
        role: Role.USER,
      },
    });

    const pdfBuffer = await createSyntheticPdf();
    const metadata = await inspectPdfMetadata(pdfBuffer);

    const result = await processAndSaveDocument({
      buffer: pdfBuffer,
      originalFileName: "audit_statement.pdf",
      fileSize: pdfBuffer.length,
      extractedMetadata: metadata,
      ownerUserId: testUser.id,
    });

    assert.ok(result.document.id);
    assert.ok(result.document.storageKey);
    assert.equal(await blobProvider.exists(result.document.storageKey), true);

    const downloadedPdf = await blobProvider.download(result.document.storageKey);
    assert.equal(isPdfBuffer(downloadedPdf), true);
  });

  it("8. Excel storage integration uploads generated workbook and outputs required audit logs", async () => {
    const blobProvider = new VercelBlobStorageProvider("test-audit-token");
    setStorageProvider(blobProvider);

    const testUser = await prisma.user.upsert({
      where: { email: "audit_excel_user@test.com" },
      update: {},
      create: {
        email: "audit_excel_user@test.com",
        name: "Audit Excel User",
        role: Role.USER,
      },
    });

    const pdfBuffer = await createSyntheticPdf();
    const metadata = await inspectPdfMetadata(pdfBuffer);
    const docResult = await processAndSaveDocument({
      buffer: pdfBuffer,
      originalFileName: "audit_bca_statement.pdf",
      fileSize: pdfBuffer.length,
      extractedMetadata: metadata,
      ownerUserId: testUser.id,
    });

    // Create a mock Statement and Transactions so Excel exporter has data
    await prisma.statement.create({
      data: {
        documentId: docResult.document.id,
        bankName: "BCA",
        accountNumberMasked: "123***456",
        accountHolderName: "John Doe",
        openingBalance: 10000000,
        closingBalance: 12000000,
        totalCredit: 2500000,
        totalDebit: 500000,
        transactionCount: 2,
        transactions: {
          create: [
            {
              transactionDate: new Date("2026-01-01"),
              description: "Transfer Inflow",
              credit: 2500000,
              debit: 0,
              balance: 12500000,
              transactionType: "TRANSFER",
            },
            {
              transactionDate: new Date("2026-01-02"),
              description: "QRIS Outflow",
              credit: 0,
              debit: 500000,
              balance: 12000000,
              transactionType: "QRIS",
            },
          ],
        },
      },
    });

    // Intercept stdout to verify the 4 required audit logs:
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
      origLog(...args);
    };

    try {
      const exportRes = await exportBankStatementToExcel({
        documentId: docResult.document.id,
        userId: testUser.id,
        forceRegenerate: true,
      });

      assert.ok(exportRes.exportId);
      assert.ok(exportRes.storageKey);
      assert.equal(exportRes.format, "XLSX");
      assert.equal(await blobProvider.exists(exportRes.storageKey), true);

      // Verify the 4 mandatory log lines were emitted in order
      assert.ok(logs.some((l) => l.includes("[EXCEL_EXPORT] workbook generation started")));
      assert.ok(logs.some((l) => l.includes("[EXCEL_EXPORT] workbook generation completed")));
      assert.ok(logs.some((l) => l.includes("[EXCEL_EXPORT] storage upload started")));
      assert.ok(logs.some((l) => l.includes("[EXCEL_EXPORT] storage upload completed")));
    } finally {
      console.log = origLog;
    }
  });

  it("9. Storage health check diagnostic returns safe configuration without secrets", () => {
    const diagnostic = getStorageDiagnostic();
    assert.ok(diagnostic.provider === "local" || diagnostic.provider === "vercel-blob");
    assert.equal(typeof diagnostic.blobConfigured, "boolean");
    assert.ok(diagnostic.adapter.includes("StorageProvider"));

    // Ensure no secrets are present
    const str = JSON.stringify(diagnostic);
    assert.equal(str.includes("token"), false);
    assert.equal(str.includes("secret"), false);
    assert.equal(str.includes("password"), false);
  });
});
