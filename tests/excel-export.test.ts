import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/db/prisma.js";
import {
  LocalStorageProvider,
  setStorageProvider,
  getStorageProvider,
} from "../lib/storage/index.js";
import {
  generateBankStatementWorkbook,
  exportBankStatementToExcel,
  getExportFile,
} from "../lib/excel/index.js";
import {
  toExcelDate,
  toExcelNumeric,
  enforceMaskedAccountNumber,
  generateSafeExportFileName,
} from "../lib/excel/formatter.js";
import type { BankStatementExportData } from "../lib/excel/types.js";

const TEST_EXPORT_DIR = path.join(process.cwd(), "tmp_test_exports");

describe("Bank Statement Excel Export Engine", () => {
  let testStorageProvider: LocalStorageProvider;
  let testUserId: string;
  let validDocId: string;
  let emptyTxDocId: string;
  let cachedDoc: any;

  before(async () => {
    if (!fs.existsSync(TEST_EXPORT_DIR)) {
      fs.mkdirSync(TEST_EXPORT_DIR, { recursive: true });
    }
    testStorageProvider = new LocalStorageProvider(TEST_EXPORT_DIR);
    setStorageProvider(testStorageProvider);

    // Setup a clean test user
    const user = await prisma.user.upsert({
      where: { email: "excel-test@example.com" },
      update: {},
      create: {
        email: "excel-test@example.com",
        name: "Excel Test User",
      },
    });
    testUserId = user.id;

    // Create a mock document with extracted transactions & statement
    const testDoc = await prisma.document.create({
      data: {
        userId: testUserId,
        originalFileName: "BCA_Statement_August_2026.pdf",
        storedFileName: "BCA_Statement_August_2026_stored.pdf",
        mimeType: "application/pdf",
        fileSize: 1048576,
        storageKey: "documents/test_bca_statement.pdf",
        status: "COMPLETED",
        documentType: "BANK_STATEMENT",
        metadata: {
          create: {
            title: "Rekening Koran Tahapan BCA",
            author: "PT Bank Central Asia Tbk",
            producer: "BCA Core Banking e-Statement Engine",
            creator: "BCA Statement Generator v2",
            pageCount: 2,
            fileHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            rawMetadataJson: {
              pdfVersion: "1.7",
              bankCode: "BCA",
              bankDetectionConfidence: "HIGH",
              extractionStatus: "COMPLETED",
              balanceReconciliationStatus: "VALID",
              reviewRows: [],
              extractionWarnings: [],
            },
          },
        },
        statement: {
          create: {
            bankName: "Bank Central Asia (BCA)",
            accountNumberMasked: "088******1234",
            accountHolderName: "JOHN DOE",
            statementPeriodStart: new Date("2026-08-01T00:00:00Z"),
            statementPeriodEnd: new Date("2026-08-31T23:59:59Z"),
            openingBalance: new Prisma.Decimal("10000000.00"),
            closingBalance: new Prisma.Decimal("14500000.00"),
            totalCredit: new Prisma.Decimal("6000000.00"),
            totalDebit: new Prisma.Decimal("1500000.00"),
            transactionCount: 2,
            transactions: {
              create: [
                {
                  transactionDate: new Date("2026-08-05T00:00:00Z"),
                  description: "TRANSFER DARI BAPAK AHMAD",
                  referenceNumber: "TRX-998811",
                  debit: null,
                  credit: new Prisma.Decimal("6000000.00"),
                  balance: new Prisma.Decimal("16000000.00"),
                  transactionType: "TRANSFER_IN",
                  category: "Transfer",
                },
                {
                  transactionDate: new Date("2026-08-12T00:00:00Z"),
                  description: "TARIK TUNAI ATM KCP SUDIRMAN",
                  referenceNumber: "ATM-442211",
                  debit: new Prisma.Decimal("1500000.00"),
                  credit: null,
                  balance: new Prisma.Decimal("14500000.00"),
                  transactionType: "DEBIT",
                  category: "Cash Withdrawal",
                },
              ],
            },
          },
        },
      },
    });
    validDocId = testDoc.id;

    // Create a mock document that has NOT extracted transactions yet
    const unextractedDoc = await prisma.document.create({
      data: {
        userId: testUserId,
        originalFileName: "Pending_Statement.pdf",
        storedFileName: "Pending_Statement_stored.pdf",
        mimeType: "application/pdf",
        fileSize: 512000,
        storageKey: "documents/pending_statement.pdf",
        status: "UPLOADED",
        documentType: "BANK_STATEMENT",
        metadata: {
          create: {
            title: "Unprocessed PDF",
            pageCount: 1,
            fileHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
        },
      },
    });
    emptyTxDocId = unextractedDoc.id;

    cachedDoc = await prisma.document.findUnique({
      where: { id: validDocId },
      include: {
        metadata: true,
        statement: {
          include: { transactions: true, bankAccount: true },
        },
      },
    });
  });

  after(async () => {
    // Clean up test DB records
    try {
      await prisma.export.deleteMany({
        where: { documentId: { in: [validDocId, emptyTxDocId] } },
      });
      await prisma.transaction.deleteMany({
        where: { statement: { documentId: validDocId } },
      });
      await prisma.statement.deleteMany({
        where: { documentId: { in: [validDocId, emptyTxDocId] } },
      });
      await prisma.documentMetadata.deleteMany({
        where: { documentId: { in: [validDocId, emptyTxDocId] } },
      });
      await prisma.document.deleteMany({
        where: { id: { in: [validDocId, emptyTxDocId] } },
      });
    } catch {
      // ignore
    }

    if (fs.existsSync(TEST_EXPORT_DIR)) {
      fs.rmSync(TEST_EXPORT_DIR, { recursive: true, force: true });
    }
  });

  // -------------------------------------------------------------------------
  // 1. WORKBOOK GENERATION
  // -------------------------------------------------------------------------
  it("generates a workbook containing all 4 required sheets", async () => {
    const doc = cachedDoc;
    assert.ok(doc && doc.statement);

    const exportData: BankStatementExportData = {
      document: doc,
      metadata: doc.metadata,
      statement: doc.statement,
      reviewRows: [],
      extractionStatus: "COMPLETED",
      balanceReconciliationStatus: "VALID",
      warnings: [],
    };

    const workbook = await generateBankStatementWorkbook(exportData);

    const sheetNames = workbook.worksheets.map((ws) => ws.name);
    assert.deepEqual(sheetNames, [
      "Summary",
      "Transactions",
      "Needs Review",
      "Metadata",
    ]);
  });

  it("verifies Summary sheet contains correct document & bank values and financial numbers", async () => {
    const doc = cachedDoc;
    assert.ok(doc && doc.statement);

    const exportData: BankStatementExportData = {
      document: doc,
      metadata: doc.metadata,
      statement: doc.statement,
      reviewRows: [],
      extractionStatus: "COMPLETED",
      balanceReconciliationStatus: "VALID",
      warnings: [],
    };

    const workbook = await generateBankStatementWorkbook(exportData);
    const summarySheet = workbook.getWorksheet("Summary");
    assert.ok(summarySheet);

    // Header title
    const titleCell = summarySheet.getCell("A1").value;
    assert.equal(titleCell, "METADATA CHECKER");

    // Scan values in Summary sheet
    const summaryMap = new Map<string, unknown>();
    summarySheet.eachRow((row) => {
      const key = row.getCell(1).value?.toString();
      const val = row.getCell(2).value;
      if (key) summaryMap.set(key, val);
    });

    assert.equal(summaryMap.get("Original File Name"), "BCA_Statement_August_2026.pdf");
    assert.equal(summaryMap.get("Detected Bank"), "Bank Central Asia (BCA)");
    assert.equal(summaryMap.get("Account Number (masked)"), "088******1234");
    assert.equal(summaryMap.get("Account Holder"), "JOHN DOE");
    assert.equal(summaryMap.get("Opening Balance"), 10000000);
    assert.equal(summaryMap.get("Closing Balance"), 14500000);
    assert.equal(summaryMap.get("Total Credit"), 6000000);
    assert.equal(summaryMap.get("Total Debit"), 1500000);
    assert.equal(summaryMap.get("Transaction Count"), 2);
    assert.equal(summaryMap.get("Extraction Status"), "COMPLETED");
    assert.equal(summaryMap.get("Balance Reconciliation"), "VALID");
  });

  it("verifies Transactions sheet contains all extracted rows with numeric values and date formatting", async () => {
    const doc = cachedDoc;
    assert.ok(doc && doc.statement);

    const exportData: BankStatementExportData = {
      document: doc,
      metadata: doc.metadata,
      statement: doc.statement,
      reviewRows: [],
      extractionStatus: "COMPLETED",
      balanceReconciliationStatus: "VALID",
      warnings: [],
    };

    const workbook = await generateBankStatementWorkbook(exportData);
    const txSheet = workbook.getWorksheet("Transactions");
    assert.ok(txSheet);

    // Row 1 is header
    const headers = txSheet.getRow(1).values as string[];
    assert.ok(headers.includes("No"));
    assert.ok(headers.includes("Date"));
    assert.ok(headers.includes("Description"));
    assert.ok(headers.includes("Debit"));
    assert.ok(headers.includes("Credit"));
    assert.ok(headers.includes("Balance"));

    // Check Row 2 (Transaction 1: Credit 6000000)
    const row2 = txSheet.getRow(2);
    assert.equal(row2.getCell(1).value, 1);
    assert.ok(row2.getCell(2).value instanceof Date);
    assert.equal(row2.getCell(3).value, "TRANSFER DARI BAPAK AHMAD");
    assert.equal(row2.getCell(5).value, null); // Debit should be null/empty
    assert.equal(row2.getCell(6).value, 6000000); // Credit should be numeric 6,000,000
    assert.equal(typeof row2.getCell(6).value, "number");
    assert.equal(row2.getCell(7).value, 16000000); // Balance should be numeric 16,000,000

    // Check Row 3 (Transaction 2: Debit 1500000)
    const row3 = txSheet.getRow(3);
    assert.equal(row3.getCell(1).value, 2);
    assert.ok(row3.getCell(2).value instanceof Date);
    assert.equal(row3.getCell(3).value, "TARIK TUNAI ATM KCP SUDIRMAN");
    assert.equal(row3.getCell(5).value, 1500000); // Debit should be numeric 1,500,000
    assert.equal(typeof row3.getCell(5).value, "number");
    assert.equal(row3.getCell(6).value, null); // Credit should be null
    assert.equal(row3.getCell(7).value, 14500000); // Balance should be numeric 14,500,000
  });

  it("verifies Needs Review sheet displays clean banner when no review rows exist", async () => {
    const doc = cachedDoc;
    assert.ok(doc && doc.statement);

    const exportData: BankStatementExportData = {
      document: doc,
      metadata: doc.metadata,
      statement: doc.statement,
      reviewRows: [],
      extractionStatus: "COMPLETED",
      balanceReconciliationStatus: "VALID",
      warnings: [],
    };

    const workbook = await generateBankStatementWorkbook(exportData);
    const reviewSheet = workbook.getWorksheet("Needs Review");
    assert.ok(reviewSheet);

    const row2Text = reviewSheet.getRow(2).getCell(1).value;
    assert.equal(row2Text, "No transactions require review.");
  });

  it("verifies Needs Review sheet renders unresolved rows when present", async () => {
    const doc = cachedDoc;
    assert.ok(doc && doc.statement);

    const mockReviewRows = [
      {
        pageNumber: 1,
        rawSourceText: "01/08 BIAYA ADM AMBIGUOUS ROW 15,000",
        reason: "AMBIGUOUS_AMOUNT",
        extractedFields: {
          rawDate: "01/08",
          description: "BIAYA ADM AMBIGUOUS ROW",
          debit: "15000.00",
        },
      },
    ];

    const exportData: BankStatementExportData = {
      document: doc,
      metadata: doc.metadata,
      statement: doc.statement,
      reviewRows: mockReviewRows,
      extractionStatus: "PARTIAL",
      balanceReconciliationStatus: "PARTIAL",
      warnings: ["1 row flagged for review"],
    };

    const workbook = await generateBankStatementWorkbook(exportData);
    const reviewSheet = workbook.getWorksheet("Needs Review");
    assert.ok(reviewSheet);

    const row2 = reviewSheet.getRow(2);
    assert.equal(row2.getCell(1).value, 1);
    assert.equal(row2.getCell(2).value, 1);
    assert.equal(row2.getCell(3).value, "01/08 BIAYA ADM AMBIGUOUS ROW 15,000");
    assert.equal(row2.getCell(4).value, "AMBIGUOUS_AMOUNT");
    assert.equal(row2.getCell(8).value, 15000);
  });

  it("verifies Metadata sheet contains complete technical and analysis properties", async () => {
    const doc = cachedDoc;
    assert.ok(doc && doc.statement);

    const exportData: BankStatementExportData = {
      document: doc,
      metadata: doc.metadata,
      statement: doc.statement,
      reviewRows: [],
      extractionStatus: "COMPLETED",
      balanceReconciliationStatus: "VALID",
      warnings: [],
    };

    const workbook = await generateBankStatementWorkbook(exportData);
    const metaSheet = workbook.getWorksheet("Metadata");
    assert.ok(metaSheet);

    const metaMap = new Map<string, unknown>();
    metaSheet.eachRow((row) => {
      const key = row.getCell(1).value?.toString();
      const val = row.getCell(2).value;
      if (key) metaMap.set(key, val);
    });

    assert.equal(metaMap.get("Original File Name"), "BCA_Statement_August_2026.pdf");
    assert.equal(metaMap.get("MIME Type"), "application/pdf");
    assert.equal(metaMap.get("Page Count"), 2);
    assert.equal(
      metaMap.get("SHA-256"),
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    assert.equal(metaMap.get("Title"), "Rekening Koran Tahapan BCA");
    assert.equal(metaMap.get("Author"), "PT Bank Central Asia Tbk");
    assert.equal(metaMap.get("Document Type"), "BANK_STATEMENT");
    assert.equal(metaMap.get("Detected Bank"), "Bank Central Asia (BCA)");
  });

  // -------------------------------------------------------------------------
  // 2. SECURITY VERIFICATION
  // -------------------------------------------------------------------------
  it("strictly enforces that NO secrets or unmasked accounts exist in the exported workbook", async () => {
    const result = await exportBankStatementToExcel({
      documentId: validDocId,
      forceRegenerate: true,
    });

    assert.ok(result.buffer && result.buffer.length > 0);

    // Read generated XLSX buffer back into ExcelJS to scan every single cell
    const readWorkbook = new ExcelJS.Workbook();
    await readWorkbook.xlsx.load(result.buffer);

    const allCellValues: string[] = [];
    readWorkbook.eachSheet((worksheet) => {
      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          if (cell.value !== null && cell.value !== undefined) {
            allCellValues.push(cell.value.toString());
          }
        });
      });
    });

    const combinedText = allCellValues.join(" ");

    // Check for forbidden secret substrings
    assert.equal(
      /DATABASE_URL/i.test(combinedText),
      false,
      "Forbidden string DATABASE_URL detected in export"
    );
    assert.equal(
      /DIRECT_URL/i.test(combinedText),
      false,
      "Forbidden string DIRECT_URL detected in export"
    );
    assert.equal(
      /AUTH_SECRET/i.test(combinedText),
      false,
      "Forbidden string AUTH_SECRET detected in export"
    );
    assert.equal(
      /BLOB_READ_WRITE_TOKEN/i.test(combinedText),
      false,
      "Forbidden string BLOB_READ_WRITE_TOKEN detected in export"
    );
    assert.equal(
      /postgresql:\/\//i.test(combinedText),
      false,
      "PostgreSQL connection URL detected in export"
    );

    // Check for unmasked 10-16 digit account numbers
    const unmaskedMatches = combinedText.match(/\b\d{10,16}\b/g) || [];
    assert.equal(
      unmaskedMatches.length,
      0,
      `Unmasked account number detected in export: ${unmaskedMatches.join(", ")}`
    );
  });

  // -------------------------------------------------------------------------
  // 3. STORAGE INTEGRATION & FILE RETRIEVAL
  // -------------------------------------------------------------------------
  it("successfully persists export to StorageProvider and creates Export DB record", async () => {
    const result = await exportBankStatementToExcel({
      documentId: validDocId,
      forceRegenerate: true,
    });

    assert.ok(result.exportId);
    assert.equal(result.format, "XLSX");
    assert.ok(result.fileName.endsWith(".xlsx"));
    assert.ok(result.storageKey.startsWith(`exports/${validDocId}/`));

    // Verify file exists in storage provider
    const exists = await testStorageProvider.exists(result.storageKey);
    assert.equal(exists, true);

    // Verify DB record exists
    const dbRecord = await prisma.export.findUnique({
      where: { id: result.exportId },
    });
    assert.ok(dbRecord);
    assert.equal(dbRecord.format, "XLSX");
    assert.equal(dbRecord.fileName, result.fileName);

    // Verify retrieval via getExportFile
    const retrieved = await getExportFile(result.exportId);
    assert.equal(retrieved.fileName, result.fileName);
    assert.equal(retrieved.buffer.length, result.buffer.length);
    assert.equal(
      retrieved.mimeType,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  });

  // -------------------------------------------------------------------------
  // 4. EDGE CASES & ERROR HANDLING
  // -------------------------------------------------------------------------
  it("rejects export before transaction extraction with clear guidance", async () => {
    await assert.rejects(
      async () => {
        await exportBankStatementToExcel({ documentId: emptyTxDocId });
      },
      (err: Error) => {
        return (
          err.message.includes("Complete transaction extraction") ||
          err.message.includes("No transaction data is available")
        );
      }
    );
  });

  it("rejects export for non-existent document ID with 404 error", async () => {
    await assert.rejects(
      async () => {
        await exportBankStatementToExcel({ documentId: "non-existent-doc-id-12345" });
      },
      (err: Error) => {
        return err.message.includes("Document not found");
      }
    );
  });

  it("formats helper functions correctly", () => {
    // Numeric conversions
    assert.equal(toExcelNumeric("1,234.56"), 1234.56);
    assert.equal(toExcelNumeric("1234.56"), 1234.56);
    assert.equal(toExcelNumeric(new Prisma.Decimal("5000000.00")), 5000000);
    assert.equal(toExcelNumeric("invalid-text"), null);
    assert.equal(toExcelNumeric(null), null);

    // Masked account number enforcement
    assert.equal(enforceMaskedAccountNumber("1234567890"), "12******7890");
    assert.equal(enforceMaskedAccountNumber("088******1234"), "088******1234");
    assert.equal(enforceMaskedAccountNumber(null), "Not available");

    // Safe file name generation
    const fileName = generateSafeExportFileName(
      "Bank Central Asia (BCA)",
      new Date("2026-08-01"),
      new Date("2026-08-31")
    );
    assert.equal(fileName, "Central_Asia_Statement_August_2026.xlsx");
  });
});
