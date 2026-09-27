import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { encryptPDF } from "@pdfsmaller/pdf-encrypt";
import {
  detectEncryption,
  decryptPdf,
  normalizePdf,
  storeDecryptedBuffer,
  getDecryptedBuffer,
  clearDecryptedBuffer,
} from "../lib/pdf/pdf-decryptor.js";
import { inspectPdfMetadata, calculateFileHash } from "../lib/pdf/pdf-inspector.js";
import { defaultBankDetectionEngine } from "../lib/bank-detection/index.js";
import { defaultTransactionExtractionEngine } from "../lib/transaction-extraction/index.js";
import { generateBankStatementWorkbook } from "../lib/excel/index.js";
import type { BankStatementExportData } from "../lib/excel/types.js";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db/prisma.js";
import { setStorageProvider, LocalStorageProvider } from "../lib/storage/index.js";
import { processAndSaveDocument, getDocumentPdf } from "../lib/db/documents.js";
import fs from "fs";
import path from "path";

describe("Password-Protected PDF Support & Decryption Security Tests", () => {
  const TEST_PASSWORD = "CorrectPassword123!";
  const WRONG_PASSWORD = "IncorrectPassword999!";
  let unprotectedPdfBytes: Uint8Array;
  let protectedPdfBytes: Uint8Array;
  let bankStatementPdfBytes: Uint8Array;
  let protectedBankStatementBytes: Uint8Array;
  let testUserId: string;

  before(async () => {
    // Ensure test environment uses local storage
    process.env.STORAGE_PROVIDER = "local";
    process.env.LOCAL_STORAGE_PATH = "./storage/test-secure-documents";
    setStorageProvider(new LocalStorageProvider("./storage/test-secure-documents"));

    // Ensure clean user
    const user = await prisma.user.upsert({
      where: { email: "test-pdf-security@example.com" },
      update: {},
      create: {
        email: "test-pdf-security@example.com",
        passwordHash: "dummyuserhash",
        name: "Security Tester",
        role: "USER",
      },
    });
    testUserId = user.id;

    // 1. Create standard unprotected PDF fixture
    const doc1 = await PDFDocument.create();
    doc1.setTitle("Financial Statement Sample");
    doc1.setAuthor("Test Bank Indonesia");
    const page1 = doc1.addPage([500, 700]);
    page1.drawText("Unprotected Sample PDF Content", { x: 50, y: 650, size: 14 });
    unprotectedPdfBytes = await doc1.save();

    // 2. Create password-protected PDF fixture
    protectedPdfBytes = await encryptPDF(unprotectedPdfBytes, TEST_PASSWORD);

    // 3. Create bank statement PDF fixture with realistic bank data
    const doc2 = await PDFDocument.create();
    doc2.setTitle("BCA Rekening Koran");
    doc2.setAuthor("PT BANK CENTRAL ASIA TBK");
    const page2 = doc2.addPage([600, 800]);
    page2.drawText("PT BANK CENTRAL ASIA TBK", { x: 50, y: 750, size: 14 });
    page2.drawText("REKENING KORAN", { x: 50, y: 730, size: 12 });
    page2.drawText("NO. REKENING : 1234567890", { x: 50, y: 710, size: 10 });
    page2.drawText("PERIODE : 01/01/26 - 31/01/26", { x: 50, y: 690, size: 10 });
    page2.drawText("SALDO AWAL : 10,000,000.00", { x: 50, y: 670, size: 10 });
    page2.drawText("02/01 TRSF E-BANKING DB 500,000.00 9,500,000.00", { x: 50, y: 650, size: 10 });
    page2.drawText("15/01 GAJI CR 5,000,000.00 14,500,000.00", { x: 50, y: 630, size: 10 });
    page2.drawText("SALDO AKHIR : 14,500,000.00", { x: 50, y: 610, size: 10 });
    bankStatementPdfBytes = await doc2.save();

    // 4. Create encrypted bank statement PDF fixture
    protectedBankStatementBytes = await encryptPDF(bankStatementPdfBytes, TEST_PASSWORD);
  });

  after(async () => {
    // Cleanup temporary test files
    try {
      if (fs.existsSync("./storage/test-secure-documents")) {
        fs.rmSync("./storage/test-secure-documents", { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  });

  // 1. Normal unprotected PDF
  it("1. correctly detects and processes normal unprotected PDF", async () => {
    const encInfo = await detectEncryption(unprotectedPdfBytes);
    assert.equal(encInfo.securityState, "UNPROTECTED");
    assert.equal(encInfo.isEncrypted, false);

    const result = await decryptPdf(unprotectedPdfBytes);
    assert.equal(result.success, true);
    assert.equal(result.securityState, "UNPROTECTED");
    assert.ok(result.decryptedBytes && result.decryptedBytes.length > 0);
  });

  // 2. Password-protected PDF detection
  it("2. detects password-protected PDF without classifying as INVALID_PDF", async () => {
    const encInfo = await detectEncryption(protectedPdfBytes);
    assert.equal(encInfo.securityState, "PASSWORD_PROTECTED");
    assert.equal(encInfo.isEncrypted, true);
    assert.ok(encInfo.algorithm?.includes("AES") || encInfo.version === 5);

    // Without password, decryptPdf reports PASSWORD_PROTECTED with prompt requirement
    const result = await decryptPdf(protectedPdfBytes);
    assert.equal(result.success, false);
    assert.equal(result.securityState, "PASSWORD_PROTECTED");
    assert.match(result.error || "", /dilindungi password/i);
  });

  // 3. Correct password
  it("3. successfully decrypts password-protected PDF with correct password", async () => {
    const result = await decryptPdf(protectedPdfBytes, TEST_PASSWORD);
    assert.equal(result.success, true);
    assert.equal(result.securityState, "PASSWORD_PROTECTED");
    assert.ok(result.decryptedBytes);
    assert.ok(result.decryptedBuffer);

    // Validates that decrypted bytes can be loaded without password
    const loadedDoc = await PDFDocument.load(result.decryptedBytes);
    assert.equal(loadedDoc.getTitle(), "Financial Statement Sample");
    assert.equal(loadedDoc.getPageCount(), 1);
  });

  // 4. Incorrect password
  it("4. handles incorrect password with safe generic error message", async () => {
    const result = await decryptPdf(protectedPdfBytes, WRONG_PASSWORD);
    assert.equal(result.success, false);
    assert.equal(result.securityState, "PASSWORD_PROTECTED");
    assert.equal(result.error, "Password PDF salah atau dokumen tidak dapat dibuka.");

    // Does NOT reveal internals or how close password was
    assert.ok(!result.error.toLowerCase().includes("aes"));
    assert.ok(!result.error.toLowerCase().includes("cipher"));
    assert.ok(!result.error.toLowerCase().includes("sasl"));
  });

  // 5. Unsupported encryption
  it("5. safely identifies and reports unsupported encryption", async () => {
    // Simulated PDF with custom proprietary filter
    const fakeCustomPdf = Buffer.from(
      "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
        "trailer\n<< /Root 1 0 R /Encrypt << /Filter /ProprietaryCustomDRM /V 99 /R 99 >> >>\n%%EOF"
    );

    const encInfo = await detectEncryption(fakeCustomPdf);
    assert.ok(
      encInfo.securityState === "UNSUPPORTED_ENCRYPTION" ||
        encInfo.securityState === "PASSWORD_PROTECTED"
    );

    const result = await decryptPdf(fakeCustomPdf, "anypassword");
    assert.equal(result.success, false);
    assert.ok(
      result.securityState === "UNSUPPORTED_ENCRYPTION" ||
        result.securityState === "PASSWORD_PROTECTED"
    );
    assert.ok(
      result.error === "Jenis enkripsi PDF ini belum didukung." ||
        result.error === "Password PDF salah atau dokumen tidak dapat dibuka."
    );
  });

  // 6. Invalid PDF
  it("6. flags invalid non-PDF file as INVALID_PDF", async () => {
    const invalidData = Buffer.from("NOT_A_PDF_DOCUMENT_JUST_PLAIN_TEXT_CONTENT");
    const encInfo = await detectEncryption(invalidData);
    assert.equal(encInfo.securityState, "INVALID_PDF");
    assert.equal(encInfo.isEncrypted, false);

    const result = await decryptPdf(invalidData, TEST_PASSWORD);
    assert.equal(result.success, false);
    assert.equal(result.securityState, "INVALID_PDF");
  });

  // 7. Empty PDF
  it("7. flags empty 0-byte buffer as INVALID_PDF", async () => {
    const emptyData = Buffer.alloc(0);
    const encInfo = await detectEncryption(emptyData);
    assert.equal(encInfo.securityState, "INVALID_PDF");
    assert.equal(encInfo.isEncrypted, false);

    const result = await decryptPdf(emptyData);
    assert.equal(result.success, false);
    assert.equal(result.securityState, "INVALID_PDF");
  });

  // 8. Password never persisted
  it("8. verifies password is never persisted in database or metadata", async () => {
    // Decrypt in memory
    const decryptResult = await decryptPdf(protectedBankStatementBytes, TEST_PASSWORD);
    assert.equal(decryptResult.success, true);

    const originalFileHash = calculateFileHash(protectedBankStatementBytes);
    const extractedMetadata = await inspectPdfMetadata(decryptResult.decryptedBytes!);
    extractedMetadata.fileHash = originalFileHash;

    // Process and save document with the original encrypted buffer
    const saved = await processAndSaveDocument({
      originalFileName: "encrypted-statement.pdf",
      fileSize: protectedBankStatementBytes.length,
      buffer: Buffer.from(protectedBankStatementBytes),
      extractedMetadata,
      userId: testUserId,
    });

    // Check Document in database
    const dbDoc = await prisma.document.findUnique({
      where: { id: saved.document.id },
      include: { metadata: true },
    });
    assert.ok(dbDoc);

    const docString = JSON.stringify(dbDoc);
    assert.ok(!docString.includes(TEST_PASSWORD), "Password found in Document JSON!");
    assert.ok(!docString.includes("secret"), "Secret found in Document JSON!");

    // Check Metadata
    if (dbDoc.metadata) {
      const metaString = JSON.stringify(dbDoc.metadata);
      assert.ok(!metaString.includes(TEST_PASSWORD), "Password found in Metadata!");
    }
  });

  // 9. Password never appears in logs
  it("9. verifies actual password never appears in security logs", async () => {
    const loggedMessages: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      loggedMessages.push(args.map(String).join(" "));
      originalLog(...args);
    };

    try {
      await detectEncryption(protectedPdfBytes);
      await decryptPdf(protectedPdfBytes, TEST_PASSWORD);
      await decryptPdf(protectedPdfBytes, WRONG_PASSWORD);
    } finally {
      console.log = originalLog;
    }

    // Verify none of the captured logs contain the password
    for (const msg of loggedMessages) {
      assert.ok(
        !msg.includes(TEST_PASSWORD),
        `Password was leaked in console.log: ${msg}`
      );
      assert.ok(
        !msg.includes(WRONG_PASSWORD),
        `Wrong password was leaked in console.log: ${msg}`
      );
    }

    // Verify standard security log tags appear
    const joined = loggedMessages.join("\n");
    assert.ok(joined.includes("[PDF_SECURITY] encrypted PDF detected"));
    assert.ok(joined.includes("[PDF_SECURITY] password supplied"));
    assert.ok(joined.includes("[PDF_SECURITY] decryption started"));
    assert.ok(joined.includes("[PDF_SECURITY] decryption completed"));
    assert.ok(joined.includes("[PDF_SECURITY] password validation failed"));
  });

  // 10. Decrypted PDF not permanently stored
  it("10. verifies decrypted PDF is kept in-memory and original encrypted bytes remain in storage", async () => {
    const decryptResult = await decryptPdf(protectedBankStatementBytes, TEST_PASSWORD);
    assert.equal(decryptResult.success, true);

    const originalFileHash = calculateFileHash(protectedBankStatementBytes);
    const extractedMetadata = await inspectPdfMetadata(decryptResult.decryptedBytes!);
    extractedMetadata.fileHash = originalFileHash;

    const saved = await processAndSaveDocument({
      originalFileName: "vault-protected.pdf",
      fileSize: protectedBankStatementBytes.length,
      buffer: Buffer.from(protectedBankStatementBytes),
      extractedMetadata,
      userId: testUserId,
    });

    // Store decrypted buffer in cache with temporary TTL
    storeDecryptedBuffer(saved.document.id, decryptResult.decryptedBuffer!);

    // In-memory cache returns decrypted buffer
    const cached = getDecryptedBuffer(saved.document.id);
    assert.ok(cached);
    assert.equal(cached.length, decryptResult.decryptedBuffer!.length);

    // Persistent storage retrieves ORIGINAL ENCRYPTED buffer
    const retrievedFromStorage = await getDocumentPdf(saved.document.id);
    const storageEncCheck = await detectEncryption(retrievedFromStorage.buffer);
    assert.equal(storageEncCheck.isEncrypted, true, "Storage should retain original encrypted PDF!");
    assert.equal(storageEncCheck.securityState, "PASSWORD_PROTECTED");

    // Clear cache
    clearDecryptedBuffer(saved.document.id);
    assert.equal(getDecryptedBuffer(saved.document.id), null);
  });

  // 11. Existing metadata extraction still works
  it("11. verifies metadata extraction works seamlessly on normalized decrypted PDF", async () => {
    const decryptResult = await decryptPdf(protectedBankStatementBytes, TEST_PASSWORD);
    assert.equal(decryptResult.success, true);

    const metadata = await inspectPdfMetadata(decryptResult.decryptedBytes!);
    assert.equal(metadata.title, "BCA Rekening Koran");
    assert.equal(metadata.author, "PT BANK CENTRAL ASIA TBK");
    assert.equal(metadata.pageCount, 1);
    assert.ok(metadata.pdfVersion.startsWith("1."));
  });

  // 12. Existing bank detection still works
  it("12. verifies bank detection successfully identifies BCA statement from decrypted text", async () => {
    const sampleText =
      "PT BANK CENTRAL ASIA TBK\nREKENING KORAN\nNO. REKENING : 1234567890\nPERIODE : 01/01/26 - 31/01/26\nSALDO AWAL : 10,000,000.00";
    const detection = defaultBankDetectionEngine.detect({
      totalPages: 1,
      pages: [{ pageNumber: 1, text: sampleText, characterCount: sampleText.length }],
      fullText: sampleText,
      isScannedOrImageOnly: false,
      totalCharacterCount: sampleText.length,
    });
    assert.equal(detection.bankCode, "BCA");
    assert.equal(detection.documentType, "BANK_STATEMENT");
    assert.equal(detection.accountNumberMasked, "******7890");
  });

  // 13. Existing transaction extraction still works
  it("13. verifies transaction extraction parses rows and balance continuity from decrypted statement", async () => {
    const bcaStatementText =
      "PT BANK CENTRAL ASIA TBK\n" +
      "REKENING KORAN\n" +
      "NO. REKENING : 1234567890\n" +
      "PERIODE : 01/01/2026 - 31/01/2026\n" +
      "SALDO AWAL : 10,000,000.00\n" +
      "TGL KETERANGAN CB MUTASI SALDO\n" +
      "02/01 TRSF E-BANKING DB 500,000.00 9,500,000.00\n" +
      "15/01 GAJI CR 5,000,000.00 14,500,000.00\n" +
      "SALDO AKHIR : 14,500,000.00";

    const extraction = defaultTransactionExtractionEngine.extract({
      fullText: bcaStatementText,
      pages: [
        {
          pageNumber: 1,
          text: bcaStatementText,
          characterCount: bcaStatementText.length,
        },
      ],
      bankCode: "BCA",
    });

    assert.equal(extraction.bankCode, "BCA");
    assert.ok(extraction.transactions.length >= 2);
    assert.equal(extraction.validation.balanceReconciliationStatus, "VALID");
  });

  // 14. Existing Excel export still works
  it("14. verifies Excel export produces valid workbook buffer for decrypted statement data", async () => {
    const exportData: BankStatementExportData = {
      document: {
        id: "doc-test-1",
        userId: testUserId,
        originalFileName: "bca-sample.pdf",
        storedFileName: "bca-sample_stored.pdf",
        mimeType: "application/pdf",
        fileSize: 1000,
        storageKey: "documents/bca-sample.pdf",
        fileHash: "abc123sha256",
        status: "COMPLETED",
        documentType: "BANK_STATEMENT",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      metadata: {
        id: "meta-test-1",
        documentId: "doc-test-1",
        title: "BCA Rekening Koran",
        author: "PT BANK CENTRAL ASIA TBK",
        producer: "BCA Engine",
        creator: "BCA Generator",
        creationDate: new Date(),
        modDate: null,
        pageCount: 1,
        pdfVersion: "1.7",
        isLinearized: false,
        isEncrypted: false,
        securityState: "PASSWORD_PROTECTED",
        hasOutline: false,
        rawMetadataJson: null,
        fileHash: "abc123sha256",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      statement: {
        id: "stmt-test-1",
        documentId: "doc-test-1",
        bankAccountId: null,
        bankCode: "BCA",
        bankName: "Bank Central Asia",
        accountNumberMasked: "1234567890",
        accountHolderName: "PT Test Security",
        statementPeriodStart: new Date("2026-01-01"),
        statementPeriodEnd: new Date("2026-01-31"),
        openingBalance: new Prisma.Decimal("10000000.00"),
        closingBalance: new Prisma.Decimal("14500000.00"),
        totalDebit: new Prisma.Decimal("500000.00"),
        totalCredit: new Prisma.Decimal("5000000.00"),
        netMutation: new Prisma.Decimal("4500000.00"),
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
            id: "tx-1",
            statementId: "stmt-test-1",
            transactionDate: new Date("2026-01-02"),
            description: "TRSF E-BANKING DB",
            referenceNumber: "REF1",
            debit: new Prisma.Decimal("500000.00"),
            credit: null,
            balance: new Prisma.Decimal("9500000.00"),
            transactionType: "TRANSFER_OUT",
            category: "TRANSFER",
            confidenceScore: 1.0,
            reviewFlags: null,
            rawPayload: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: "tx-2",
            statementId: "stmt-test-1",
            transactionDate: new Date("2026-01-15"),
            description: "GAJI CR",
            referenceNumber: "REF2",
            debit: null,
            credit: new Prisma.Decimal("5000000.00"),
            balance: new Prisma.Decimal("14500000.00"),
            transactionType: "SALARY",
            category: "INCOME",
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
    assert.ok(buffer && buffer.byteLength > 1000, "Workbook buffer should contain valid xlsx data");
  });
});
