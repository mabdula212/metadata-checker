import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { encryptPDF } from "@pdfsmaller/pdf-encrypt";
import {
  detectEncryption,
  decryptPdf,
  createProcessedPdf,
  storeDecryptedBuffer,
  getDecryptedBuffer,
  clearDecryptedBuffer,
  type ProcessedPdf,
} from "../lib/pdf/pdf-decryptor.js";
import { inspectPdfMetadata, calculateFileHash } from "../lib/pdf/pdf-inspector.js";
import { extractPdfText } from "../lib/pdf/pdf-text-extractor.js";
import { defaultBankDetectionEngine } from "../lib/bank-detection/index.js";
import { defaultTransactionExtractionEngine } from "../lib/transaction-extraction/index.js";
import { generateBankStatementWorkbook } from "../lib/excel/index.js";
import type { BankStatementExportData } from "../lib/excel/types.js";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db/prisma.js";

describe("BNI Decrypted PDF Pipeline Integration Tests", () => {
  const CORRECT_PASSWORD = "BniPassword2025!";
  const WRONG_PASSWORD = "WrongPassword999!";

  let unencryptedBniPdfBytes: Uint8Array;
  let encryptedBniPdfBytes: Uint8Array;
  let processedPdf: ProcessedPdf;

  before(async () => {
    // Generate a sanitized, representative BNI bank statement PDF fixture
    const doc = await PDFDocument.create();
    doc.setTitle("BNI Rekening Koran E-Statement");
    doc.setAuthor("PT BANK NEGARA INDONESIA (PERSERO) TBK");
    doc.setSubject("Laporan Mutasi Rekening");
    doc.setCreator("BNI Core Banking Engine");
    doc.setProducer("BNI Statement Generator");

    const page = doc.addPage([595, 842]); // A4 size
    const contentLines = [
      "PT BANK NEGARA INDONESIA (PERSERO) TBK",
      "REKENING KORAN",
      "NO. REKENING : 0123456789",
      "PERIODE : 01/12/2025 - 31/12/2025",
      "MATA UANG : IDR",
      "SALDO AWAL : 10,000,000.00",
      "TANGGAL URAIAN TRANSAKSI CABANG DEBET KREDIT SALDO",
      "02/12/2025 TRANSFER MASUK DARI REKENING 001 0.00 5,000,000.00 15,000,000.00",
      "10/12/2025 TARIK TUNAI ATM BNI 001 1,000,000.00 0.00 14,000,000.00",
      "15/12/2025 PEMBAYARAN QRIS RESTORAN 001 500,000.00 0.00 13,500,000.00",
      "SALDO AKHIR : 13,500,000.00",
    ];

    let y = 800;
    for (const line of contentLines) {
      page.drawText(line, { x: 40, y, size: 9 });
      y -= 18;
    }

    unencryptedBniPdfBytes = await doc.save();

    // Encrypt fixture to simulate password-protected bank statement
    encryptedBniPdfBytes = await encryptPDF(unencryptedBniPdfBytes, CORRECT_PASSWORD);
  });

  after(async () => {
    await prisma.$disconnect().catch(() => null);
  });

  // 1. Encrypted BNI PDF Detection
  it("1. detects encrypted BNI PDF as PASSWORD_PROTECTED without error", async () => {
    const encInfo = await detectEncryption(encryptedBniPdfBytes);
    assert.equal(encInfo.isEncrypted, true);
    assert.equal(encInfo.securityState, "PASSWORD_PROTECTED");
  });

  // 2. Wrong Password Handling
  it("2. fails decryption on wrong password with generic error message", async () => {
    const decResult = await decryptPdf(encryptedBniPdfBytes, WRONG_PASSWORD);
    assert.equal(decResult.success, false);
    assert.equal(decResult.securityState, "PASSWORD_PROTECTED");
    assert.equal(decResult.error, "Password PDF salah atau dokumen tidak dapat dibuka.");
  });

  // 3. Correct Password Decryption
  it("3. successfully decrypts BNI PDF with correct password and produces analysisBytes", async () => {
    const decResult = await decryptPdf(encryptedBniPdfBytes, CORRECT_PASSWORD);
    assert.equal(decResult.success, true);
    assert.ok(decResult.decryptedBytes);
    assert.ok(decResult.decryptedBytes.length > 0);

    // Create canonical ProcessedPdf
    processedPdf = createProcessedPdf(encryptedBniPdfBytes, decResult.decryptedBytes, true);
    assert.equal(processedPdf.wasEncrypted, true);
    assert.equal(processedPdf.originalBytes.length, encryptedBniPdfBytes.length);
    assert.ok(processedPdf.analysisBytes.length > 0);

    // Ensure analysisBytes are not flagged as encrypted
    const analysisEncCheck = await detectEncryption(processedPdf.analysisBytes);
    assert.equal(analysisEncCheck.isEncrypted, false);
    assert.equal(analysisEncCheck.securityState, "UNPROTECTED");
  });

  // 4. Metadata Inspection with Decrypted analysisBytes
  it("4. metadata inspection receives analysisBytes and extracts page count & metadata status", async () => {
    const originalHash = calculateFileHash(processedPdf.originalBytes);
    const metadata = await inspectPdfMetadata(processedPdf.analysisBytes, {
      originalFileHash: originalHash,
    });

    assert.equal(metadata.fileHash, originalHash);
    assert.equal(metadata.pageCount, 1);
    assert.ok(metadata.metadataStatus === "SUCCESS" || metadata.metadataStatus === "PARTIAL");
    assert.ok(metadata.pdfVersion !== null);
  });

  // 5. BNI Bank Detection on Decrypted Bytes
  it("5. bank detection engine successfully identifies BNI from decrypted analysisBytes text", async () => {
    const textResult = await extractPdfText(processedPdf.analysisBytes);
    assert.ok(textResult.fullText.length > 50);

    const detection = defaultBankDetectionEngine.detect({
      totalPages: textResult.totalPages,
      pages: textResult.pages,
      fullText: textResult.fullText,
      isScannedOrImageOnly: textResult.isScannedOrImageOnly,
      totalCharacterCount: textResult.totalCharacterCount,
    });

    assert.equal(detection.bankCode, "BNI");
    assert.equal(detection.documentType, "BANK_STATEMENT");
    assert.equal(detection.confidence, "HIGH");
    assert.equal(detection.accountNumberMasked, "******6789");
  });

  // 6. Transaction Extraction from Decrypted BNI Statement
  it("6. transaction extraction parses all candidate rows from decrypted statement", async () => {
    const textResult = await extractPdfText(processedPdf.analysisBytes);
    const extraction = defaultTransactionExtractionEngine.extract({
      fullText: textResult.fullText,
      pages: textResult.pages,
      bankCode: "BNI",
      statementPeriodStart: "2025-12-01",
      statementPeriodEnd: "2025-12-31",
    });

    assert.equal(extraction.bankCode, "BNI");
    assert.equal(extraction.transactions.length, 3);

    // Verify individual transaction details
    const tx1 = extraction.transactions[0];
    assert.equal(tx1.transactionDate, "2025-12-02");
    assert.equal(tx1.credit, "5000000.00");
    assert.equal(tx1.balance, "15000000.00");

    const tx2 = extraction.transactions[1];
    assert.equal(tx2.transactionDate, "2025-12-10");
    assert.equal(tx2.debit, "1000000.00");
    assert.equal(tx2.balance, "14000000.00");

    const tx3 = extraction.transactions[2];
    assert.equal(tx3.transactionDate, "2025-12-15");
    assert.equal(tx3.debit, "500000.00");
    assert.equal(tx3.balance, "13500000.00");
  });

  // 7. Balance Continuity & Reconciliation
  it("7. validates balance continuity across transactions matching BNI statement", async () => {
    const textResult = await extractPdfText(processedPdf.analysisBytes);
    const extraction = defaultTransactionExtractionEngine.extract({
      fullText: textResult.fullText,
      pages: textResult.pages,
      bankCode: "BNI",
    });

    assert.equal(extraction.validation.balanceReconciliationStatus, "VALID");
    assert.equal(extraction.validation.calculatedCredits, "5000000.00");
    assert.equal(extraction.validation.calculatedDebits, "1500000.00");
    assert.equal(extraction.validation.sourceOpeningBalance, "10000000.00");
    assert.equal(extraction.validation.sourceClosingBalance, "13500000.00");
  });

  // 8. Needs-Review Rows Verification
  it("8. reports 0 needs-review rows on well-formed BNI statement", async () => {
    const textResult = await extractPdfText(processedPdf.analysisBytes);
    const extraction = defaultTransactionExtractionEngine.extract({
      fullText: textResult.fullText,
      pages: textResult.pages,
      bankCode: "BNI",
    });

    assert.equal(extraction.reviewRows.length, 0);
  });

  // 9. Excel Export of Extracted Decrypted Data
  it("9. exports extracted BNI transactions and summary into a valid Excel workbook", async () => {
    const exportData: BankStatementExportData = {
      document: {
        id: "bni-test-doc",
        userId: "test-user-bni",
        originalFileName: "BNI_Mutasi_Desember_2025.pdf",
        storedFileName: "stored-bni.pdf",
        mimeType: "application/pdf",
        fileSize: encryptedBniPdfBytes.length,
        storageKey: "documents/stored-bni.pdf",
        fileHash: calculateFileHash(encryptedBniPdfBytes),
        status: "COMPLETED",
        documentType: "BANK_STATEMENT",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      metadata: {
        id: "bni-test-meta",
        documentId: "bni-test-doc",
        title: "BNI Rekening Koran E-Statement",
        author: "PT BANK NEGARA INDONESIA (PERSERO) TBK",
        producer: "BNI Statement Generator",
        creator: "BNI Core Banking Engine",
        creationDate: new Date("2025-12-31"),
        modDate: null,
        pageCount: 1,
        pdfVersion: "1.7",
        isLinearized: false,
        isEncrypted: true,
        securityState: "PASSWORD_PROTECTED",
        hasOutline: false,
        rawMetadataJson: null,
        fileHash: calculateFileHash(encryptedBniPdfBytes),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      statement: {
        id: "bni-stmt-1",
        documentId: "bni-test-doc",
        bankAccountId: null,
        bankCode: "BNI",
        bankName: "Bank Negara Indonesia",
        accountNumberMasked: "0123456789",
        accountHolderName: null,
        statementPeriodStart: new Date("2025-12-01"),
        statementPeriodEnd: new Date("2025-12-31"),
        openingBalance: new Prisma.Decimal("10000000.00"),
        closingBalance: new Prisma.Decimal("13500000.00"),
        totalDebit: new Prisma.Decimal("1500000.00"),
        totalCredit: new Prisma.Decimal("5000000.00"),
        netMutation: new Prisma.Decimal("3500000.00"),
        reconciliationStatus: "VALID",
        confidence: 1.0,
        currency: "IDR",
        branchName: null,
        detectedType: "E_STATEMENT",
        isPassbook: false,
        isScanned: false,
        rawExtractedText: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        transactions: [
          {
            id: "tx-bni-1",
            statementId: "bni-stmt-1",
            transactionDate: new Date("2025-12-02"),
            description: "TRANSFER MASUK DARI REKENING 001",
            referenceNumber: null,
            debit: null,
            credit: new Prisma.Decimal("5000000.00"),
            balance: new Prisma.Decimal("15000000.00"),
            transactionType: "TRANSFER_IN",
            category: "Transfer In",
            confidenceScore: 1.0,
            reviewFlags: null,
            rawPayload: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: "tx-bni-2",
            statementId: "bni-stmt-1",
            transactionDate: new Date("2025-12-10"),
            description: "TARIK TUNAI ATM BNI 001",
            referenceNumber: null,
            debit: new Prisma.Decimal("1000000.00"),
            credit: null,
            balance: new Prisma.Decimal("14000000.00"),
            transactionType: "CASH_WITHDRAWAL",
            category: "Cash",
            confidenceScore: 1.0,
            reviewFlags: null,
            rawPayload: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
      reviewRows: [],
      extractionStatus: "COMPLETED",
      balanceReconciliationStatus: "VALID",
      warnings: [],
    };

    const workbook = await generateBankStatementWorkbook(exportData);
    assert.ok(workbook);
    assert.equal(workbook.worksheets.length, 4);

    const buffer = await workbook.xlsx.writeBuffer();
    assert.ok(buffer && buffer.byteLength > 1000);
  });

  // 10. Cache Decrypted Representation Security & Isolation
  it("10. verifies temporary in-memory caching isolates decrypted representation without disk retention", () => {
    const testDocId = "bni-doc-uuid-123";
    storeDecryptedBuffer(testDocId, Buffer.from(processedPdf.analysisBytes), {
      fileHash: calculateFileHash(processedPdf.originalBytes),
      wasEncrypted: true,
    });

    const cached = getDecryptedBuffer(testDocId);
    assert.ok(cached);
    assert.equal(cached.length, processedPdf.analysisBytes.length);

    clearDecryptedBuffer(testDocId);
    assert.equal(getDecryptedBuffer(testDocId), null);
  });
});
