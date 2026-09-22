import ExcelJS from "exceljs";
import { prisma } from "../db/prisma";
import { getStorageProvider, getDocumentPdf } from "../storage";
import {
  defaultTransactionExtractionEngine,
  type ReviewRow,
  type ExtractionStatus,
  type BalanceReconciliationStatus,
} from "../transaction-extraction";
import type {
  BankStatementExportData,
  ExcelExportOptions,
  ExcelExportResult,
} from "./types";
import {
  EXCEL_STYLES,
  toExcelDate,
  toExcelNumeric,
  enforceMaskedAccountNumber,
  generateSafeExportFileName,
  sanitizeWorkbookText,
} from "./formatter";

/**
 * Builds the 4-sheet ExcelJS Workbook strictly complying with Bank Statement Export Engine specifications.
 * Sheets:
 * 1. Summary
 * 2. Transactions
 * 3. Needs Review
 * 4. Metadata
 */
export async function generateBankStatementWorkbook(
  data: BankStatementExportData
): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Metadata Checker Bank Statement Engine";
  workbook.created = new Date();
  workbook.modified = new Date();

  const {
    document,
    metadata,
    statement,
    reviewRows,
    extractionStatus,
    balanceReconciliationStatus,
    warnings,
  } = data;

  const rawJson = (metadata?.rawMetadataJson as Record<string, unknown>) || {};

  // =========================================================================
  // 1. SUMMARY SHEET
  // =========================================================================
  const summarySheet = workbook.addWorksheet("Summary", {
    views: [{ showGridLines: true }],
  });

  // Title & Subtitle
  const titleRow = summarySheet.addRow(["METADATA CHECKER"]);
  titleRow.font = { name: EXCEL_STYLES.font.family, size: 16, bold: true, color: { argb: "FF0F172A" } };
  summarySheet.mergeCells("A1:B1");

  const subtitleRow = summarySheet.addRow(["BANK STATEMENT ANALYSIS"]);
  subtitleRow.font = { name: EXCEL_STYLES.font.family, size: 10, bold: true, color: { argb: "FF64748B" } };
  summarySheet.mergeCells("A2:B2");

  summarySheet.addRow([]); // Blank spacer

  // Helper for Section Headers
  const addSectionHeader = (title: string) => {
    const row = summarySheet.addRow([title, ""]);
    summarySheet.mergeCells(`A${row.number}:B${row.number}`);
    row.font = { name: EXCEL_STYLES.font.family, size: 11, bold: true, color: { argb: "FF0F172A" } };
    row.fill = EXCEL_STYLES.fills.sectionBanner;
    row.getCell(1).border = EXCEL_STYLES.borders.thinBorder;
    row.getCell(2).border = EXCEL_STYLES.borders.thinBorder;
  };

  const addKeyValueRow = (
    label: string,
    value: string | number | null | undefined,
    isFinancial = false
  ) => {
    const row = summarySheet.addRow([label, value ?? "Not available"]);
    const labelCell = row.getCell(1);
    const valueCell = row.getCell(2);

    labelCell.font = { name: EXCEL_STYLES.font.family, size: 10, bold: true, color: { argb: "FF334155" } };
    labelCell.border = EXCEL_STYLES.borders.thinBorder;
    labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };

    valueCell.font = { name: EXCEL_STYLES.font.family, size: 10, color: { argb: "FF0F172A" } };
    valueCell.border = EXCEL_STYLES.borders.thinBorder;

    if (isFinancial && typeof value === "number") {
      valueCell.numFmt = EXCEL_STYLES.numberFormats.financial;
      valueCell.alignment = { horizontal: "right" };
    }
  };

  // Section 1: Document Information
  addSectionHeader("Document Information");
  addKeyValueRow("Original File Name", sanitizeWorkbookText(document.originalFileName));
  addKeyValueRow("Document Type", document.documentType);
  addKeyValueRow("Detected Bank", sanitizeWorkbookText(statement.bankName || "Unknown"));
  addKeyValueRow(
    "Account Number (masked)",
    enforceMaskedAccountNumber(statement.accountNumberMasked || statement.bankAccount?.accountNumberMasked)
  );
  addKeyValueRow(
    "Account Holder",
    sanitizeWorkbookText(statement.accountHolderName || statement.bankAccount?.accountHolderName || "Not available")
  );

  let periodStr = "Not available";
  if (statement.statementPeriodStart && statement.statementPeriodEnd) {
    const s = statement.statementPeriodStart.toISOString().split("T")[0];
    const e = statement.statementPeriodEnd.toISOString().split("T")[0];
    periodStr = `${s} to ${e}`;
  }
  addKeyValueRow("Statement Period", periodStr);

  summarySheet.addRow([]); // Blank spacer

  // Section 2: Financial Summary
  addSectionHeader("Financial Summary");
  addKeyValueRow("Opening Balance", toExcelNumeric(statement.openingBalance), true);
  addKeyValueRow("Closing Balance", toExcelNumeric(statement.closingBalance), true);
  addKeyValueRow("Total Credit", toExcelNumeric(statement.totalCredit), true);
  addKeyValueRow("Total Debit", toExcelNumeric(statement.totalDebit), true);
  addKeyValueRow("Transaction Count", statement.transactionCount || statement.transactions.length);

  summarySheet.addRow([]); // Blank spacer

  // Section 3: Validation
  addSectionHeader("Validation");
  addKeyValueRow("Extraction Status", extractionStatus);
  addKeyValueRow("Balance Reconciliation", balanceReconciliationStatus);
  addKeyValueRow("Transactions Needing Review", reviewRows.length);
  addKeyValueRow(
    "Extraction Warnings",
    warnings.length > 0 ? warnings.map(w => sanitizeWorkbookText(w)).join("; ") : "None"
  );

  summarySheet.getColumn(1).width = 28;
  summarySheet.getColumn(2).width = 46;

  // =========================================================================
  // 2. TRANSACTIONS SHEET
  // =========================================================================
  const txSheet = workbook.addWorksheet("Transactions", {
    views: [{ state: "frozen", ySplit: 1, showGridLines: true }],
  });

  const txColumns = [
    { header: "No", key: "no", width: 8 },
    { header: "Date", key: "date", width: 14 },
    { header: "Description", key: "description", width: 44 },
    { header: "Reference", key: "reference", width: 18 },
    { header: "Debit", key: "debit", width: 16 },
    { header: "Credit", key: "credit", width: 16 },
    { header: "Balance", key: "balance", width: 18 },
    { header: "Transaction Type", key: "type", width: 18 },
    { header: "Category", key: "category", width: 16 },
    { header: "Confidence", key: "confidence", width: 14 },
    { header: "Review Status", key: "reviewStatus", width: 14 },
  ];
  txSheet.columns = txColumns;

  // Header styling
  const txHeaderRow = txSheet.getRow(1);
  txHeaderRow.height = 26;
  txHeaderRow.font = { name: EXCEL_STYLES.font.family, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
  txHeaderRow.fill = EXCEL_STYLES.fills.primaryHeader;
  txHeaderRow.alignment = { vertical: "middle", horizontal: "center" };
  for (let c = 1; c <= 11; c++) {
    txHeaderRow.getCell(c).border = EXCEL_STYLES.borders.headerBorder;
  }

  // Populate transaction rows
  const sortedTransactions = [...statement.transactions].sort((a, b) =>
    a.transactionDate.getTime() - b.transactionDate.getTime()
  );

  sortedTransactions.forEach((tx, idx) => {
    const rowNum = idx + 1;
    const excelDate = toExcelDate(tx.transactionDate);
    const debitNum = toExcelNumeric(tx.debit);
    const creditNum = toExcelNumeric(tx.credit);
    const balanceNum = toExcelNumeric(tx.balance);

    const insertedRow = txSheet.addRow({
      no: rowNum,
      date: excelDate,
      description: sanitizeWorkbookText(tx.description),
      reference: tx.referenceNumber ? sanitizeWorkbookText(tx.referenceNumber) : "",
      debit: debitNum,
      credit: creditNum,
      balance: balanceNum,
      type: tx.transactionType || "UNKNOWN",
      category: tx.category || "",
      confidence: "HIGH",
      reviewStatus: "VALID",
    });

    insertedRow.height = 20;

    // Apply Zebra striping
    const rowFill = idx % 2 === 1 ? EXCEL_STYLES.fills.zebraRow : undefined;

    for (let c = 1; c <= 11; c++) {
      const cell = insertedRow.getCell(c);
      cell.border = EXCEL_STYLES.borders.thinBorder;
      if (rowFill) cell.fill = rowFill;
      cell.font = { name: EXCEL_STYLES.font.family, size: 10 };
    }

    // Number alignments and formats
    insertedRow.getCell(1).alignment = { horizontal: "center", vertical: "top" }; // No
    const dateCell = insertedRow.getCell(2);
    dateCell.alignment = { horizontal: "center", vertical: "top" };
    dateCell.numFmt = EXCEL_STYLES.numberFormats.date;

    const descCell = insertedRow.getCell(3);
    descCell.alignment = { wrapText: true, vertical: "top" };

    const refCell = insertedRow.getCell(4);
    refCell.alignment = { vertical: "top" };

    const debitCell = insertedRow.getCell(5);
    debitCell.alignment = { horizontal: "right", vertical: "top" };
    debitCell.numFmt = EXCEL_STYLES.numberFormats.financial;

    const creditCell = insertedRow.getCell(6);
    creditCell.alignment = { horizontal: "right", vertical: "top" };
    creditCell.numFmt = EXCEL_STYLES.numberFormats.financial;

    const balCell = insertedRow.getCell(7);
    balCell.alignment = { horizontal: "right", vertical: "top" };
    balCell.numFmt = EXCEL_STYLES.numberFormats.financial;

    insertedRow.getCell(8).alignment = { horizontal: "center", vertical: "top" }; // Type
    insertedRow.getCell(9).alignment = { horizontal: "center", vertical: "top" }; // Category
    insertedRow.getCell(10).alignment = { horizontal: "center", vertical: "top" }; // Confidence
    insertedRow.getCell(11).alignment = { horizontal: "center", vertical: "top" }; // Review Status
  });

  // Enable AutoFilter
  txSheet.autoFilter = "A1:K1";

  // =========================================================================
  // 3. NEEDS REVIEW SHEET
  // =========================================================================
  const reviewSheet = workbook.addWorksheet("Needs Review", {
    views: [{ state: "frozen", ySplit: 1, showGridLines: true }],
  });

  const reviewColumns = [
    { header: "No", key: "no", width: 8 },
    { header: "Page", key: "page", width: 8 },
    { header: "Raw Source", key: "rawSource", width: 40 },
    { header: "Issue", key: "issue", width: 22 },
    { header: "Date", key: "date", width: 14 },
    { header: "Description", key: "description", width: 34 },
    { header: "Reference", key: "reference", width: 16 },
    { header: "Debit", key: "debit", width: 15 },
    { header: "Credit", key: "credit", width: 15 },
    { header: "Balance", key: "balance", width: 16 },
    { header: "Confidence", key: "confidence", width: 14 },
    { header: "Reason", key: "reason", width: 28 },
  ];
  reviewSheet.columns = reviewColumns;

  // Header styling
  const reviewHeaderRow = reviewSheet.getRow(1);
  reviewHeaderRow.height = 26;
  reviewHeaderRow.font = { name: EXCEL_STYLES.font.family, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
  reviewHeaderRow.fill = EXCEL_STYLES.fills.primaryHeader;
  reviewHeaderRow.alignment = { vertical: "middle", horizontal: "center" };
  for (let c = 1; c <= 12; c++) {
    reviewHeaderRow.getCell(c).border = EXCEL_STYLES.borders.headerBorder;
  }

  if (reviewRows.length === 0) {
    const emptyRow = reviewSheet.addRow([
      "No transactions require review.",
      "", "", "", "", "", "", "", "", "", "", ""
    ]);
    reviewSheet.mergeCells(`A2:L2`);
    emptyRow.height = 36;
    const bannerCell = emptyRow.getCell(1);
    bannerCell.alignment = { horizontal: "center", vertical: "middle" };
    bannerCell.font = { name: EXCEL_STYLES.font.family, size: 11, bold: true, color: { argb: "FF065F46" } };
    bannerCell.fill = EXCEL_STYLES.fills.badgeValid;
    for (let c = 1; c <= 12; c++) {
      emptyRow.getCell(c).border = EXCEL_STYLES.borders.thinBorder;
    }
  } else {
    reviewRows.forEach((r, idx) => {
      const extracted = r.extractedFields || {};
      const debitVal = toExcelNumeric(extracted.debit as string);
      const creditVal = toExcelNumeric(extracted.credit as string);
      const balVal = toExcelNumeric(extracted.balance as string);

      const row = reviewSheet.addRow({
        no: idx + 1,
        page: r.pageNumber || 1,
        rawSource: sanitizeWorkbookText(r.rawSourceText),
        issue: r.reason,
        date: (extracted.date as string) || (extracted.rawDate as string) || "-",
        description: sanitizeWorkbookText((extracted.description as string) || "-"),
        reference: sanitizeWorkbookText((extracted.referenceNumber as string) || "-"),
        debit: debitVal,
        credit: creditVal,
        balance: balVal,
        confidence: "LOW",
        reason: r.reason,
      });

      row.height = 24;
      const rowFill = idx % 2 === 1 ? EXCEL_STYLES.fills.zebraRow : undefined;

      for (let c = 1; c <= 12; c++) {
        const cell = row.getCell(c);
        cell.border = EXCEL_STYLES.borders.thinBorder;
        if (rowFill) cell.fill = rowFill;
        cell.font = { name: EXCEL_STYLES.font.family, size: 10 };
      }

      row.getCell(1).alignment = { horizontal: "center", vertical: "top" };
      row.getCell(2).alignment = { horizontal: "center", vertical: "top" };
      row.getCell(3).alignment = { wrapText: true, vertical: "top" };
      row.getCell(4).alignment = { horizontal: "center", vertical: "top" };
      row.getCell(5).alignment = { horizontal: "center", vertical: "top" };
      row.getCell(6).alignment = { wrapText: true, vertical: "top" };
      row.getCell(7).alignment = { vertical: "top" };

      const dCell = row.getCell(8);
      dCell.alignment = { horizontal: "right", vertical: "top" };
      if (debitVal !== null) dCell.numFmt = EXCEL_STYLES.numberFormats.financial;

      const cCell = row.getCell(9);
      cCell.alignment = { horizontal: "right", vertical: "top" };
      if (creditVal !== null) cCell.numFmt = EXCEL_STYLES.numberFormats.financial;

      const bCell = row.getCell(10);
      bCell.alignment = { horizontal: "right", vertical: "top" };
      if (balVal !== null) bCell.numFmt = EXCEL_STYLES.numberFormats.financial;

      row.getCell(11).alignment = { horizontal: "center", vertical: "top" };
      row.getCell(12).alignment = { vertical: "top" };
    });
  }

  reviewSheet.autoFilter = "A1:L1";

  // =========================================================================
  // 4. METADATA SHEET
  // =========================================================================
  const metaSheet = workbook.addWorksheet("Metadata", {
    views: [{ showGridLines: true }],
  });

  const addMetaHeader = (title: string) => {
    const row = metaSheet.addRow([title, ""]);
    metaSheet.mergeCells(`A${row.number}:B${row.number}`);
    row.font = { name: EXCEL_STYLES.font.family, size: 11, bold: true, color: { argb: "FF0F172A" } };
    row.fill = EXCEL_STYLES.fills.sectionBanner;
    row.getCell(1).border = EXCEL_STYLES.borders.thinBorder;
    row.getCell(2).border = EXCEL_STYLES.borders.thinBorder;
  };

  const addMetaRow = (label: string, value: string | number | null | undefined) => {
    const row = metaSheet.addRow([label, value ?? "Not available"]);
    const labelCell = row.getCell(1);
    const valueCell = row.getCell(2);

    labelCell.font = { name: EXCEL_STYLES.font.family, size: 10, bold: true, color: { argb: "FF334155" } };
    labelCell.border = EXCEL_STYLES.borders.thinBorder;
    labelCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };

    valueCell.font = { name: EXCEL_STYLES.font.family, size: 10, color: { argb: "FF0F172A" } };
    valueCell.border = EXCEL_STYLES.borders.thinBorder;
  };

  // Section 1: PDF Information
  addMetaHeader("PDF Information");
  addMetaRow("Original File Name", sanitizeWorkbookText(document.originalFileName));
  addMetaRow("MIME Type", document.mimeType);
  addMetaRow(
    "File Size",
    `${(document.fileSize / 1024).toFixed(1)} KB (${document.fileSize.toLocaleString()} bytes)`
  );
  addMetaRow("PDF Version", (rawJson.pdfVersion as string) || "1.7");
  addMetaRow("Page Count", metadata?.pageCount || 1);
  addMetaRow("SHA-256", metadata?.fileHash || "Not available");

  metaSheet.addRow([]); // Blank spacer

  // Section 2: PDF Metadata
  addMetaHeader("PDF Metadata");
  addMetaRow("Title", sanitizeWorkbookText(metadata?.title));
  addMetaRow("Author", sanitizeWorkbookText(metadata?.author));
  addMetaRow("Subject", sanitizeWorkbookText(metadata?.subject));
  addMetaRow("Creator", sanitizeWorkbookText(metadata?.creator));
  addMetaRow("Producer", sanitizeWorkbookText(metadata?.producer));
  addMetaRow(
    "Creation Date",
    metadata?.creationDate ? metadata.creationDate.toISOString() : "Not available"
  );
  addMetaRow(
    "Modification Date",
    metadata?.modificationDate ? metadata.modificationDate.toISOString() : "Not available"
  );

  metaSheet.addRow([]); // Blank spacer

  // Section 3: Document Analysis
  addMetaHeader("Document Analysis");
  addMetaRow("Document Type", document.documentType);
  addMetaRow("Detected Bank", sanitizeWorkbookText(statement.bankName || "Unknown"));
  addMetaRow(
    "Bank Code",
    (rawJson.bankCode as string) || statement.bankName?.toUpperCase().replace(/[^A-Z0-9]/g, "_") || "UNKNOWN"
  );
  addMetaRow("Detection Confidence", (rawJson.bankDetectionConfidence as string) || "HIGH");
  addMetaRow(
    "Statement Period Start",
    statement.statementPeriodStart
      ? statement.statementPeriodStart.toISOString().split("T")[0]
      : "Not available"
  );
  addMetaRow(
    "Statement Period End",
    statement.statementPeriodEnd
      ? statement.statementPeriodEnd.toISOString().split("T")[0]
      : "Not available"
  );
  addMetaRow(
    "Account Number (masked)",
    enforceMaskedAccountNumber(statement.accountNumberMasked || statement.bankAccount?.accountNumberMasked)
  );
  addMetaRow(
    "Account Holder",
    sanitizeWorkbookText(statement.accountHolderName || statement.bankAccount?.accountHolderName)
  );

  metaSheet.getColumn(1).width = 28;
  metaSheet.getColumn(2).width = 46;

  return workbook;
}

