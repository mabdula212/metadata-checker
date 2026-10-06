import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { PDFDocument } from "pdf-lib";
import {
  inspectPdfMetadata,
  validatePdfBuffer,
  calculateFileHash,
  extractPdfVersion,
  createStableByteCopy,
  createStableBufferCopy,
} from "../lib/pdf/pdf-inspector.js";
import {
  processAndSaveDocument,
  findDuplicateDocument,
  getDocumentPdf,
} from "../lib/db/documents.js";
import { prisma } from "../lib/db/prisma.js";
import { setStorageProvider, LocalStorageProvider } from "../lib/storage/index.js";

describe("PDF Inspect ArrayBuffer Detachment & Resiliency Tests", () => {
  let samplePdfUint8Array: Uint8Array;
  let samplePdfBuffer: Buffer;
  let testUserId: string;

  before(async () => {
    // Ensure test environment uses local storage
    process.env.STORAGE_PROVIDER = "local";
    process.env.LOCAL_STORAGE_PATH = "./storage/test-documents";
    setStorageProvider(new LocalStorageProvider("./storage/test-documents"));

    // Find or create test user
    const user = await prisma.user.upsert({
      where: { email: "test-arraybuffer@example.com" },
      update: {},
      create: {
        email: "test-arraybuffer@example.com",
        passwordHash: "dummyhash",
        name: "ArrayBuffer Tester",
        role: "USER",
      },
    });
    testUserId = user.id;

    // Generate a valid test PDF using pdf-lib
    const pdfDoc = await PDFDocument.create();
    pdfDoc.setTitle("March 2026 Bank Statement");
    pdfDoc.setAuthor("First National Bank");
    pdfDoc.setSubject("Monthly Account Statement");
    pdfDoc.setCreator("Banking Core System v2");
    pdfDoc.setProducer("Enterprise PDF Generator");
    const page1 = pdfDoc.addPage([600, 400]);
    page1.drawText("ACCOUNT STATEMENT - Page 1");
    const page2 = pdfDoc.addPage([600, 400]);
    page2.drawText("ACCOUNT STATEMENT - Page 2");

    samplePdfUint8Array = await pdfDoc.save();
    samplePdfBuffer = Buffer.from(samplePdfUint8Array);
  });

  after(async () => {
    // Clean up created test documents
    try {
      await prisma.documentMetadata.deleteMany({
        where: { document: { userId: testUserId } },
      });
      await prisma.processingJob.deleteMany({
        where: { document: { userId: testUserId } },
      });
      await prisma.document.deleteMany({
        where: { userId: testUserId },
      });
      await prisma.user.deleteMany({
        where: { id: testUserId },
      });
    } catch {
      // Ignore cleanup error
    }
  });

  // 1. PDF inspection from Uint8Array
  it("1. PDF inspection from Uint8Array succeeds without detachment", async () => {
    // Pass Uint8Array directly
    const inputUint8 = new Uint8Array(samplePdfUint8Array);
    const metadata = await inspectPdfMetadata(inputUint8);

    assert.strictEqual(metadata.pageCount, 2);
    assert.strictEqual(metadata.title, "March 2026 Bank Statement");
    assert.strictEqual(metadata.author, "First National Bank");
    assert.ok(metadata.fileHash.length === 64);
    // Assert original buffer's underlying ArrayBuffer was NOT detached
    assert.strictEqual(inputUint8.buffer.detached, false);
  });

  // 2. PDF inspection after SHA-256 calculation
  it("2. PDF inspection after SHA-256 calculation does not detach the buffer", async () => {
    const inputBytes = new Uint8Array(samplePdfUint8Array);
    const preCalculatedHash = calculateFileHash(inputBytes);

    assert.strictEqual(inputBytes.buffer.detached, false);

    const metadata = await inspectPdfMetadata(inputBytes);
    assert.strictEqual(metadata.fileHash, preCalculatedHash);
    assert.strictEqual(inputBytes.buffer.detached, false);
  });

  // 3. PDF inspection after creating independent byte copies
  it("3. PDF inspection after creating independent byte copies remains completely isolated", async () => {
    const originalBytes = new Uint8Array(samplePdfUint8Array);
    const copy1 = createStableByteCopy(originalBytes);
    const copy2 = createStableBufferCopy(originalBytes);

    assert.notStrictEqual(copy1.buffer, originalBytes.buffer);
    assert.notStrictEqual(copy2.buffer, originalBytes.buffer);

    const metaOriginal = await inspectPdfMetadata(originalBytes);
    const metaCopy1 = await inspectPdfMetadata(copy1);
    const metaCopy2 = await inspectPdfMetadata(copy2);

    assert.strictEqual(metaOriginal.fileHash, metaCopy1.fileHash);
    assert.strictEqual(metaOriginal.fileHash, metaCopy2.fileHash);
    assert.strictEqual(metaOriginal.pageCount, 2);
  });

  // 4. Repeated PDF inspection using the same source bytes
  it("4. repeated PDF inspection using the same source bytes succeeds without error", async () => {
    const reusableBytes = new Uint8Array(samplePdfUint8Array);

    for (let i = 0; i < 5; i++) {
      const meta = await inspectPdfMetadata(reusableBytes);
      assert.strictEqual(meta.pageCount, 2);
      assert.strictEqual(reusableBytes.buffer.detached, false);
    }
  });

  // 5. Valid PDF inspection extracts all fields correctly
  it("5. valid PDF extracts all standard metadata attributes, version, and page count", async () => {
    const meta = await inspectPdfMetadata(samplePdfBuffer);

    assert.strictEqual(meta.pageCount, 2);
    assert.strictEqual(meta.title, "March 2026 Bank Statement");
    assert.strictEqual(meta.author, "First National Bank");
    assert.strictEqual(meta.subject, "Monthly Account Statement");
    assert.strictEqual(meta.creator, "Banking Core System v2");
    assert.strictEqual(meta.producer, "Enterprise PDF Generator");
    assert.ok(meta.pdfVersion !== null);
    assert.ok(meta.fileHash.length === 64);
  });

  // 6. Corrupted PDF handling
  it("6. corrupted PDF returns clear error without unhandled detachment crash", async () => {
    // Starts with %PDF- header so magic passes, but body is garbage
    const corruptedBytes = Buffer.from("%PDF-1.7\nCorrupted binary payload with no xref, trailer, or catalog");
    await assert.rejects(
      async () => {
        await inspectPdfMetadata(corruptedBytes);
      },
      (err: Error) => {
        assert.ok(
          err.message.includes("0 readable pages") ||
          err.message.includes("unrecoverable structure") ||
          err.message.includes("Corrupted")
        );
        return true;
      }
    );
  });

  // 7. Non-PDF file handling
  it("7. non-PDF file fails magic byte validation", async () => {
    const textBytes = Buffer.from("This is a plain text file, not a PDF document.");
    await assert.rejects(
      async () => {
        await inspectPdfMetadata(textBytes);
      },
      (err: Error) => {
        assert.ok(err.message.includes("missing %PDF- header") || err.message.includes("not a valid PDF"));
        return true;
      }
    );
  });

  // 8. Empty file handling
  it("8. empty file fails validation with 0 bytes message", async () => {
    const emptyBuffer = Buffer.alloc(0);
    await assert.rejects(
      async () => {
        await inspectPdfMetadata(emptyBuffer);
      },
      (err: Error) => {
        assert.ok(err.message.includes("empty (0 bytes)"));
        return true;
      }
    );
  });

  // 9. DocumentMetadata is persisted in database
  it("9. DocumentMetadata is persisted and matches extracted values", async () => {
    // Generate a fresh unique PDF to avoid duplicate detection
    const uniqueDoc = await PDFDocument.create();
    uniqueDoc.setTitle("Unique Persistence Test PDF");
    uniqueDoc.setAuthor("Auditor");
    uniqueDoc.addPage([500, 300]);
    const uniqueBytes = await uniqueDoc.save();
    const uniqueBuffer = Buffer.from(uniqueBytes);

    const extracted = await inspectPdfMetadata(uniqueBuffer);
    const result = await processAndSaveDocument({
      originalFileName: "unique-test.pdf",
      fileSize: uniqueBuffer.length,
      buffer: uniqueBuffer,
      extractedMetadata: extracted,
      userId: testUserId,
    });

    assert.strictEqual(result.isDuplicate, false);
    assert.strictEqual(result.document.originalFileName, "unique-test.pdf");
    assert.strictEqual(result.metadata.title, "Unique Persistence Test PDF");
    assert.strictEqual(result.metadata.author, "Auditor");
    assert.strictEqual(result.metadata.pageCount, 1);
    assert.strictEqual(result.metadata.fileHash, extracted.fileHash);

    // Verify stored document can be retrieved from storage
    const storedPdf = await getDocumentPdf(result.document.id);
    assert.ok(storedPdf !== null);
    assert.strictEqual(storedPdf.buffer.length, uniqueBuffer.length);
  });

  // 10. ProcessingJob lifecycle works correctly
  it("10. ProcessingJob lifecycle completes with COMPLETED status", async () => {
    const jobDoc = await PDFDocument.create();
    jobDoc.setTitle("Job Lifecycle Test");
    jobDoc.addPage();
    const jobBytes = await jobDoc.save();
    const jobBuffer = Buffer.from(jobBytes);

    const extracted = await inspectPdfMetadata(jobBuffer);
    const result = await processAndSaveDocument({
      originalFileName: "job-lifecycle.pdf",
      fileSize: jobBuffer.length,
      buffer: jobBuffer,
      extractedMetadata: extracted,
      userId: testUserId,
    });

    assert.ok(result.job);
    assert.strictEqual(result.job.status, "COMPLETED");
    assert.strictEqual(result.job.jobType, "METADATA_EXTRACTION");
    assert.strictEqual(result.document.status, "COMPLETED");
  });

  // 11. Duplicate detection works correctly via SHA-256
  it("11. duplicate detection identifies previously uploaded PDF via SHA-256", async () => {
    const dupDoc = await PDFDocument.create();
    dupDoc.setTitle("Duplicate Detection PDF");
    dupDoc.addPage();
    const dupBytes = await dupDoc.save();
    const dupBuffer = Buffer.from(dupBytes);

    const extracted = await inspectPdfMetadata(dupBuffer);

    // First upload
    const upload1 = await processAndSaveDocument({
      originalFileName: "first-upload.pdf",
      fileSize: dupBuffer.length,
      buffer: dupBuffer,
      extractedMetadata: extracted,
      userId: testUserId,
    });
    assert.strictEqual(upload1.isDuplicate, false);

    // Second upload with same bytes
    const upload2 = await processAndSaveDocument({
      originalFileName: "second-upload-copy.pdf",
      fileSize: dupBuffer.length,
      buffer: dupBuffer,
      extractedMetadata: extracted,
      userId: testUserId,
    });
    assert.strictEqual(upload2.isDuplicate, true);
    assert.strictEqual(upload2.document.id, upload1.document.id);
  });

  // 12. Intentionally detached ArrayBuffer is safely detected and guarded
  it("12. createStableByteCopy rejects detached ArrayBuffer gracefully", () => {
    const ab = new ArrayBuffer(64);
    // Detach ab via structuredClone transfer
    structuredClone(new Uint8Array(ab), { transfer: [ab] });
    assert.strictEqual(ab.detached, true);

    assert.throws(
      () => {
        createStableByteCopy(ab);
      },
      (err: Error) => {
        assert.ok(err.message.includes("Cannot create byte copy from a detached ArrayBuffer"));
        return true;
      }
    );
  });
});
