import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import {
  LocalStorageProvider,
  VercelBlobStorageProvider,
  generateStorageKey,
  isPdfBuffer,
  getDocumentPdf,
  getStorageProvider,
  setStorageProvider,
} from "../lib/storage";
import { prisma } from "../lib/db/prisma";
import { defaultBankDetectionEngine } from "../lib/bank-detection";
import { defaultTransactionExtractionEngine } from "../lib/transaction-extraction";
import { extractPdfText } from "../lib/pdf/pdf-text-extractor";
import { findDuplicateDocument } from "../lib/db/documents";

// Temporary test directory for isolated storage
const TEST_STORAGE_DIR = path.join(process.cwd(), "tmp_test_storage");

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

describe("Persistent PDF Storage & Retrieval Engine", () => {
  let testProvider: LocalStorageProvider;

  before(async () => {
    if (!fs.existsSync(TEST_STORAGE_DIR)) {
      fs.mkdirSync(TEST_STORAGE_DIR, { recursive: true });
    }
    testProvider = new LocalStorageProvider(TEST_STORAGE_DIR);
    setStorageProvider(testProvider);
  });

  after(async () => {
    setStorageProvider(null);
    if (fs.existsSync(TEST_STORAGE_DIR)) {
      fs.rmSync(TEST_STORAGE_DIR, { recursive: true, force: true });
    }
  });

  it("1. uploads PDF to storage abstraction", async () => {
    const syntheticBuffer = await createSyntheticPdf(["Test Statement", "Bank Central Asia"]);
    const docId = crypto.randomUUID();
    const { storageKey, storedFileName } = generateStorageKey(docId, "statement.pdf");

    const result = await testProvider.upload(storageKey, syntheticBuffer, {
      contentType: "application/pdf",
    });

    assert.equal(result.storageKey, storageKey);
    assert.equal(result.storedFileName, storedFileName);
    assert.equal(result.size, syntheticBuffer.length);
    assert.equal(await testProvider.exists(storageKey), true);
  });

  it("2. retrieves PDF byte-for-byte from storage", async () => {
    const syntheticBuffer = await createSyntheticPdf(["Original Unaltered Bytes", "Checksum 12345"]);
    const docId = crypto.randomUUID();
    const { storageKey } = generateStorageKey(docId, "download_test.pdf");

    await testProvider.upload(storageKey, syntheticBuffer);
    const downloaded = await testProvider.download(storageKey);

    assert.equal(downloaded.length, syntheticBuffer.length);
    assert.deepEqual(downloaded, syntheticBuffer);
    assert.equal(isPdfBuffer(downloaded), true);
  });

  it("3. handles missing storage object gracefully", async () => {
    const nonExistentKey = "documents/fake-id/missing-file.pdf";

    assert.equal(await testProvider.exists(nonExistentKey), false);
    await assert.rejects(
      async () => {
        await testProvider.download(nonExistentKey);
      },
      {
        message: /Storage object not found/,
      }
    );
  });

  it("4. rejects invalid or corrupted non-PDF content", async () => {
    const textBuffer = Buffer.from("Plain text content without PDF header signature");
    assert.equal(isPdfBuffer(textBuffer), false);

    const emptyBuffer = Buffer.alloc(0);
    assert.equal(isPdfBuffer(emptyBuffer), false);

    const partialHeader = Buffer.from("%PDF");
    assert.equal(isPdfBuffer(partialHeader), false);

    const validHeader = Buffer.from("%PDF-1.7 standard header");
    assert.equal(isPdfBuffer(validHeader), true);
  });

  it("5. validates duplicate SHA-256 document handling", async () => {
    const syntheticBuffer = await createSyntheticPdf(["Unique Statement For Hash Test"]);
    const hash = crypto.createHash("sha256").update(syntheticBuffer).digest("hex");

    assert.equal(typeof hash, "string");
    assert.equal(hash.length, 64);

    // Verify duplicate search returns null when hash does not exist in DB
    const existing = await findDuplicateDocument(`non-existent-hash-${Date.now()}`);
    assert.equal(existing, null);
  });

  it("6. validates canonical storage key generation and sanitization", () => {
    const docId = "550e8400-e29b-41d4-a716-446655440000";
    const dirtyFileName = "My Bank Statement #1 (Jan & Feb) ../../*.pdf";

    const { storageKey, storedFileName } = generateStorageKey(docId, dirtyFileName);

    assert.match(storageKey, /^documents\/550e8400-e29b-41d4-a716-446655440000\/\d+-[a-f0-9]{8}-My_Bank_Statement/);
    assert.doesNotMatch(storageKey, /\.\./);
    assert.doesNotMatch(storageKey, /[#&*?]/);
    assert.equal(storageKey.startsWith(`documents/${docId}/`), true);
    assert.equal(storageKey.endsWith(storedFileName), true);
  });

  it("7. retrieves Document and PDF through getDocumentPdf with security validation", async () => {
    // Attempt with empty or non-existent document ID
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

  it("8. executes Bank Detection using PDF retrieved from storage", async () => {
    // Generate synthetic BCA statement PDF
    const bcaContent = [
      "PT BANK CENTRAL ASIA TBK",
      "REKENING KORAN",
      "KCU JAKARTA",
      "NOMOR REKENING: 1234567890",
      "PERIODE: 01/01/2026 - 31/01/2026",
      "MATA UANG: IDR",
    ];
    const bcaPdfBuffer = await createSyntheticPdf(bcaContent);

    // Upload to storage abstraction
    const docId = crypto.randomUUID();
    const { storageKey } = generateStorageKey(docId, "bca_sample.pdf");
    await testProvider.upload(storageKey, bcaPdfBuffer);

    // Retrieve via StorageProvider
    const retrievedBuffer = await testProvider.download(storageKey);
    assert.equal(isPdfBuffer(retrievedBuffer), true);

    // Extract text and run Bank Detection
    const textResult = await extractPdfText(retrievedBuffer);
    const detectionResult = defaultBankDetectionEngine.detect(textResult);

    assert.equal(detectionResult.documentType, "BANK_STATEMENT");
    assert.equal(detectionResult.bankCode, "BCA");
    assert.equal(detectionResult.accountNumberMasked, "******7890");
    assert.equal(detectionResult.confidence, "HIGH");
  });

  it("9. executes Transaction Extraction using PDF retrieved from storage", async () => {
    // Generate synthetic BCA transactions statement PDF
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

    // Upload to storage abstraction
    const docId = crypto.randomUUID();
    const { storageKey } = generateStorageKey(docId, "bca_tx_sample.pdf");
    await testProvider.upload(storageKey, txPdfBuffer);

    // Retrieve via StorageProvider
    const retrievedBuffer = await testProvider.download(storageKey);
    const textResult = await extractPdfText(retrievedBuffer);

    // Extract transactions from the retrieved document
    const extractionResult = defaultTransactionExtractionEngine.extract(textResult, {
      bankCode: "BCA",
      year: 2026,
    });

    assert.equal(extractionResult.status, "COMPLETED");
    assert.equal(extractionResult.transactions.length >= 1, true);
    const firstTx = extractionResult.transactions[0];
    assert.equal(firstTx.transactionType, "TRANSFER_IN");
    assert.equal(firstTx.credit, "5000000.00");
    assert.equal(firstTx.balance, "15000000.00");
  });

  it("10. VercelBlobStorageProvider configuration guard without credentials", async () => {
    const unconfiguredBlobProvider = new VercelBlobStorageProvider("");
    assert.equal(unconfiguredBlobProvider.name, "vercel-blob");

    await assert.rejects(
      async () => {
        await unconfiguredBlobProvider.download("documents/test/sample.pdf");
      },
      {
        message: /BLOB_READ_WRITE_TOKEN environment variable is not configured/,
      }
    );
  });

  it("11. Safe development default returns local provider at ./storage/documents without secrets", async () => {
    // Reset provider to test default resolution
    setStorageProvider(null);
    const origProvider = process.env.STORAGE_PROVIDER;
    const origToken = process.env.BLOB_READ_WRITE_TOKEN;
    const origPath = process.env.LOCAL_STORAGE_PATH;

    delete process.env.STORAGE_PROVIDER;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.LOCAL_STORAGE_PATH;

    try {
      const provider = getStorageProvider();
      assert.equal(provider.name, "local");

      const localProv = new LocalStorageProvider();
      assert.equal(localProv.name, "local");
    } finally {
      process.env.STORAGE_PROVIDER = origProvider;
      process.env.BLOB_READ_WRITE_TOKEN = origToken;
      process.env.LOCAL_STORAGE_PATH = origPath;
      setStorageProvider(null);
    }
  });
});