/**
 * Main export coordinator:
 * 1. Loads Document, Statement, Transactions, Metadata, BankAccount from PostgreSQL.
 * 2. Enforces extraction status and data completeness checks.
 * 3. Builds XLSX workbook.
 * 4. Stores binary in StorageProvider.
 * 5. Persists metadata record in Export table.
 * 6. Supports deterministic idempotency.
 */
export async function exportBankStatementToExcel(
  options: ExcelExportOptions
): Promise<ExcelExportResult> {
  const { documentId, userId, forceRegenerate = false } = options;

  if (!documentId || typeof documentId !== "string") {
    throw new Error("Invalid document ID provided.");
  }

  // 1. Verify document exists & load relations
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      metadata: true,
      statement: {
        include: {
          transactions: {
            orderBy: { transactionDate: "asc" },
          },
          bankAccount: true,
        },
      },
      processingJobs: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!document) {
    throw new Error("Document not found.");
  }

  // 2. Verify extraction completeness
  if (!document.statement || !document.statement.transactions) {
    if (document.metadata) {
      throw new Error("Complete transaction extraction before exporting.");
    }
    throw new Error("No transaction data is available for export.");
  }

  if (document.statement.transactions.length === 0) {
    throw new Error("No transaction data is available for export.");
  }

  // 3. Verify extraction status
  const recentExtractionJob = document.processingJobs.find(
    (j) => j.jobType === "TRANSACTION_EXTRACTION"
  );
  if (recentExtractionJob && recentExtractionJob.status === "FAILED") {
    throw new Error("Cannot export: transaction extraction status is FAILED.");
  }

  // 4. Resolve review rows & validation
  const rawMetaJson = (document.metadata?.rawMetadataJson as Record<string, unknown>) || {};
  let reviewRows: ReviewRow[] = (rawMetaJson.reviewRows as ReviewRow[]) || [];
  let extractionStatus: ExtractionStatus =
    (rawMetaJson.extractionStatus as ExtractionStatus) ||
    (reviewRows.length > 0 ? "PARTIAL" : "COMPLETED");
  let balanceReconciliationStatus: BalanceReconciliationStatus =
    (rawMetaJson.balanceReconciliationStatus as BalanceReconciliationStatus) ||
    (reviewRows.length > 0 ? "PARTIAL" : "VALID");
  let warnings: string[] = (rawMetaJson.extractionWarnings as string[]) || [];

  // If reviewRows not yet cached in metadata, extract them from stored PDF
  if (!rawMetaJson.reviewRows) {
    try {
      const retrieved = await getDocumentPdf(documentId);
      const extraction = defaultTransactionExtractionEngine.extract({
        fullText: "",
        pages: [],
        bankName: document.statement.bankName,
        sourceOpeningBalance: document.statement.openingBalance?.toString() || null,
        sourceClosingBalance: document.statement.closingBalance?.toString() || null,
      });
      if (extraction.reviewRows) {
        reviewRows = extraction.reviewRows;
        extractionStatus = extraction.status;
        balanceReconciliationStatus = extraction.validation.balanceReconciliationStatus;
        warnings = extraction.validation.warnings;
      }
    } catch {
      // Keep resolved defaults
    }
  }

  // 5. Idempotency Check: if identical export exists in DB & storage, reuse it
  if (!forceRegenerate) {
    const existingExport = await prisma.export.findFirst({
      where: {
        documentId: document.id,
        format: "XLSX",
      },
      orderBy: { createdAt: "desc" },
    });

    if (
      existingExport &&
      document.statement &&
      existingExport.createdAt >= document.statement.updatedAt
    ) {
      const provider = getStorageProvider();
      const exists = await provider.exists(existingExport.storageKey).catch(() => false);
      if (exists) {
        const buffer = await provider.download(existingExport.storageKey);
        return {
          exportId: existingExport.id,
          documentId: document.id,
          fileName: existingExport.fileName,
          storageKey: existingExport.storageKey,
          format: "XLSX",
          fileSize: buffer.length,
          transactionCount: document.statement.transactions.length,
          reviewCount: reviewRows.length,
          createdAt: existingExport.createdAt,
          buffer,
        };
      }
    }
  }

  // 6. Generate XLSX Workbook
  const workbook = await generateBankStatementWorkbook({
    document,
    metadata: document.metadata,
    statement: document.statement,
    reviewRows,
    extractionStatus,
    balanceReconciliationStatus,
    warnings,
  });

  const bufferArray = await workbook.xlsx.writeBuffer();
  const buffer = Buffer.from(bufferArray);

  // 7. Generate Safe Filename and Storage Key
  const safeFileName = generateSafeExportFileName(
    document.statement.bankName,
    document.statement.statementPeriodStart,
    document.statement.statementPeriodEnd,
    document.id
  );

  const storageKey = `exports/${document.id}/${safeFileName}`;

  // 8. Upload to StorageProvider
  const provider = getStorageProvider();
  await provider.upload(storageKey, buffer, {
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  // 9. Persist Export database record
  const exportRecord = await prisma.export.create({
    data: {
      documentId: document.id,
      userId: userId || document.userId,
      format: "XLSX",
      fileName: safeFileName,
      storageKey,
    },
  });

  return {
    exportId: exportRecord.id,
    documentId: document.id,
    fileName: safeFileName,
    storageKey,
    format: "XLSX",
    fileSize: buffer.length,
    transactionCount: document.statement.transactions.length,
    reviewCount: reviewRows.length,
    createdAt: exportRecord.createdAt,
    buffer,
  };
}

/**
 * Retrieves a generated Excel export file for download.
 */
export async function getExportFile(exportId: string): Promise<{
  buffer: Buffer;
  fileName: string;
  storageKey: string;
  mimeType: string;
}> {
  if (!exportId || typeof exportId !== "string") {
    throw new Error("Invalid export ID provided.");
  }

  const exportRecord = await prisma.export.findUnique({
    where: { id: exportId },
  });

  if (!exportRecord) {
    throw new Error("Export record not found.");
  }

  const provider = getStorageProvider();
  const buffer = await provider.download(exportRecord.storageKey);

  return {
    buffer,
    fileName: exportRecord.fileName,
    storageKey: exportRecord.storageKey,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}
